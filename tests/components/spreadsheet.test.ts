import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed } from 'vue'
import SpreadsheetGrid from '@/components/grid/SpreadsheetGrid.vue'
import FormulaBar from '@/components/formula-bar/FormulaBar.vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { createCell } from '@/model/cell'
import type { Sheet } from '@/model/types'

// Mock 虚拟滚动：jsdom 无真实布局，固定返回前 3 行
vi.mock('@/composables/useVirtualScroll', () => ({
  useVirtualScroll: () => {
    const startRow = ref(0)
    const endRow = ref(3)
    const offsetY = ref(0)
    const totalHeight = ref(200)
    const visibleRows = computed(() => [
      { index: 0, number: 1 },
      { index: 1, number: 2 },
      { index: 2, number: 3 },
    ])
    const isRowVisible = () => true
    const updateContainerHeight = vi.fn()
    return { startRow, endRow, offsetY, totalHeight, visibleRows, isRowVisible, updateContainerHeight }
  },
}))

// Mock 共享滚动容器
vi.mock('@/composables/useGridScrollRef', () => ({
  gridScrollRef: ref(null),
}))

/** 给 store 注入测试数据 */
function seedSheet(sheet: Sheet): void {
  const c1 = createCell('A1')
  c1.rawValue = 'hello'
  c1.computedValue = 'hello'
  sheet.cells.set('A1', c1)

  const c2 = createCell('B2')
  c2.rawValue = 42
  c2.computedValue = 42
  c2.format = { bold: true }
  sheet.cells.set('B2', c2)
}

describe('SpreadsheetGrid', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useWorkbookStore()
    seedSheet(store.activeSheet!)
  })

  it('渲染列头 A B C', () => {
    const wrapper = mount(SpreadsheetGrid)
    const headers = wrapper.findAll('.col-header').map((h) => h.text())
    expect(headers.slice(0, 3)).toEqual(['A', 'B', 'C'])
  })

  it('渲染行号 1 2 3', () => {
    const wrapper = mount(SpreadsheetGrid)
    const rows = wrapper.findAll('.row-header').map((r) => r.text())
    expect(rows.slice(0, 3)).toEqual(['1', '2', '3'])
  })

  it('显示有数据的单元格内容', () => {
    const wrapper = mount(SpreadsheetGrid)
    const texts = wrapper.findAll('.cell-value').map((c) => c.text())
    expect(texts).toContain('hello')
    expect(texts).toContain('42')
  })

  it('应用单元格格式样式（粗体）', () => {
    const wrapper = mount(SpreadsheetGrid)
    // 第 2 行第 2 列 = B2（row.index=1, colIdx=2）
    const b2 = wrapper.find('tbody tr:nth-child(2) .cell:nth-child(3)')
    expect(b2.attributes('style')).toContain('font-weight: bold')
  })

  it('边框邻居合并：A1 右边框由 B1 左边显示（不重叠）', () => {
    const store = useWorkbookStore()
    const sheet = store.activeSheet!
    // A1 和 B1 都设置边框（模拟用户选中两格加边框）
    const border = { color: '#000000', style: 'thin' as const }
    sheet.cells.get('A1')!.format = {
      borderTop: border, borderBottom: border, borderLeft: border, borderRight: border,
    }
    const b1 = createCell('B1')
    b1.format = {
      borderTop: border, borderBottom: border, borderLeft: border, borderRight: border,
    }
    sheet.cells.set('B1', b1)

    const wrapper = mount(SpreadsheetGrid)
    // 行结构：row-header | A1 | B1（row-header 是第 1 个 child）
    const a1 = wrapper.find('tbody tr:nth-child(1) .cell:nth-child(2)')
    const b1El = wrapper.find('tbody tr:nth-child(1) .cell:nth-child(3)')

    // 内部共享边只画一次：A1 不画右边框（交给 B1 的左边框）
    expect(a1.attributes('style')).not.toContain('border-right')
    // B1 画左边框（自己的 borderLeft）
    expect(b1El.attributes('style')).toContain('border-left')
  })

  it('边框邻居合并：只有 A1 有右边框时 B1 继承显示', () => {
    const store = useWorkbookStore()
    const sheet = store.activeSheet!
    sheet.cells.get('A1')!.format = {
      borderRight: { color: '#ff0000', style: 'medium' as const },
    }

    const wrapper = mount(SpreadsheetGrid)
    // 行结构：row-header | A1 | B1
    const a1 = wrapper.find('tbody tr:nth-child(1) .cell:nth-child(2)')
    const b1 = wrapper.find('tbody tr:nth-child(1) .cell:nth-child(3)')

    // A1 不重复画右边框（有邻居）
    expect(a1.attributes('style')).not.toContain('border-right')
    // B1 左边继承 A1 的右边框样式（红色 medium）
    expect(b1.attributes('style')).toContain('border-left')
    expect(b1.attributes('style')).toContain('2px')
    expect(b1.attributes('style')).toContain('rgb(255, 0, 0)')
  })

  it('激活格高亮', async () => {
    const uiStore = useUiStore()
    uiStore.selectCell('B1')
    const wrapper = mount(SpreadsheetGrid)
    const active = wrapper.find('.cell--active')
    expect(active.exists()).toBe(true)
  })

  it('点击单元格触发选区', async () => {
    const wrapper = mount(SpreadsheetGrid)
    const uiStore = useUiStore()
    await wrapper.find('tbody tr:nth-child(2) .cell').trigger('mousedown')
    expect(uiStore.activeRef).toBe('A2')
  })

  it('双击进入编辑模式', async () => {
    const wrapper = mount(SpreadsheetGrid)
    const uiStore = useUiStore()
    // B2 = tr:nth-child(2) 的第 3 个 td
    await wrapper.find('tbody tr:nth-child(2) .cell:nth-child(3)').trigger('dblclick')
    expect(uiStore.isEditing).toBe(true)
    const input = wrapper.find('.cell-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('42')
  })

  it('编辑输入并确认保存', async () => {
    const wrapper = mount(SpreadsheetGrid)
    const store = useWorkbookStore()
    // B2 = tr:nth-child(2) 的第 3 个 td
    await wrapper.find('tbody tr:nth-child(2) .cell:nth-child(3)').trigger('dblclick')
    const input = wrapper.find('.cell-input')
    await input.setValue('100')
    await input.trigger('keydown.enter')
    expect(store.activeSheet!.cells.get('B2')?.rawValue).toBe(100)
    expect(store.activeSheet!.cells.get('B2')?.computedValue).toBe(100)
  })
})

describe('FormulaBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useWorkbookStore()
    seedSheet(store.activeSheet!)
  })

  it('显示当前激活单元格地址', () => {
    const wrapper = mount(FormulaBar)
    expect(wrapper.find('.name-box').text()).toBe('A1')
  })

  it('显示当前单元格内容', async () => {
    const uiStore = useUiStore()
    uiStore.selectCell('A1')
    const wrapper = mount(FormulaBar)
    expect((wrapper.find('.formula-input').element as HTMLInputElement).value).toBe('hello')
  })

  it('切换选区时同步公式栏内容', async () => {
    const wrapper = mount(FormulaBar)
    const uiStore = useUiStore()
    await uiStore.selectCell('B2')
    await flushPromises()
    expect((wrapper.find('.formula-input').element as HTMLInputElement).value).toBe('42')
  })

  it('Enter 提交内容到单元格', async () => {
    const wrapper = mount(FormulaBar)
    const input = wrapper.find('.formula-input')
    await input.setValue('=1+1')
    await input.trigger('keydown.enter')
    const store = useWorkbookStore()
    const cell = store.activeSheet!.cells.get('A1')!
    // 公式被求值：computedValue 是 2，rawValue 是公式
    expect(cell.formula).toBe('=1+1')
    expect(cell.computedValue).toBe(2)
  })

  it('Enter 提交后输入框失焦', async () => {
    const wrapper = mount(FormulaBar)
    const input = wrapper.find('.formula-input')
    await input.setValue('123')
    await input.trigger('keydown.enter')
    expect((input.element as HTMLInputElement).ownerDocument.activeElement).not.toBe(input.element)
  })
})
