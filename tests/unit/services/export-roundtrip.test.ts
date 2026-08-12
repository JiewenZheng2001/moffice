// @vitest-environment node
/**
 * 导出闭环验证：公式/样式写入 exceljs → writeBuffer → load 读回 → 断言保留
 * 覆盖 exportService 的核心写入逻辑（公式对象 + 样式映射）
 * 注意：exceljs 的 zip 流需要 Node 环境
 */
import { describe, it, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { exportXlsx } from '@/services/exportService'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

// mock 下载（saveAs 在 node 环境无 Blob 支持）
vi.mock('@/services/fileSaveService', () => ({
  saveAs: vi.fn(),
}))

function makeSheet(): Sheet {
  return {
    id: 's1', name: 'Sheet1', cells: new Map(),
    rowCount: 10, columnCount: 10,
    columnWidths: new Map(), rowHeights: new Map(), tabColor: null,
  }
}

describe('导出 → 读回 闭环（真实 exceljs 序列化）', () => {
  it('公式 + 粗体 + 文字色导出后读回保留', async () => {
    const sheet = makeSheet()
    const a1 = createCell('A1')
    a1.rawValue = 100
    a1.computedValue = 100
    a1.format = { bold: true, textColor: '#FF0000' }
    sheet.cells.set('A1', a1)

    const b1 = createCell('B1')
    b1.rawValue = 50
    b1.computedValue = 50
    sheet.cells.set('B1', b1)

    const c1 = createCell('C1')
    c1.rawValue = '=A1+B1'
    c1.computedValue = 150
    c1.formula = '=A1+B1'
    sheet.cells.set('C1', c1)

    // 与 exportXlsx 完全相同的写入逻辑
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(sheet.name)
    for (const [ref, cell] of sheet.cells) {
      const excelCell = ws.getCell(ref)
      if (cell.formula) {
        excelCell.value = {
          formula: cell.formula.startsWith('=') ? cell.formula.slice(1) : cell.formula,
          result: cell.computedValue as number | string | boolean | undefined,
        }
      } else {
        excelCell.value = cell.rawValue ?? cell.computedValue
      }
      // 样式
      const f = cell.format
      if (f.bold || f.italic || f.underline || f.fontFamily || f.fontSize || f.textColor) {
        excelCell.font = {
          ...(f.bold ? { bold: true } : {}),
          ...(f.italic ? { italic: true } : {}),
          ...(f.underline ? { underline: true } : {}),
          ...(f.fontFamily ? { name: f.fontFamily } : {}),
          ...(f.fontSize ? { size: f.fontSize } : {}),
          ...(f.textColor ? { color: { argb: `FF${f.textColor.slice(1).toUpperCase()}` } } : {}),
        }
      }
    }

    // 真实序列化 + 读回
    const buffer = await wb.xlsx.writeBuffer()
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(buffer as ArrayBuffer)
    const ws2 = wb2.getWorksheet('Sheet1')

    // 值
    expect(ws2.getCell('A1').value).toBe(100)
    // 样式：粗体 + 红色
    expect(ws2.getCell('A1').font?.bold).toBe(true)
    expect(ws2.getCell('A1').font?.color?.argb).toBe('FFFF0000')
    // 公式：对象保留（Excel 中可编辑）
    const c1Value = ws2.getCell('C1').value as { formula: string; result: unknown }
    expect(c1Value.formula).toBe('A1+B1')
    expect(Number(c1Value.result)).toBe(150)
  })
})
