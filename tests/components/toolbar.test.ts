import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FormatToolbar from '@/components/toolbar/FormatToolbar.vue'
import SheetTabs from '@/components/sheet-tabs/SheetTabs.vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { clipboardManager } from '@/services/clipboardManager'
import { createCell } from '@/model/cell'

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

describe('FormatToolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useWorkbookStore()
    store.setCellValue('A1', 100)
    const ui = useUiStore()
    ui.selectCell('A1')
  })

  it('渲染字体/字号/粗斜体/对齐/颜色/数字格式控件', () => {
    const wrapper = mount(FormatToolbar)
    expect(wrapper.findAll('select').length).toBeGreaterThanOrEqual(3) // 字体/字号/数字格式
    expect(wrapper.findAll('button').length).toBeGreaterThanOrEqual(6) // B/I/U/对齐×3/边框
  })

  it('点粗体按钮 → A1 加粗', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    await wrapper.find('.ft-btn', { text: '' }).find('b').trigger('click')
    expect(store.activeSheet!.cells.get('A1')!.format.bold).toBe(true)
  })

  it('粗体按钮反映当前激活格状态', async () => {
    const store = useWorkbookStore()
    store.applyFormat(['A1'], { bold: true })
    const wrapper = mount(FormatToolbar)
    const boldBtn = wrapper.findAll('.ft-btn').find((b) => b.find('b').exists())!
    expect(boldBtn.classes()).toContain('ft-btn--active')
  })

  it('切换字体下拉 → 应用 fontFamily', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const fontSelect = wrapper.find('.ft-font-family')
    await fontSelect.setValue('Arial')
    await fontSelect.trigger('change')
    expect(store.activeSheet!.cells.get('A1')!.format.fontFamily).toBe('Arial')
  })

  it('切换字号下拉 → 应用 fontSize', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const sizeSelect = wrapper.find('.ft-font-size')
    await sizeSelect.setValue('16')
    await sizeSelect.trigger('change')
    expect(store.activeSheet!.cells.get('A1')!.format.fontSize).toBe(16)
  })

  it('数字格式下拉 → 应用 numberFormat', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const fmtSelect = wrapper.findAll('select')[2]
    await fmtSelect.setValue('0%')
    await fmtSelect.trigger('change')
    expect(store.activeSheet!.cells.get('A1')!.format.numberFormat).toBe('0%')
  })

  it('背景色板 hover 弹出并可选色', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const swatch = wrapper.findAll('.ft-swatch')[1] // 黄色
    await swatch.trigger('click')
    expect(store.activeSheet!.cells.get('A1')!.format.backgroundColor).toBe('#FFFF00')
  })

  it('边框按钮 → 四边边框应用', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const borderBtn = wrapper.findAll('.ft-btn').find((b) => b.text() === '▦')!
    await borderBtn.trigger('click')
    const fmt = store.activeSheet!.cells.get('A1')!.format
    expect(fmt.borderTop).toEqual({ color: '#000000', style: 'thin' })
    expect(fmt.borderBottom).toEqual({ color: '#000000', style: 'thin' })
    expect(fmt.borderLeft).toEqual({ color: '#000000', style: 'thin' })
    expect(fmt.borderRight).toEqual({ color: '#000000', style: 'thin' })
  })

  it('边框按钮 toggle：再点一次取消边框', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const borderBtn = wrapper.findAll('.ft-btn').find((b) => b.text() === '▦')!
    // 第一次点击：添加边框
    await borderBtn.trigger('click')
    expect(store.activeSheet!.cells.get('A1')!.format.borderTop).toBeDefined()
    // 按钮应高亮（激活格有边框）
    expect(borderBtn.classes()).toContain('ft-btn--active')

    // 第二次点击：取消边框
    await borderBtn.trigger('click')
    const fmt = store.activeSheet!.cells.get('A1')!.format
    expect(fmt.borderTop).toBeUndefined()
    expect(fmt.borderBottom).toBeUndefined()
    expect(fmt.borderLeft).toBeUndefined()
    expect(fmt.borderRight).toBeUndefined()
    expect(borderBtn.classes()).not.toContain('ft-btn--active')
  })

  it('格式应用到整个选区（多格）', async () => {
    const wrapper = mount(FormatToolbar)
    const store = useWorkbookStore()
    const ui = useUiStore()
    // 拖拽选区 A1:B2
    ui.startRangeSelection('A1')
    ui.extendSelection('B2')
    ui.finishSelection()

    await wrapper.findAll('.ft-btn').find((b) => b.find('i').exists())!.trigger('click') // 斜体
    expect(store.activeSheet!.cells.get('A1')!.format.italic).toBe(true)
    expect(store.activeSheet!.cells.get('A2')!.format.italic).toBe(true)
    expect(store.activeSheet!.cells.get('B1')!.format.italic).toBe(true)
    expect(store.activeSheet!.cells.get('B2')!.format.italic).toBe(true)
  })
})

describe('SheetTabs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('渲染所有 sheet 标签', () => {
    const store = useWorkbookStore()
    store.addSheet('数据表')
    const wrapper = mount(SheetTabs)
    const tabs = wrapper.findAll('.tab').map((t) => t.text())
    expect(tabs).toEqual(['Sheet1', '数据表'])
  })

  it('激活标签高亮', () => {
    const store = useWorkbookStore()
    store.addSheet('Sheet2')
    store.setActiveSheet(store.workbook.sheets[1].id)
    const wrapper = mount(SheetTabs)
    expect(wrapper.findAll('.tab')[1].classes()).toContain('tab--active')
  })

  it('点击标签切换 sheet', async () => {
    const store = useWorkbookStore()
    store.addSheet('Sheet2')
    const wrapper = mount(SheetTabs)
    await wrapper.findAll('.tab')[1].trigger('click')
    expect(store.workbook.activeSheetId).toBe(store.workbook.sheets[1].id)
  })

  it('点击 + 新建 sheet', async () => {
    const store = useWorkbookStore()
    const wrapper = mount(SheetTabs)
    expect(store.workbook.sheets).toHaveLength(1)
    await wrapper.find('.add-btn').trigger('click')
    expect(store.workbook.sheets).toHaveLength(2)
    expect(store.workbook.sheets[1].name).toBe('Sheet2')
  })
})
