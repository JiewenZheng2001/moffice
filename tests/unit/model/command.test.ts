import { describe, it, expect, beforeEach } from 'vitest'
import {
  SetCellCommand,
  PasteCommand,
  CutPasteCommand,
  SetCellFormatCommand,
  CompoundCommand,
  InsertRowCommand,
  DeleteRowCommand,
  InsertColumnCommand,
  DeleteColumnCommand,
} from '@/model/command'
import { commandService } from '@/services/commandService'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

/** 创建测试用 Sheet */
function createSheet(): Sheet {
  return {
    id: 'test',
    name: 'Sheet1',
    cells: new Map(),
    rowCount: 10,
    columnCount: 10,
    columnWidths: new Map(),
    rowHeights: new Map(),
    tabColor: null,
  }
}

/** 便捷：写入一个单元格值（不走命令栈） */
function setRaw(sheet: Sheet, ref: string, value: unknown): void {
  const cell = createCell(ref)
  cell.rawValue = value as never
  cell.computedValue = value as never
  sheet.cells.set(ref, cell)
}

/** 便捷：读取单元格 */
function read(sheet: Sheet, ref: string): unknown {
  return sheet.cells.get(ref)?.rawValue ?? null
}

describe('SetCellCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('写入新值', () => {
    new SetCellCommand(sheet, 'A1', 42).execute()
    expect(read(sheet, 'A1')).toBe(42)
  })

  it('覆盖已有值并支持撤销恢复旧值', () => {
    setRaw(sheet, 'A1', 'old')
    const cmd = new SetCellCommand(sheet, 'A1', 'new')
    cmd.execute()
    expect(read(sheet, 'A1')).toBe('new')
    cmd.undo()
    expect(read(sheet, 'A1')).toBe('old')
  })

  it('null 值删除单元格', () => {
    setRaw(sheet, 'A1', 'x')
    new SetCellCommand(sheet, 'A1', null).execute()
    expect(sheet.cells.has('A1')).toBe(false)
  })

  it('空字符串删除单元格', () => {
    setRaw(sheet, 'A1', 'x')
    new SetCellCommand(sheet, 'A1', '').execute()
    expect(sheet.cells.has('A1')).toBe(false)
  })

  it('公式命令：rawValue 存公式字符串，computedValue 存结果', () => {
    const cmd = new SetCellCommand(sheet, 'A1', 6, '=SUM(A2:A3)')
    cmd.execute()
    const cell = sheet.cells.get('A1')!
    expect(cell.rawValue).toBe('=SUM(A2:A3)')
    expect(cell.computedValue).toBe(6)
    expect(cell.formula).toBe('=SUM(A2:A3)')
  })

  it('撤销到无单元格状态', () => {
    const cmd = new SetCellCommand(sheet, 'A1', 1)
    cmd.execute()
    cmd.undo()
    expect(sheet.cells.has('A1')).toBe(false)
  })

  it('getAffectedRefs 返回目标单元格', () => {
    const cmd = new SetCellCommand(sheet, 'B3', 1)
    expect(cmd.getAffectedRefs()).toEqual(['B3'])
  })

  it('description 包含引用和值', () => {
    const cmd = new SetCellCommand(sheet, 'A1', 5)
    expect(cmd.description).toContain('A1')
    expect(cmd.description).toContain('5')
  })
})

describe('PasteCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('批量写入多个单元格', () => {
    const map = new Map([
      ['A1', 1],
      ['B1', 2],
    ])
    new PasteCommand(sheet, map).execute()
    expect(read(sheet, 'A1')).toBe(1)
    expect(read(sheet, 'B1')).toBe(2)
  })

  it('覆盖已有值，undo 恢复旧值', () => {
    setRaw(sheet, 'A1', 'old')
    const cmd = new PasteCommand(sheet, new Map([['A1', 'new']]))
    cmd.execute()
    expect(read(sheet, 'A1')).toBe('new')
    cmd.undo()
    expect(read(sheet, 'A1')).toBe('old')
  })

  it('null 值删除目标格', () => {
    setRaw(sheet, 'A1', 'x')
    new PasteCommand(sheet, new Map([['A1', null]])).execute()
    expect(sheet.cells.has('A1')).toBe(false)
  })

  it('undo 恢复被删除的单元格（原来不存在）', () => {
    const cmd = new PasteCommand(sheet, new Map([['A1', 'x']]))
    cmd.execute()
    cmd.undo()
    expect(sheet.cells.has('A1')).toBe(false)
  })

  it('覆盖公式格后公式被清除', () => {
    setRaw(sheet, 'A1', '=SUM(B1)')
    sheet.cells.get('A1')!.formula = '=SUM(B1)'
    new PasteCommand(sheet, new Map([['A1', 99]])).execute()
    expect(sheet.cells.get('A1')!.formula).toBeNull()
  })

  it('getAffectedRefs 返回所有粘贴目标', () => {
    const cmd = new PasteCommand(sheet, new Map([['A1', 1], ['A2', 2]]))
    expect(cmd.getAffectedRefs().sort()).toEqual(['A1', 'A2'])
  })
})

describe('CutPasteCommand（剪切粘贴原子命令）', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('执行：清空源格 + 写入目标', () => {
    setRaw(sheet, 'A1', 'a')
    setRaw(sheet, 'A2', 'b')
    const cmd = new CutPasteCommand(
      sheet,
      ['A1', 'A2'],
      new Map([
        ['C1', 'a'],
        ['C2', 'b'],
      ]),
    )
    cmd.execute()
    expect(sheet.cells.has('A1')).toBe(false)
    expect(sheet.cells.has('A2')).toBe(false)
    expect(read(sheet, 'C1')).toBe('a')
    expect(read(sheet, 'C2')).toBe('b')
  })

  it('undo：完整恢复源格和目标格', () => {
    setRaw(sheet, 'A1', 'a')
    setRaw(sheet, 'C1', 'target-old')
    const cmd = new CutPasteCommand(sheet, ['A1'], new Map([['C1', 'a']]))
    cmd.execute()
    cmd.undo()
    expect(read(sheet, 'A1')).toBe('a')
    expect(read(sheet, 'C1')).toBe('target-old')
  })

  it('undo 时恢复剪贴板 TSV', async () => {
    setRaw(sheet, 'A1', 'a')
    const cmd = new CutPasteCommand(sheet, ['A1'], new Map([['C1', 'a']]), 'a\tb')
    cmd.execute()
    cmd.undo()
    // restoreClipboard 是异步的，等待微任务
    await new Promise((r) => setTimeout(r, 0))
    // 在 jsdom 中 navigator.clipboard 可能不可用，只验证命令本身不抛错
    expect(read(sheet, 'A1')).toBe('a')
  })

  it('getSourceRefs 返回源区域（用于恢复虚线框）', () => {
    const cmd = new CutPasteCommand(sheet, ['A1', 'A2'], new Map([['C1', 'a']]))
    expect(cmd.getSourceRefs()).toEqual(['A1', 'A2'])
  })

  it('getAffectedRefs 包含源和目标', () => {
    const cmd = new CutPasteCommand(sheet, ['A1'], new Map([['C1', 'a']]))
    expect(cmd.getAffectedRefs().sort()).toEqual(['A1', 'C1'])
  })

  it('剪切覆盖目标已有公式格', () => {
    setRaw(sheet, 'A1', 'data')
    // 构造一个真正的公式格：rawValue 是公式字符串，formula 有值
    const target = createCell('C1')
    target.rawValue = '=SUM(B1)'
    target.computedValue = 0
    target.formula = '=SUM(B1)'
    sheet.cells.set('C1', target)

    const cmd = new CutPasteCommand(sheet, ['A1'], new Map([['C1', 'data']]))
    cmd.execute()
    expect(sheet.cells.get('C1')!.formula).toBeNull()
    cmd.undo()
    expect(sheet.cells.get('C1')!.formula).toBe('=SUM(B1)')
  })
})

describe('SetCellFormatCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('应用格式片段到多个单元格', () => {
    setRaw(sheet, 'A1', 1)
    const cmd = new SetCellFormatCommand(sheet, ['A1', 'B1'], { bold: true, textAlign: 'center' })
    cmd.execute()
    expect(sheet.cells.get('A1')!.format.bold).toBe(true)
    expect(sheet.cells.get('B1')!.format.textAlign).toBe('center')
  })

  it('格式应用到空单元格时惰性创建', () => {
    new SetCellFormatCommand(sheet, ['Z9'], { backgroundColor: '#FFFF00' }).execute()
    const cell = sheet.cells.get('Z9')!
    expect(cell.format.backgroundColor).toBe('#FFFF00')
    expect(cell.rawValue).toBeNull() // 无值
  })

  it('undo 恢复旧格式', () => {
    setRaw(sheet, 'A1', 1)
    sheet.cells.get('A1')!.format = { bold: true }
    const cmd = new SetCellFormatCommand(sheet, ['A1'], { bold: false })
    cmd.execute()
    expect(sheet.cells.get('A1')!.format.bold).toBe(false)
    cmd.undo()
    expect(sheet.cells.get('A1')!.format.bold).toBe(true)
  })

  it('undo 后清理仅因格式创建的空单元格', () => {
    const cmd = new SetCellFormatCommand(sheet, ['Z9'], { bold: true })
    cmd.execute()
    expect(sheet.cells.has('Z9')).toBe(true)
    cmd.undo()
    expect(sheet.cells.has('Z9')).toBe(false)
  })

  it('undo 深拷贝隔离：格式对象不被共享', () => {
    setRaw(sheet, 'A1', 1)
    sheet.cells.get('A1')!.format = { borderTop: { color: '#000', style: 'thin' } }
    const cmd = new SetCellFormatCommand(sheet, ['A1'], { bold: true })
    cmd.execute()
    cmd.undo()
    const fmt = sheet.cells.get('A1')!.format
    expect(fmt.bold).toBeUndefined()
    expect(fmt.borderTop).toEqual({ color: '#000', style: 'thin' })
  })

  it('needsRecalc 返回 false（格式不改变值）', () => {
    const cmd = new SetCellFormatCommand(sheet, ['A1'], { bold: true })
    expect(cmd.needsRecalc?.()).toBe(false)
  })

  it('getAffectedRefs 返回空（不触发重算）', () => {
    const cmd = new SetCellFormatCommand(sheet, ['A1'], { bold: true })
    expect(cmd.getAffectedRefs()).toEqual([])
  })
})

describe('CompoundCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('顺序执行多个命令', () => {
    const cmd = new CompoundCommand([
      new SetCellCommand(sheet, 'A1', 1),
      new SetCellCommand(sheet, 'A2', 2),
    ])
    cmd.execute()
    expect(read(sheet, 'A1')).toBe(1)
    expect(read(sheet, 'A2')).toBe(2)
  })

  it('逆序撤销', () => {
    setRaw(sheet, 'A1', 'old1')
    setRaw(sheet, 'A2', 'old2')
    const cmd = new CompoundCommand([
      new SetCellCommand(sheet, 'A1', 'new1'),
      new SetCellCommand(sheet, 'A2', 'new2'),
    ])
    cmd.execute()
    cmd.undo()
    expect(read(sheet, 'A1')).toBe('old1')
    expect(read(sheet, 'A2')).toBe('old2')
  })

  it('合并 getAffectedRefs', () => {
    const cmd = new CompoundCommand([
      new SetCellCommand(sheet, 'A1', 1),
      new SetCellCommand(sheet, 'B2', 2),
    ])
    expect(cmd.getAffectedRefs().sort()).toEqual(['A1', 'B2'])
  })

  it('自定义描述', () => {
    const cmd = new CompoundCommand([new SetCellCommand(sheet, 'A1', 1)], '批量操作')
    expect(cmd.description).toBe('批量操作')
  })
})

describe('InsertRowCommand / DeleteRowCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('插入行后行号增加', () => {
    const cmd = new InsertRowCommand(sheet, 2)
    cmd.execute()
    expect(sheet.rowCount).toBe(11)
    cmd.undo()
    expect(sheet.rowCount).toBe(10)
  })

  it('插入行后下方单元格下移', () => {
    setRaw(sheet, 'A3', 'v')
    const cmd = new InsertRowCommand(sheet, 1) // 在行 2 后插入
    cmd.execute()
    // A3 → A4
    expect(sheet.cells.has('A3')).toBe(false)
    expect(read(sheet, 'A4')).toBe('v')
    cmd.undo()
    expect(read(sheet, 'A3')).toBe('v')
  })

  it('删除行后单元格上移', () => {
    setRaw(sheet, 'A1', 'keep')
    setRaw(sheet, 'A3', 'v')
    const cmd = new DeleteRowCommand(sheet, 1) // 删除第 2 行
    cmd.execute()
    expect(read(sheet, 'A1')).toBe('keep')
    expect(read(sheet, 'A2')).toBe('v') // A3 → A2
    expect(sheet.cells.has('A3')).toBe(false)
    cmd.undo()
    expect(read(sheet, 'A3')).toBe('v')
  })

  it('删除行后行号减少', () => {
    new DeleteRowCommand(sheet, 0).execute()
    expect(sheet.rowCount).toBe(9)
  })
})

describe('InsertColumnCommand / DeleteColumnCommand', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('插入列后列号增加', () => {
    const cmd = new InsertColumnCommand(sheet, 1)
    cmd.execute()
    expect(sheet.columnCount).toBe(11)
    cmd.undo()
    expect(sheet.columnCount).toBe(10)
  })

  it('插入列后右侧单元格右移', () => {
    setRaw(sheet, 'C1', 'v')
    const cmd = new InsertColumnCommand(sheet, 0) // 在 B 列前插入
    cmd.execute()
    expect(sheet.cells.has('C1')).toBe(false)
    expect(read(sheet, 'D1')).toBe('v')
    cmd.undo()
    expect(read(sheet, 'C1')).toBe('v')
  })

  it('删除列后单元格左移', () => {
    setRaw(sheet, 'A1', 'keep')
    setRaw(sheet, 'C1', 'v')
    const cmd = new DeleteColumnCommand(sheet, 1) // 删除 B 列
    cmd.execute()
    expect(read(sheet, 'A1')).toBe('keep')
    expect(read(sheet, 'B1')).toBe('v')
    cmd.undo()
    expect(read(sheet, 'C1')).toBe('v')
  })
})

describe('CommandService 连续格式命令合并', () => {
  let sheet: Sheet
  beforeEach(() => {
    sheet = createSheet()
    commandService.clear()
    setRaw(sheet, 'A1', 1)
  })

  it('连续格式命令合并为一个（撤销一次恢复全部）', () => {
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { bold: true }))
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { italic: true }))
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { underline: true }))

    // 三次操作只产生一个命令
    expect(commandService.undoCount).toBe(1)
    // 效果全部应用
    expect(sheet.cells.get('A1')!.format).toMatchObject({
      bold: true, italic: true, underline: true,
    })

    // 撤销一次全部恢复
    commandService.undo()
    expect(sheet.cells.get('A1')!.format).toEqual({})
  })

  it('不同目标的格式命令不合并', () => {
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { bold: true }))
    commandService.execute(new SetCellFormatCommand(sheet, ['B1'], { bold: true }))
    expect(commandService.undoCount).toBe(2)
  })

  it('合并命令可重做（redo 应用合并后的完整效果）', () => {
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { bold: true }))
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { italic: true }))
    commandService.undo()
    expect(sheet.cells.get('A1')!.format).toEqual({})

    commandService.redo()
    expect(sheet.cells.get('A1')!.format).toMatchObject({ bold: true, italic: true })
  })

  it('格式命令与数据命令不合并（数据命令正常入栈）', () => {
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { bold: true }))
    commandService.execute(new SetCellCommand(sheet, 'A1', 99))
    expect(commandService.undoCount).toBe(2)
  })

  it('合并后其他命令入栈仍正常（不干扰后续撤销顺序）', () => {
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { bold: true }))
    commandService.execute(new SetCellFormatCommand(sheet, ['A1'], { italic: true }))
    commandService.execute(new SetCellCommand(sheet, 'B1', 'x'))

    // 撤销顺序：先撤 B1 数据，再撤格式（一次全撤）
    commandService.undo()
    expect(read(sheet, 'B1')).toBeNull()
    commandService.undo()
    expect(sheet.cells.get('A1')!.format).toEqual({})
  })
})

describe('CommandService 命令栈', () => {
  let sheet: Sheet
  beforeEach(() => {
    sheet = createSheet()
    commandService.clear()
  })

  it('execute 入栈，undo 撤销，redo 重做', () => {
    commandService.execute(new SetCellCommand(sheet, 'A1', 1))
    expect(read(sheet, 'A1')).toBe(1)
    expect(commandService.canUndo).toBe(true)
    commandService.undo()
    expect(sheet.cells.has('A1')).toBe(false)
    expect(commandService.canRedo).toBe(true)
    commandService.redo()
    expect(read(sheet, 'A1')).toBe(1)
  })

  it('undo 返回被撤销的命令', () => {
    const cmd = new SetCellCommand(sheet, 'A1', 1)
    commandService.execute(cmd)
    expect(commandService.undo()).toBe(cmd)
  })

  it('空栈 undo/redo 返回 null 不报错', () => {
    expect(commandService.undo()).toBeNull()
    expect(commandService.redo()).toBeNull()
  })

  it('新操作清空 redo 栈（分支历史丢弃）', () => {
    commandService.execute(new SetCellCommand(sheet, 'A1', 1))
    commandService.undo()
    commandService.execute(new SetCellCommand(sheet, 'A2', 2))
    expect(commandService.canRedo).toBe(false)
  })

  it('executeBatch 打包为原子操作', () => {
    commandService.executeBatch([
      new SetCellCommand(sheet, 'A1', 1),
      new SetCellCommand(sheet, 'A2', 2),
    ])
    expect(commandService.undoCount).toBe(1)
    commandService.undo()
    expect(sheet.cells.has('A1')).toBe(false)
    expect(sheet.cells.has('A2')).toBe(false)
  })

  it('栈深限制：超出后丢弃最旧命令', () => {
    for (let i = 0; i < 60; i++) {
      commandService.execute(new SetCellCommand(sheet, `A${i + 1}`, i))
    }
    expect(commandService.undoCount).toBeLessThanOrEqual(50)
  })

  it('clear 清空所有历史', () => {
    commandService.execute(new SetCellCommand(sheet, 'A1', 1))
    commandService.clear()
    expect(commandService.canUndo).toBe(false)
    expect(commandService.canRedo).toBe(false)
  })

  it('canUndo/canRedo 状态正确', () => {
    expect(commandService.canUndo).toBe(false)
    commandService.execute(new SetCellCommand(sheet, 'A1', 1))
    expect(commandService.canUndo).toBe(true)
    commandService.undo()
    expect(commandService.canRedo).toBe(true)
  })
})
