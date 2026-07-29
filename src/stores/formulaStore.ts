import { defineStore } from 'pinia'
import { DependencyGraph, computeFormula } from '@/engine'
import type { EvalContext, FormulaErrorType } from '@/engine'
import type { Sheet } from '@/model/types'

/**
 * 公式 Store —— 管理公式引擎的对外接口
 * - 持有依赖图实例
 * - 提供公式计算和依赖传播
 */
export const useFormulaStore = defineStore('formula', () => {
  const deps = new DependencyGraph()

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
    return deps.setDeps(cellRef, depRefs)
  }

  /**
   * 移除指定单元格的依赖关系（删除单元格或清除公式时调用）
   */
  function removeDeps(cellRef: string): void {
    deps.removeDeps(cellRef)
  }

  /**
   * 获取指定单元格变更后需要重算的所有单元格
   */
  function getAffectedCells(cellRef: string): string[] {
    return deps.getAffectedCells(cellRef)
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
    deps.setDeps(cellRef, result.deps)

    // 传播：继续重算依赖此格的单元格
    const affected = deps.getAffectedCells(cellRef)
    for (const ref of affected) {
      recalculate(ref, sheet)
    }
  }

  return {
    compute,
    setDeps,
    removeDeps,
    getAffectedCells,
    recalculate,
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
          const ref = `${colToLetter(c)}${r + 1}`
          const cell = sheet.cells.get(ref)
          if (cell) {
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

function parseRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colToIndex(m[1]),
    row: parseInt(m[2], 10) - 1,
  }
}

function colToIndex(col: string): number {
  let result = 0
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64)
  }
  return result - 1
}

function colToLetter(col: number): string {
  let result = ''
  let n = col
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}
