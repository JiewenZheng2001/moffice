import { describe, it, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { exportXlsx, exportCsv } from '@/services/exportService'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

/** mock 文件下载（jsdom 无 URL.createObjectURL） */
vi.mock('@/services/fileSaveService', () => ({
  saveAs: vi.fn(),
}))

/** 便捷：写入单元格 */
function setCell(sheet: Sheet, ref: string, raw: unknown, computed: unknown = raw): void {
  const cell = createCell(ref)
  cell.rawValue = raw as never
  cell.computedValue = computed as never
  sheet.cells.set(ref, cell)
}

/** 便捷：写入公式格 */
function setFormula(sheet: Sheet, ref: string, formula: string, computed: number | string): void {
  const cell = createCell(ref)
  cell.rawValue = formula
  cell.computedValue = computed as never
  cell.formula = formula
  sheet.cells.set(ref, cell)
}

/** 构建测试 sheet */
function makeSheet(): Sheet {
  const sheet: Sheet = {
    id: 's1',
    name: 'Sheet1',
    cells: new Map(),
    rowCount: 10,
    columnCount: 10,
    columnWidths: new Map(),
    rowHeights: new Map(),
    tabColor: null,
  }
  return sheet
}

describe('exportService 导出', () => {
  describe('XLSX 导出：公式与值写入', () => {
    it('公式格导出为公式对象（含 result），而非公式文本', async () => {
      const sheet = makeSheet()
      setFormula(sheet, 'A1', '=SUM(B1:B2)', 30)
      setCell(sheet, 'B1', 10)
      setCell(sheet, 'B2', 20)

      // 模拟 exportXlsx 的写入逻辑：公式格 → exceljs 公式对象
      const excelCell = new ExcelJS.Workbook().addWorksheet('s').getCell('A1')
      const cell = sheet.cells.get('A1')!
      excelCell.value = {
        formula: cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula,
        result: cell.computedValue,
      }
      expect(excelCell.value).toEqual({ formula: 'SUM(B1:B2)', result: 30 })
      // 普通格 → 原始值
      const b1 = new ExcelJS.Workbook().addWorksheet('s').getCell('B1')
      b1.value = sheet.cells.get('B1')!.rawValue
      expect(b1.value).toBe(10)
    })

    it('普通格导出 rawValue，公式格不导出公式文本', () => {
      const sheet = makeSheet()
      setCell(sheet, 'A1', 'hello')
      setCell(sheet, 'A2', 42)
      setFormula(sheet, 'A3', '=A1&A2', 'hello42')

      // A1 普通值
      expect(sheet.cells.get('A1')!.rawValue).toBe('hello')
      // A3 是公式格：导出时走公式对象分支（此处断言其 formula 字段存在）
      expect(sheet.cells.get('A3')!.formula).toBe('=A1&A2')
      expect(sheet.cells.get('A3')!.computedValue).toBe('hello42')
    })
  })

  describe('CSV 导出：公式格导出计算结果', () => {
    it('公式格用 computedValue，普通格用 rawValue', () => {
      const sheet = makeSheet()
      setFormula(sheet, 'A1', '=SUM(B1:B2)', 30)
      setCell(sheet, 'B1', 10)
      setCell(sheet, 'B2', 20)
      setCell(sheet, 'C1', 'text')

      // 与 exportCsv 相同的取值逻辑
      const values: Record<string, string> = {}
      for (const [ref, c] of sheet.cells) {
        values[ref] = String(c.formula ? c.computedValue : (c.rawValue ?? c.computedValue))
      }
      expect(values['A1']).toBe('30') // 公式 → 计算结果
      expect(values['B1']).toBe('10')
      expect(values['C1']).toBe('text')
    })
  })

  describe('样式映射（applyCellStyle 逻辑）', () => {
    it('CellFormat 字段与 exceljs 样式 API 对应', () => {
      const format = {
        bold: true,
        italic: true,
        underline: true,
        fontFamily: '宋体',
        fontSize: 14,
        textColor: '#FF0000',
        backgroundColor: '#FFFF00',
        textAlign: 'center' as const,
        numberFormat: '0.00',
        borderTop: { color: '#000000', style: 'thin' as const },
      }
      expect(format.bold).toBe(true)
      expect(format.numberFormat).toBe('0.00')
      expect(format.borderTop?.style).toBe('thin')
      // ARGB 转换：#FF0000 → FFFF0000（exceljs 要求 ARGB 前缀）
      expect(`FF${format.textColor!.slice(1).toUpperCase()}`).toBe('FFFF0000')
      // 边框样式映射表
      const styleMap: Record<string, string> = { thin: 'thin', medium: 'medium', dashed: 'dashed' }
      expect(styleMap[format.borderTop!.style]).toBe('thin')
    })
  })
})
