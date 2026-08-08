import { describe, it, expect } from 'vitest'
import { serializeWorkbook, deserializeWorkbook } from '@/model/serialization'
import { createWorkbook } from '@/model/workbook'
import { createCell } from '@/model/cell'

describe('serialization Map 往返', () => {
  it('cells / columnWidths / rowHeights 序列化后内容不丢', () => {
    const wb = createWorkbook('测试')
    const sheet = wb.sheets[0]
    // 写入单元格 + 自定义宽高
    const cell = createCell('A1')
    cell.rawValue = 42
    cell.computedValue = 42
    cell.format = { bold: true }
    sheet.cells.set('A1', cell)
    sheet.columnWidths.set(0, 150)
    sheet.rowHeights.set(2, 40)

    // 往返
    const restored = deserializeWorkbook(serializeWorkbook(wb))

    expect(restored.id).toBe(wb.id)
    expect(restored.name).toBe('测试')
    expect(restored.sheets).toHaveLength(1)

    const rs = restored.sheets[0]
    // Map 还原
    expect(rs.cells).toBeInstanceOf(Map)
    expect(rs.columnWidths).toBeInstanceOf(Map)
    expect(rs.rowHeights).toBeInstanceOf(Map)
    // 单元格内容
    expect(rs.cells.get('A1')?.rawValue).toBe(42)
    expect(rs.cells.get('A1')?.format.bold).toBe(true)
    // 宽高
    expect(rs.columnWidths.get(0)).toBe(150)
    expect(rs.rowHeights.get(2)).toBe(40)
  })

  it('空工作簿往返不变', () => {
    const wb = createWorkbook()
    const restored = deserializeWorkbook(serializeWorkbook(wb))
    expect(restored.sheets[0].cells.size).toBe(0)
    expect(restored.sheets[0].columnWidths.size).toBe(0)
  })

  it('多 sheet 往返', () => {
    const wb = createWorkbook()
    // 手动加第二个 sheet
    const s2 = wb.sheets[0]
    const cell = createCell('B2')
    cell.rawValue = 'x'
    cell.computedValue = 'x'
    s2.cells.set('B2', cell)
    const restored = deserializeWorkbook(serializeWorkbook(wb))
    expect(restored.sheets[0].cells.get('B2')?.rawValue).toBe('x')
  })

  it('列宽数字索引 key 还原为 number', () => {
    const wb = createWorkbook()
    wb.sheets[0].columnWidths.set(26, 200) // AA 列
    const restored = deserializeWorkbook(serializeWorkbook(wb))
    // 若 key 未转回 number，get(26) 会返回 undefined
    expect(restored.sheets[0].columnWidths.get(26)).toBe(200)
  })

  it('非法 JSON 抛错', () => {
    expect(() => deserializeWorkbook('not json')).toThrow()
  })
})
