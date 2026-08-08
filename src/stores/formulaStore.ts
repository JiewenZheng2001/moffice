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

  /** 依赖图内部 key：sheetId + ref，隔离不同 Sheet 的同名单元格 */
  function depKey(ref: string): string {
    return `${activeSheetId.value}:${ref}`
  }

  /** 从内部 key 还原纯 ref（去掉 sheetId 前缀） */
  function depKeyToRef(key: string): string {
    const idx = key.indexOf(':')
    return idx >= 0 ? key.slice(idx + 1) : key
  }

  /**
   * 同步当前依赖图上下文（workbookStore 切换 Sheet 时调用）
   * 注意：切换 Sheet 后旧 Sheet 的依赖关系仍然保留在图中（key 不同），
   * 切回时公式传播依然正确。
   */
  function setActiveSheetContext(sheetId: string): void {
    activeSheetId.value = sheetId
  }

  /**
   * 计算一个公式并返回结果
   * @returns { value, deps } — 计算结果和依赖的单元格列表
   */
  function compute(
    formula: string,
    sheet: Sheet,
  ): { value: number | string | boolean | FormulaErrorType; deps: string[] } {
    const ctx = createEvalContext(sheet)
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
   * 获取指定单元格变更后需要重算的所有单元格（仅当前 Sheet 内的依赖）
   */
  function getAffectedCells(cellRef: string): string[] {
    // 内部 key 带 sheetId 前缀，返回前还原为纯 ref
    return deps.getAffectedCells(depKey(cellRef)).map((k) => depKeyToRef(k))
  }

  /**
   * 重新计算指定单元格的公式
   * 用于依赖传播：当某格值变化后，重算所有引用此格的公式
   */
  function recalculate(cellRef: string, sheet: Sheet): void {
    const cell = sheet.cells.get(cellRef)
    if (!cell || !cell.formula) return

    const result = compute(cell.formula, sheet)
    cell.computedValue = result.value
    cell.error = typeof result.value === 'string' && result.value.startsWith('#') ? result.value : null

    // 更新依赖
    deps.setDeps(depKey(cellRef), result.deps.map((r) => depKey(r)))

    // 传播：继续重算依赖此格的单元格
    const affected = deps.getAffectedCells(depKey(cellRef))
    for (const key of affected) {
      recalculate(depKeyToRef(key), sheet)
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

/**
 * 创建公式求值上下文 —— 将 Sheet 数据适配为引擎可读接口
 */
function createEvalContext(sheet: Sheet): EvalContext {
  return {
    getCellValue(ref: string): number | string | null {
      const cell = sheet.cells.get(ref.toUpperCase())
      if (!cell) return null
      if (cell.error) return null
      const val = cell.computedValue
      if (typeof val === 'number' || typeof val === 'string') return val
      return null
    },

    getRangeValues(startRef: string, endRef: string): (number | string | null)[] {
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
          const cell = sheet.cells.get(ref)
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
