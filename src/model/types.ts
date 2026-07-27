// ---- 单元格引用类型 ----

/** 单元格地址，如 "A1", "B2", "Sheet2!A1" */
export type CellRef = string

/** 范围引用，如 "A1:B5", "Sheet2!A1:C10" */
export type RangeRef = `${CellRef}:${CellRef}`

/** 单元格原始值类型 */
export type CellValue = string | number | boolean | null

/** 公式错误类型 */
export type FormulaError =
  | '#REF!'
  | '#VALUE!'
  | '#DIV/0!'
  | '#NAME?'
  | '#NUM!'
  | '#ERROR!'

// ---- 单元格格式化 ----

export interface CellFormat {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  textColor?: string
  backgroundColor?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  numberFormat?: string
  borderTop?: BorderStyle
  borderBottom?: BorderStyle
  borderLeft?: BorderStyle
  borderRight?: BorderStyle
}

export interface BorderStyle {
  color: string
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'
}

// ---- 单元格 ----

export interface Cell {
  id: CellRef
  rawValue: CellValue
  computedValue: CellValue
  formula: string | null
  format: CellFormat
  error: string | null
}

// ---- Sheet ----

export interface Sheet {
  id: string
  name: string
  /** 稀疏存储：只存有内容的单元格 */
  cells: Map<CellRef, Cell>
  rowCount: number
  columnCount: number
  columnWidths: Map<number, number>
  rowHeights: Map<number, number>
  tabColor: string | null
}

// ---- Workbook ----

export interface Workbook {
  id: string
  name: string
  sheets: Sheet[]
  activeSheetId: string
}

// ---- 选区 ----

export interface CellRange {
  startRef: CellRef
  endRef: CellRef
}
