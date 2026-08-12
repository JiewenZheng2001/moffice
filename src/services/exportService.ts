import ExcelJS from 'exceljs'
import { saveAs } from './fileSaveService'
import type { Cell, CellFormat, Sheet } from '@/model/types'
import { parseRef } from '@/utils/columnUtils'

/**
 * 文件导出服务 —— 将当前 Workbook 导出为 XLSX / CSV 文件
 *
 * 导出规则（与 Excel 行为对齐）：
 * - 公式格：导出为 exceljs 公式对象 { formula, result }（Excel 中可继续编辑公式）
 * - 样式格：映射 font/fill/alignment/border/numFmt（CSV 无样式能力，仅导出值）
 */

/** 边框样式 → exceljs border style（enum） */
const BORDER_STYLES: Record<string, 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'> = {
  thin: 'thin',
  medium: 'medium',
  thick: 'thick',
  dashed: 'dashed',
  dotted: 'dotted',
  double: 'double',
}

/** 应用单元格样式到 exceljs 单元格（映射 CellFormat → exceljs 样式字段） */
function applyCellStyle(excelCell: ExcelJS.Cell, format: CellFormat): void {
  // ---- 字体 ----
  if (format.bold || format.italic || format.underline || format.fontFamily || format.fontSize || format.textColor) {
    excelCell.font = {
      ...(format.bold ? { bold: true } : {}),
      ...(format.italic ? { italic: true } : {}),
      ...(format.underline ? { underline: true } : {}),
      ...(format.fontFamily ? { name: format.fontFamily } : {}),
      ...(format.fontSize ? { size: format.fontSize } : {}),
      ...(format.textColor ? { color: { argb: hexToArgb(format.textColor) } } : {}),
    }
  }

  // ---- 背景色 ----
  if (format.backgroundColor) {
    excelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: hexToArgb(format.backgroundColor) },
    }
  }

  // ---- 对齐 ----
  if (format.textAlign || format.verticalAlign) {
    excelCell.alignment = {
      ...(format.textAlign ? { horizontal: format.textAlign } : {}),
      ...(format.verticalAlign ? { vertical: format.verticalAlign } : {}),
    }
  }

  // ---- 边框 ----
  let hasBorder = false
  const borderObj: Partial<Record<'top' | 'bottom' | 'left' | 'right', { style: string; color: { argb: string } }>> = {}
  const borderKeys = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'] as const
  const borderEdges = { borderTop: 'top', borderBottom: 'bottom', borderLeft: 'left', borderRight: 'right' } as const
  for (const key of borderKeys) {
    const b = format[key]
    if (b) {
      hasBorder = true
      borderObj[borderEdges[key]] = {
        style: BORDER_STYLES[b.style] ?? 'thin',
        color: { argb: hexToArgb(b.color) },
      }
    }
  }
  if (hasBorder) {
    excelCell.border = borderObj as ExcelJS.Borders
  }

  // ---- 数字格式 ----
  if (format.numberFormat && format.numberFormat !== 'General') {
    excelCell.numFmt = format.numberFormat
  }
}

/** "#RRGGBB" → "FFRRGGBB"（exceljs 用 ARGB，需要 alpha 前缀） */
function hexToArgb(hex: string): string {
  const h = hex.replace('#', '')
  return h.length === 6 ? `FF${h.toUpperCase()}` : h.toUpperCase()
}

/**
 * 导出为 XLSX 格式（基于 exceljs）
 * 支持：值 / 公式 / 样式（字体、背景、对齐、边框、数字格式）/ 列宽
 */
export async function exportXlsx(sheets: Sheet[], filename = 'spreadsheet.xlsx'): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name || 'Sheet1')

    // 收集所有有内容的单元格
    const entries = [...sheet.cells.entries()]

    // 构建行列数据
    const matrix = new Map<number, Map<number, Cell>>() // row → (col → Cell)
    for (const [ref, cell] of entries) {
      const parsed = parseRef(ref)
      if (!parsed) continue
      if (!matrix.has(parsed.row)) matrix.set(parsed.row, new Map())
      matrix.get(parsed.row)!.set(parsed.col, cell)
    }

    // 找到最大行列
    let maxRow = 0
    let maxCol = 0
    for (const [row, cols] of matrix) {
      maxRow = Math.max(maxRow, row)
      for (const col of cols.keys()) {
        maxCol = Math.max(maxCol, col)
      }
    }

    // 写入单元格（值 / 公式 / 样式）
    for (let r = 0; r <= maxRow; r++) {
      const rowData = matrix.get(r)
      if (!rowData) continue
      for (let c = 0; c <= maxCol; c++) {
        const cell = rowData.get(c)
        if (!cell) continue

        const excelCell = ws.getCell(r + 1, c + 1)
        if (cell.formula) {
          // 公式格：导出公式对象（去掉 "=" 前缀），Excel 打开后可继续编辑
          excelCell.value = {
            formula: cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula,
            result: cell.computedValue as number | string | boolean | undefined,
          }
        } else {
          excelCell.value = cell.rawValue ?? cell.computedValue
        }
        // 样式（含公式格的样式同样导出）
        applyCellStyle(excelCell, cell.format)
      }
    }

    // 设置列宽
    for (let c = 0; c <= maxCol; c++) {
      const w = sheet.columnWidths.get(c)
      if (w) {
        ws.getColumn(c + 1).width = w / 7 // px → excel character units
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(new Blob([buffer]), filename)
}

/** 导出为 CSV 格式（基于 papaparse）
 * CSV 是纯文本格式，无法携带样式；公式格导出计算结果（而非公式文本）
 */
export async function exportCsv(sheet: Sheet, filename = 'spreadsheet.csv'): Promise<void> {
  const { default: Papa } = await import('papaparse')

  const entries = [...sheet.cells.entries()]
  const rowMap = new Map<number, Map<number, string>>()

  for (const [ref, cell] of entries) {
    const parsed = parseRef(ref)
    if (!parsed) continue
    if (!rowMap.has(parsed.row)) rowMap.set(parsed.row, new Map())
    // 公式格 → 导出计算结果；普通格 → 导出原始值
    const val = cell.formula
      ? cell.computedValue
      : (cell.rawValue ?? cell.computedValue)
    rowMap.get(parsed.row)!.set(parsed.col, String(val ?? ''))
  }

  // 找最大行列
  let maxRow = 0, maxCol = 0
  for (const [r, cols] of rowMap) {
    maxRow = Math.max(maxRow, r)
    for (const c of cols.keys()) maxCol = Math.max(maxCol, c)
  }

  // 构建二维数组
  const data: string[][] = []
  for (let r = 0; r <= maxRow; r++) {
    const row: string[] = []
    for (let c = 0; c <= maxCol; c++) {
      row.push(rowMap.get(r)?.get(c) ?? '')
    }
    data.push(row)
  }

  const csv = Papa.unparse(data)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }) // BOM for Excel
  saveAs(blob, filename)
}
