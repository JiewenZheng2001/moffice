import ExcelJS from 'exceljs'
import { saveAs } from './fileSaveService'
import type { Sheet } from '@/model/types'
import { parseRef } from '@/utils/columnUtils'

/**
 * 文件导出服务 —— 将当前 Workbook 导出为 XLSX / CSV 文件
 */

/** 导出为 XLSX 格式（基于 exceljs） */
export async function exportXlsx(sheets: Sheet[], filename = 'spreadsheet.xlsx'): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name || 'Sheet1')

    // 收集所有有内容的单元格
    const entries = [...sheet.cells.entries()]

    // 构建行列数据
    const matrix = new Map<number, Map<number, any>>() // row → (col → value)
    for (const [ref, cell] of entries) {
      const parsed = parseRef(ref)
      if (!parsed) continue
      if (!matrix.has(parsed.row)) matrix.set(parsed.row, new Map())
      matrix.get(parsed.row)!.set(parsed.col, cell.rawValue ?? cell.computedValue)
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

    // 写入单元格
    for (let r = 0; r <= maxRow; r++) {
      const rowData = matrix.get(r)
      if (!rowData) continue
      for (let c = 0; c <= maxCol; c++) {
        const val = rowData.get(c)
        if (val !== undefined && val !== null) {
          ws.getCell(r + 1, c + 1).value = val
        }
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

/** 导出为 CSV 格式（基于 papaparse） */
export async function exportCsv(sheet: Sheet, filename = 'spreadsheet.csv'): Promise<void> {
  const { default: Papa } = await import('papaparse')

  const entries = [...sheet.cells.entries()]
  const rowMap = new Map<number, Map<number, string>>()

  for (const [ref, cell] of entries) {
    const parsed = parseRef(ref)
    if (!parsed) continue
    if (!rowMap.has(parsed.row)) rowMap.set(parsed.row, new Map())
    rowMap.get(parsed.row)!.set(parsed.col, String(cell.rawValue ?? cell.computedValue ?? ''))
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
