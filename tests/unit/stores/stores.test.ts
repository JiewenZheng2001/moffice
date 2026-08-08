import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFormulaStore } from '@/stores/formulaStore'
import { useUiStore } from '@/stores/uiStore'
import { clipboardManager } from '@/services/clipboardManager'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

function makeSheet(id: string, name: string): Sheet {
  const sheet: Sheet = {
    id,
    name,
    cells: new Map(),
    rowCount: 10,
    columnCount: 10,
    columnWidths: new Map(),
    rowHeights: new Map(),
    tabColor: null,
  }
  return sheet
}

/** 便捷：给 sheet 的单元格写值 */
function setV(sheet: Sheet, ref: string, value: number | string): void {
  const cell = createCell(ref)
  cell.rawValue = value
  cell.computedValue = value
  sheet.cells.set(ref, cell)
}

/** 便捷：写入公式格 */
function setF(sheet: Sheet, ref: string, formula: string, computed: number | string): void {
  const cell = createCell(ref)
  cell.rawValue = formula
  cell.computedValue = computed
  cell.formula = formula
  sheet.cells.set(ref, cell)
}

describe('formulaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('compute 返回值和依赖列表', () => {
    const store = useFormulaStore()
    const sheet = makeSheet('s1', 'Sheet1')
    setV(sheet, 'A1', 1)
    setV(sheet, 'A2', 2)
    const result = store.compute('=SUM(A1:A2)+1', sheet)
    expect(result.value).toBe(4)
    expect(result.deps.sort()).toEqual(['A1', 'A2'])
  })

  it('setDeps 建立依赖，getAffectedCells 传播', () => {
    const store = useFormulaStore()
    store.setActiveSheetContext('s1')
    store.setDeps('B1', ['A1'])
    store.setDeps('C1', ['B1'])
    expect(store.getAffectedCells('A1').sort()).toEqual(['B1', 'C1'])
  })

  it('removeDeps 断开依赖', () => {
    const store = useFormulaStore()
    store.setActiveSheetContext('s1')
    store.setDeps('B1', ['A1'])
    store.removeDeps('B1')
    expect(store.getAffectedCells('A1')).toEqual([])
  })

  describe('多 Sheet 依赖图隔离', () => {
    it('两个 sheet 的 A1 互不干扰（key 隔离）', () => {
      const store = useFormulaStore()
      // Sheet1: B1 依赖 A1
      store.setActiveSheetContext('sheet-1')
      store.setDeps('B1', ['A1'])
      // Sheet2: C1 依赖 A1
      store.setActiveSheetContext('sheet-2')
      store.setDeps('C1', ['A1'])

      // 在 sheet-1 上下文中，A1 只影响 B1
      store.setActiveSheetContext('sheet-1')
      expect(store.getAffectedCells('A1')).toEqual(['B1'])
      // 在 sheet-2 上下文中，A1 只影响 C1
      store.setActiveSheetContext('sheet-2')
      expect(store.getAffectedCells('A1')).toEqual(['C1'])
    })

    it('一个 sheet 的循环引用不影响另一个 sheet', () => {
      const store = useFormulaStore()
      store.setActiveSheetContext('sheet-1')
      store.setDeps('A1', ['B1'])
      // sheet-1 检测到环
      expect(store.setDeps('B1', ['A1'])).toBe('#CIRCULAR!')

      // sheet-2 中相同引用建立单向依赖不受 sheet-1 的环影响
      store.setActiveSheetContext('sheet-2')
      expect(store.setDeps('A1', ['B1'])).toBeNull()
      // sheet-2 的 A1 → B1 正常传播
      expect(store.getAffectedCells('B1')).toEqual(['A1'])
    })

    it('recalculate 只重算当前 sheet 的公式', () => {
      const store = useFormulaStore()
      const sheet1 = makeSheet('sheet-1', 'S1')
      const sheet2 = makeSheet('sheet-2', 'S2')
      setV(sheet1, 'A1', 1)
      setV(sheet2, 'A1', 100)
      setF(sheet1, 'B1', '=A1*2', 2)
      setF(sheet2, 'B1', '=A1*2', 200)

      // 在 sheet-1 上下文重算 B1 → 只影响 sheet1
      store.setActiveSheetContext('sheet-1')
      store.recalculate('B1', sheet1)
      expect(sheet1.cells.get('B1')!.computedValue).toBe(2)
      // sheet2 的 B1 不变
      expect(sheet2.cells.get('B1')!.computedValue).toBe(200)

      // 修改 sheet1 的 A1 后重算
      setV(sheet1, 'A1', 50)
      store.recalculate('B1', sheet1)
      expect(sheet1.cells.get('B1')!.computedValue).toBe(100)
      expect(sheet2.cells.get('B1')!.computedValue).toBe(200) // 不受影响
    })

    it('recalculate 对非公式格无操作', () => {
      const store = useFormulaStore()
      const sheet = makeSheet('s', 'S')
      setV(sheet, 'A1', 1)
      expect(() => store.recalculate('A1', sheet)).not.toThrow()
    })

    it('recalculate 错误传播到 error 字段', () => {
      const store = useFormulaStore()
      const sheet = makeSheet('s', 'S')
      setF(sheet, 'A1', '=1/0', 0)
      store.setActiveSheetContext('s')
      store.recalculate('A1', sheet)
      expect(sheet.cells.get('A1')!.computedValue).toBe('#DIV/0!')
      expect(sheet.cells.get('A1')!.error).toBe('#DIV/0!')
    })
  })

  it('getCellValue 对错误格返回 null（公式上下文）', () => {
    const store = useFormulaStore()
    const sheet = makeSheet('s', 'S')
    setF(sheet, 'A1', '=1/0', '#DIV/0!')
    sheet.cells.get('A1')!.error = '#DIV/0!'
    const result = store.compute('=A1*2', sheet)
    // 错误格在公式里按空单元格处理（返回 0）
    expect(result.value).toBe(0)
  })

  it('getRangeValues 跳过错误格', () => {
    const store = useFormulaStore()
    const sheet = makeSheet('s', 'S')
    setV(sheet, 'A1', 1)
    setV(sheet, 'A2', 2)
    setV(sheet, 'A3', 3)
    sheet.cells.get('A2')!.error = '#VALUE!'
    const result = store.compute('=SUM(A1:A3)', sheet)
    expect(result.value).toBe(4) // A2 被跳过
  })
})

describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clipboardManager.exitAllModes()
  })

  it('selectCell 设置激活格并重置选区', () => {
    const store = useUiStore()
    store.selectCell('B2')
    expect(store.activeRef).toBe('B2')
    expect(store.selection).toEqual({ startRef: 'B2', endRef: 'B2' })
  })

  it('拖拽选区 startRangeSelection / extendSelection / finishSelection', () => {
    const store = useUiStore()
    store.startRangeSelection('A1')
    expect(store.isDragging).toBe(true)
    store.extendSelection('C3')
    expect(store.selection).toEqual({ startRef: 'A1', endRef: 'C3' })
    store.finishSelection()
    expect(store.isDragging).toBe(false)
  })

  it('isInSelection 矩形判定（含逆序）', () => {
    const store = useUiStore()
    store.startRangeSelection('C3')
    store.extendSelection('A1')
    store.finishSelection()
    expect(store.isInSelection('B2')).toBe(true)
    expect(store.isInSelection('A1')).toBe(true)
    expect(store.isInSelection('D3')).toBe(false)
    expect(store.isInSelection('C4')).toBe(false)
  })

  it('getSelectionRange 归一化（左上角优先）', () => {
    const store = useUiStore()
    store.startRangeSelection('C3')
    store.extendSelection('A1')
    expect(store.getSelectionRange()).toEqual({ startRef: 'A1', endRef: 'C3' })
  })

  it('getSelectionRange 无选区时返回激活格', () => {
    const store = useUiStore()
    store.selectCell('A1')
    expect(store.getSelectionRange()).toEqual({ startRef: 'A1', endRef: 'A1' })
  })

  it('startEdit 退出剪贴板模式并进入编辑', () => {
    const store = useUiStore()
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    store.startEdit()
    expect(store.isEditing).toBe(true)
    expect(clipboardManager.isActive).toBe(false)
  })

  it('cutRange/copyRange 反映剪贴板状态', () => {
    const store = useUiStore()
    expect(store.cutRange).toBeNull()
    clipboardManager.startCut({ startRef: 'A1', endRef: 'B2' }, 'tsv')
    expect(store.cutRange).toEqual({ startRef: 'A1', endRef: 'B2' })
    expect(store.copyRange).toBeNull()

    clipboardManager.startCopy({ startRef: 'C3', endRef: 'C3' }, 'tsv')
    expect(store.copyRange).toEqual({ startRef: 'C3', endRef: 'C3' })
    expect(store.cutRange).toBeNull()
  })

  it('clearCutRange 只退出剪切模式', () => {
    const store = useUiStore()
    clipboardManager.startCopy({ startRef: 'A1', endRef: 'A1' }, 'x')
    store.clearCutRange()
    expect(clipboardManager.isCopyMode).toBe(true) // 复制模式不受影响
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    store.clearCutRange()
    expect(clipboardManager.isActive).toBe(false)
  })

  it('clearAllRanges 退出所有模式', () => {
    const store = useUiStore()
    clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
    store.clearAllRanges()
    expect(clipboardManager.isActive).toBe(false)
  })

  it('行列拖拽 resize 状态管理', () => {
    const store = useUiStore()
    store.startResize('col', 2, 100, 0, 80)
    expect(store.updateResize(130, 0)).toBe(110) // 80 + (130-100)
    store.finishResize()
    expect(store.resizeState).toBeNull()
  })

  it('updateResize 无状态时返回 0', () => {
    const store = useUiStore()
    expect(store.updateResize(10, 10)).toBe(0)
  })

  it('resize 最小尺寸限制 20px', () => {
    const store = useUiStore()
    store.startResize('col', 0, 0, 0, 30)
    expect(store.updateResize(-100, 0)).toBe(20)
  })

  it('setCutRange/setCopyRange 委托到剪贴板管理器', () => {
    const store = useUiStore()
    store.setCutRange({ startRef: 'A1', endRef: 'A1' })
    expect(clipboardManager.isCutMode).toBe(true)
    store.setCopyRange({ startRef: 'B1', endRef: 'B1' })
    expect(clipboardManager.isCopyMode).toBe(true)
  })
})
