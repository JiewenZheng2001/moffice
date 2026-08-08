import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import {
  clipboardManager,
  getSelectionBounds,
  serializeSelection,
  parseTSV,
  computePasteCells,
  parseCellRef,
} from '@/services/clipboardManager'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

/** 创建测试 Sheet */
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

// jsdom 没有 navigator.clipboard，mock 掉避免 fallback 触发 execCommand 错误
beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

/** 写入单元格 */
function setCell(sheet: Sheet, ref: string, raw: unknown, computed: unknown = raw): void {
  const cell = createCell(ref)
  cell.rawValue = raw as never
  cell.computedValue = computed as never
  sheet.cells.set(ref, cell)
}

describe('ClipboardManager 状态机', () => {
  beforeEach(() => clipboardManager.exitAllModes())

  it('初始为 idle 模式', () => {
    expect(clipboardManager.mode).toBe('idle')
    expect(clipboardManager.isActive).toBe(false)
  })

  it('startCopy 进入复制模式并缓存 TSV', () => {
    clipboardManager.startCopy({ startRef: 'A1', endRef: 'A2' }, '1\t2')
    expect(clipboardManager.mode).toBe('copy')
    expect(clipboardManager.isCopyMode).toBe(true)
    expect(clipboardManager.sourceRange).toEqual({ startRef: 'A1', endRef: 'A2' })
    expect(clipboardManager.tsvCache).toBe('1\t2')
  })

  it('startCut 进入剪切模式', () => {
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    expect(clipboardManager.mode).toBe('cut')
    expect(clipboardManager.isCutMode).toBe(true)
  })

  it('复制与剪切互斥', () => {
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    clipboardManager.startCopy({ startRef: 'B1', endRef: 'B1' }, 'y')
    expect(clipboardManager.isCopyMode).toBe(true)
    expect(clipboardManager.isCutMode).toBe(false)
  })

  it('exitCutMode 清空状态和 TSV', () => {
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    clipboardManager.exitCutMode()
    expect(clipboardManager.mode).toBe('idle')
    expect(clipboardManager.sourceRange).toBeNull()
    expect(clipboardManager.tsvCache).toBe('')
  })

  it('exitCopyMode 保留 TSV 清空模式', () => {
    clipboardManager.startCopy({ startRef: 'A1', endRef: 'A1' }, 'x')
    clipboardManager.exitCopyMode()
    expect(clipboardManager.mode).toBe('idle')
  })

  it('exitAllModes 对 idle 无副作用', () => {
    expect(() => clipboardManager.exitAllModes()).not.toThrow()
  })

  it('restoreMode 恢复剪切模式（undo 后恢复虚线框）', () => {
    clipboardManager.restoreMode('cut', { startRef: 'A1', endRef: 'B2' }, 'abc')
    expect(clipboardManager.isCutMode).toBe(true)
    expect(clipboardManager.sourceRange).toEqual({ startRef: 'A1', endRef: 'B2' })
    expect(clipboardManager.tsvCache).toBe('abc')
  })

  it('restoreMode 无 TSV 时保留现有缓存', () => {
    clipboardManager.startCopy({ startRef: 'A1', endRef: 'A1' }, 'cache')
    clipboardManager.restoreMode('cut', { startRef: 'A1', endRef: 'A1' })
    expect(clipboardManager.tsvCache).toBe('cache')
  })
})

describe('剪贴板工具函数', () => {
  let sheet: Sheet
  beforeEach(() => { sheet = createSheet() })

  it('parseCellRef 解析', () => {
    expect(parseCellRef('A1')).toEqual({ col: 0, row: 0 })
    expect(parseCellRef('B3')).toEqual({ col: 1, row: 2 })
    expect(parseCellRef('AA10')).toEqual({ col: 26, row: 9 })
    expect(parseCellRef('invalid')).toBeNull()
  })

  it('getSelectionBounds 归一化（逆序范围）', () => {
    const b = getSelectionBounds('C3', 'A1')
    expect(b).toEqual({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 })
  })

  it('getSelectionBounds 非法引用返回默认', () => {
    expect(getSelectionBounds('xx', 'A1')).toEqual({
      startRow: 0, endRow: 0, startCol: 0, endCol: 0,
    })
  })

  it('serializeSelection 输出 TSV', () => {
    setCell(sheet, 'A1', 'a')
    setCell(sheet, 'B1', 'b')
    setCell(sheet, 'A2', 1)
    setCell(sheet, 'B2', 2)
    const tsv = serializeSelection(sheet, { startRow: 0, endRow: 1, startCol: 0, endCol: 1 })
    expect(tsv).toBe('a\tb\n1\t2')
  })

  it('serializeSelection 空单元格输出空串', () => {
    setCell(sheet, 'A1', 'x')
    const tsv = serializeSelection(sheet, { startRow: 0, endRow: 1, startCol: 0, endCol: 0 })
    expect(tsv).toBe('x\n')
  })

  it('serializeSelection 公式格用 rawValue（公式原文）', () => {
    setCell(sheet, 'A1', '=SUM(B1)', 5)
    const tsv = serializeSelection(sheet, { startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    expect(tsv).toBe('=SUM(B1)')
  })

  it('parseTSV 解析', () => {
    expect(parseTSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseTSV('')).toEqual([])
    // 空行过滤
    expect(parseTSV('a\n\nb')).toEqual([['a'], ['b']])
  })

  it('computePasteCells 从起点映射二维数据', () => {
    const cells = computePasteCells(sheet, 'B2', [['x', 'y'], ['1', '2']])
    expect(cells.get('B2')).toBe('x')
    expect(cells.get('C2')).toBe('y')
    expect(cells.get('B3')).toBe('1')
    expect(cells.get('C3')).toBe('2')
  })

  it('computePasteCells 空串转为 null（清空格）', () => {
    const cells = computePasteCells(sheet, 'A1', [['', 'v']])
    expect(cells.get('A1')).toBeNull()
    expect(cells.get('B1')).toBe('v')
  })

  it('computePasteCells 不超出 Sheet 边界', () => {
    sheet.rowCount = 2
    sheet.columnCount = 2
    const cells = computePasteCells(sheet, 'A1', [['1', '2', '3'], ['4', '5', '6']])
    expect(cells.size).toBe(4) // 2x2，其余越界丢弃
  })

  it('computePasteCells 非法起点返回空 Map', () => {
    expect(computePasteCells(sheet, 'bad', [['x']]).size).toBe(0)
  })
})
