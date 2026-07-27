import type { Sheet } from './types'
import { DEFAULT_ROW_COUNT, DEFAULT_COLUMN_COUNT } from './constants'

/** 创建空白 Sheet */
export function createSheet(name: string): Sheet {
  return {
    id: `sheet-${Date.now()}`,
    name,
    cells: new Map(),
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    columnWidths: new Map(),
    rowHeights: new Map(),
    tabColor: null,
  }
}
