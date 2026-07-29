import ExcelJS from 'exceljs'
import type { Sheet, CellValue } from '@/model/types'
import { createCell } from '@/model/cell'

/**
 * 文件导入服务 —— 从 XLSX / CSV 文件读取数据填充到 Workbook
 */

export interface ImportResult {
  sheets: ImportedSheet[]
}

interface ImportedSheet {
  name: string
  cells: Map<string, CellValue>
  columnWidths: Map<number, number>
}

/** 导入 XLSX 文件 */
export async function importXlsx(file: File): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)

  const sheets: ImportedSheet[] = []

  workbook.eachSheet((ws, id) => {
    const cells = new Map<string, CellValue>()
    const columnWidths = new Map<number, number>()

    ws.eachRow((row, rowNum) => {
      row.eachCell((cell, colNum) => {
        const ref = `${colToLetter(colNum - 1)}${rowNum}`
        let val: CellValue = null

        if (cell.value !== null && cell.value !== undefined) {
          if (typeof cell.value === 'number' || typeof cell.value === 'string' || typeof cell.value === 'boolean') {
            val = cell.value
          } else if (typeof cell.value === 'object' && 'result' in cell.value) {
            // 公式结果
            val = cell.value.result as CellValue
          } else {
            val = String(cell.value)
          }
        }

        if (val !== null && val !== '') {
          cells.set(ref, val)
        }
      })
    })

    // 读取列宽
    for (let c = 1; c <= ws.columnCount; c++) {
      const col = ws.getColumn(c)
      if (col && col.width) {
        columnWidths.set(c - 1, Math.round(col.width * 7)) // excel units → px
      }
    }

    sheets.push({ name: ws.name || `Sheet${id}`, cells, columnWidths })
  })

  return { sheets }
}

/** 导入 CSV 文件 */
export async function importCsv(file: File): Promise<ImportResult> {
  const { default: Papa } = await import('papaparse')

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete(results) {
        const cells = new Map<string, CellValue>()
        const data = results.data as string[][]

        for (let r = 0; r < data.length; r++) {
          const row = data[r]
          for (let c = 0; c < row.length; c++) {
            const val = row[c].trim()
            if (val !== '') {
              const ref = `${colToLetter(c)}${r + 1}`
              // 自动转换数值
              const num = parseFloat(val)
              cells.set(ref, isNaN(num) ? val : num)
            }
          }
        }

        resolve({ sheets: [{ name: 'Sheet1', cells, columnWidths: new Map() }] })
      },
      error(err) {
        reject(err)
      },
    })
  })
}

/** 将导入结果应用到 Sheet */
export function applyImport(sheet: Sheet, imported: ImportedSheet): void {
  // 清空现有数据
  sheet.cells.clear()

  // 写入导入数据
  for (const [ref, val] of imported.cells) {
    const cell = createCell(ref)
    cell.rawValue = val
    cell.computedValue = val
    sheet.cells.set(ref, cell)
  }

  // 应用列宽
  for (const [col, width] of imported.columnWidths) {
    sheet.columnWidths.set(col, width)
  }

  // 调整行列数
  let maxRow = 0, maxCol = 0
  for (const ref of imported.cells.keys()) {
    const m = ref.match(/^([A-Z]+)(\d+)$/i)
    if (!m) continue
    const col = colToIndex(m[1])
    const row = parseInt(m[2], 10) - 1
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)
  }
  if (maxRow >= sheet.rowCount) sheet.rowCount = maxRow + 20
  if (maxCol >= sheet.columnCount) sheet.columnCount = maxCol + 5
}

// ---- 辅助 ----

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
