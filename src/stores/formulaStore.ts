import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DependencyGraph, computeFormula } from '@/engine'
import type { EvalContext, FormulaErrorType } from '@/engine'
import type { Sheet } from '@/model/types'
import { parseRef, indexToCol } from '@/utils/columnUtils'

/**
 * 公式 Store —— 管理公式引擎的对外接口
 * - 持有依赖图实例
 * - 提供公式计算和依赖传播
 *
 * 依赖图隔离：不同 Sheet 的相同单元格引用（如 Sheet1!A1 和 Sheet2!A1）
 * 在依赖图中必须互不干扰。内部使用 `${sheetId}:${ref}` 作为 key，
 * 对外仍暴露纯 ref（调用方零感知）。
 */
export const useFormulaStore = defineStore('formula', () => {
  const deps = new DependencyGraph()

  /** 当前依赖图所属的 Sheet 上下文（由 workbookStore 切换时同步） */
  const activeSheetId = ref('')
  /** 当前 sheet 名（deps key 用名字，跨 sheet 引用才能匹配） */
  const activeSheetName = ref('')

  /**
   * 依赖图内部 key：
   * - 裸引用 "A1"（当前 sheet）→ `${sheetName}!A1`（统一格式）
   * - 跨 sheet 引用 "Sheet2!A1" → 原样（名字前缀已隔离）
   * 统一用名字的好处：修改 Sheet2!A1 时，所有引用它的公式（无论哪个 sheet）都能命中
   */
  function depKey(ref: string): string {
    if (ref.includes('!')) return ref
    return `${activeSheetName.value}!${ref}`
  }

  /** 从内部 key 还原纯 ref（去掉 sheet 名前缀），如 "Sheet1!A1" → "A1" */
  function depKeyToRef(key: string): string {
    const idx = key.indexOf('!')
    return idx >= 0 ? key.slice(idx + 1) : key
  }

  /**
   * 同步当前依赖图上下文（workbookStore 切换 Sheet 时调用）
   * @param sheetId sheet 唯一 id（兼容旧调用）
   * @param sheetName sheet 显示名（deps key 用）
   */
  function setActiveSheetContext(sheetId: string, sheetName?: string): void {
    activeSheetId.value = sheetId
    if (sheetName) activeSheetName.value = sheetName
  }

  /**
   * 计算一个公式并返回结果
   * @param workbook 可选：跨 sheet 引用（=Sheet2!A1）需要整个工作簿上下文
   * @returns { value, deps } — 计算结果和依赖的单元格列表
   */
  function compute(
    formula: string,
    sheet: Sheet,
    workbook?: { sheets: Sheet[] },
  ): { value: number | string | boolean | FormulaErrorType; deps: string[] } {
    const ctx = createEvalContext(sheet, workbook)
    const result = computeFormula(formula, ctx)
    return { value: result.value, deps: result.deps }
  }

  /**
   * 为指定单元格设置公式依赖，检测循环引用
   * @returns 如果是循环引用返回 "#CIRCULAR!"，否则 null
   */
  function setDeps(cellRef: string, depRefs: string[]): FormulaErrorType | null {
    return deps.setDeps(depKey(cellRef), depRefs.map((r) => depKey(r)))
  }

  /**
   * 移除指定单元格的依赖关系（删除单元格或清除公式时调用）
   */
  function removeDeps(cellRef: string): void {
    deps.removeDeps(depKey(cellRef))
  }

  /**
   * 获取指定单元格变更后需要重算的所有单元格
   * @returns 带 sheet 名前缀的 key（如 "Sheet1!B1"、"Sheet2!C1"），
   *          调用方据此解析目标 sheet 完成跨 sheet 重算
   */
  function getAffectedCells(cellRef: string): string[] {
    return deps.getAffectedCells(depKey(cellRef))
  }

  /**
   * 重新计算指定单元格的公式
   * 用于依赖传播：当某格值变化后，重算所有引用此格的公式
   */
  function recalculate(cellRef: string, sheet: Sheet, workbook?: { sheets: Sheet[] }): void {
    const cell = sheet.cells.get(cellRef)
    if (!cell || !cell.formula) return

    const result = compute(cell.formula, sheet, workbook)
    cell.computedValue = result.value
    cell.error = typeof result.value === 'string' && result.value.startsWith('#') ? result.value : null

    // 更新依赖
    deps.setDeps(depKey(cellRef), result.deps.map((r) => depKey(r)))

    // 传播：继续重算依赖此格的单元格（支持跨 sheet，按名字解析目标）
    const affected = deps.getAffectedCells(depKey(cellRef))
    for (const key of affected) {
      const targetRef = depKeyToRef(key)
      const targetSheet = resolveSheetByName(key, sheet, workbook)
      if (targetSheet) {
        recalculate(targetRef, targetSheet, workbook)
      }
    }
  }

  return {
    compute,
    setDeps,
    removeDeps,
    getAffectedCells,
    recalculate,
    setActiveSheetContext,
  }
})

/** 从 deps key（"Sheet1!B1"）解析目标 sheet；裸 key 用当前 sheet */
function resolveSheetByName(
  key: string,
  currentSheet: Sheet,
  workbook?: { sheets: Sheet[] },
): Sheet | null {
  const idx = key.indexOf('!')
  if (idx < 0) return currentSheet
  const sheetName = key.slice(0, idx)
  if (!workbook) return null
  return workbook.sheets.find((s) => s.name === sheetName) ?? null
}

/**
 * 创建公式求值上下文 —— 将 Sheet 数据适配为引擎可读接口
 * @param sheet 当前 sheet
 * @param workbook 可选：跨 sheet 引用（=Sheet2!A1）按名字查找其他 sheet
 */
function createEvalContext(sheet: Sheet, workbook?: { sheets: Sheet[] }): EvalContext {
  /** 解析目标 sheet：无 sheetName 用当前 sheet；否则按名字查找（找不到返回 null） */
  function resolveSheet(sheetName?: string): Sheet | null {
    if (!sheetName) return sheet
    if (!workbook) return null
    return workbook.sheets.find((s) => s.name === sheetName) ?? null
  }

  return {
    getCellValue(ref: string, sheetName?: string): number | string | null {
      const target = resolveSheet(sheetName)
      if (!target) return null
      const cell = target.cells.get(ref.toUpperCase())
      if (!cell) return null
      if (cell.error) return null
      const val = cell.computedValue
      if (typeof val === 'number' || typeof val === 'string') return val
      return null
    },

    getRangeValues(startRef: string, endRef: string, sheetName?: string): (number | string | null)[] {
      const target = resolveSheet(sheetName)
      if (!target) return []
      const s = parseRef(startRef)
      const e = parseRef(endRef)
      if (!s || !e) return []

      const values: (number | string | null)[] = []
      const startCol = Math.min(s.col, e.col)
      const endCol = Math.max(s.col, e.col)
      const startRow = Math.min(s.row, e.row)
      const endRow = Math.max(s.row, e.row)

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const ref = `${indexToCol(c)}${r + 1}`
          const cell = target.cells.get(ref)
          // 与 getCellValue 一致：错误格按空单元格处理（不参与计算）
          if (cell && !cell.error) {
            const val = cell.computedValue
            if (typeof val === 'number' || typeof val === 'string') {
              values.push(val)
            }
          }
        }
      }
      return values
    },
  }
}
