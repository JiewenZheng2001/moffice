import type { Cell, CellRef, CellValue } from './types'

/** 创建空白单元格的默认值 */
export function createCell(id: CellRef): Cell {
  return {
    id,
    rawValue: null,
    computedValue: null,
    formula: null,
    format: {},
    error: null,
  }
}

/** 设置单元格的原始值（非公式） */
export function setCellRawValue(cell: Cell, value: CellValue): void {
  cell.rawValue = value
  cell.computedValue = value
  cell.formula = null
  cell.error = null
}
