import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed } from 'vue'
import AppShell from '@/components/AppShell.vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { commandService } from '@/services/commandService'
import { clipboardManager } from '@/services/clipboardManager'

// ── Mock 虚拟滚动（jsdom 无布局） ──
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

vi.mock('@/composables/useGridScrollRef', () => ({
  gridScrollRef: ref(null),
}))

// ── Mock 剪贴板：读写闭环（真实模拟系统剪贴板往返） ──
let clipText = ''
beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn(async (t: string) => { clipText = t }),
      readText: vi.fn(async () => clipText),
    },
    configurable: true,
  })
})

/** 触发真实 window keydown（useKeyboard 监听 window） */
async function press(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
  }))
  // 粘贴是异步的（读剪贴板），等待事件链完成
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

/** 读取单元格 */
function raw(ref: string): unknown {
  return useWorkbookStore().activeSheet?.cells.get(ref)?.rawValue ?? null
}

describe('集成：键盘剪贴板全链路', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    setActivePinia(createPinia())
    commandService.clear()
    clipboardManager.exitAllModes()
    clipText = ''
    wrapper = mount(AppShell)
  })

  afterEach(() => wrapper.unmount())

  it('Ctrl+C 复制 → 虚线框 + 剪贴板内容', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'x')
    store.setCellValue('A2', 'y')
    ui.selectCell('A1')
    await press('c', { ctrl: true })

    expect(clipboardManager.isCopyMode).toBe(true)
    expect(ui.copyRange).toEqual({ startRef: 'A1', endRef: 'A1' })
    expect(clipText).toBe('x')
  })

  it('Ctrl+C 复制多格选区 → TSV', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'a')
    store.setCellValue('B1', 'b')
    ui.startRangeSelection('A1')
    ui.extendSelection('B1')
    ui.finishSelection()
    await press('c', { ctrl: true })
    expect(clipText).toBe('a\tb')
  })

  it('Ctrl+C → Ctrl+V 普通粘贴（源保留）', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'data')
    ui.selectCell('A1')
    await press('c', { ctrl: true })

    // 移动到 B1 粘贴
    ui.selectCell('B1')
    await press('v', { ctrl: true })

    expect(raw('A1')).toBe('data') // 源保留
    expect(raw('B1')).toBe('data') // 目标写入
    // 复制模式保留（可多次粘贴）
    expect(clipboardManager.isCopyMode).toBe(true)
  })

  it('Ctrl+X 剪切 → Ctrl+V 移动（源清空 + 退出剪切模式）', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'data')
    ui.selectCell('A1')
    await press('x', { ctrl: true })
    expect(clipboardManager.isCutMode).toBe(true)
    expect(raw('A1')).toBe('data') // 剪切不立即清空

    ui.selectCell('B1')
    await press('v', { ctrl: true })
    expect(raw('A1')).toBeNull() // 源清空
    expect(raw('B1')).toBe('data') // 目标写入
    expect(clipboardManager.isActive).toBe(false) // 一次性
  })

  it('Ctrl+Z 撤销剪切粘贴 → 源恢复 + 虚线框恢复', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'data')
    ui.selectCell('A1')
    await press('x', { ctrl: true })
    ui.selectCell('B1')
    await press('v', { ctrl: true })
    expect(raw('B1')).toBe('data')

    await press('z', { ctrl: true })
    expect(raw('A1')).toBe('data') // 源恢复
    expect(raw('B1')).toBeNull() // 目标清空
    expect(clipboardManager.isCutMode).toBe(true) // 虚线框恢复
  })

  it('Ctrl+Z 撤销后 Ctrl+Y 重做', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'v1')
    ui.selectCell('A1')
    await press('z', { ctrl: true })
    expect(raw('A1')).toBeNull()
    await press('y', { ctrl: true })
    expect(raw('A1')).toBe('v1')
  })

  it('Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+U 下划线', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'x')
    ui.selectCell('A1')

    await press('b', { ctrl: true })
    expect(store.activeSheet!.cells.get('A1')!.format.bold).toBe(true)
    // 再按一次切换关闭
    await press('b', { ctrl: true })
    expect(store.activeSheet!.cells.get('A1')!.format.bold).toBe(false)

    await press('i', { ctrl: true })
    expect(store.activeSheet!.cells.get('A1')!.format.italic).toBe(true)
    await press('u', { ctrl: true })
    expect(store.activeSheet!.cells.get('A1')!.format.underline).toBe(true)
  })

  it('Escape 退出剪切模式并清空剪贴板', async () => {
    const ui = useUiStore()
    useWorkbookStore().setCellValue('A1', 'x')
    ui.selectCell('A1')
    await press('x', { ctrl: true })
    expect(clipboardManager.isCutMode).toBe(true)

    await press('Escape')
    expect(clipboardManager.isActive).toBe(false)
    expect(clipText).toBe('') // 剪贴板被清空
  })

  it('方向键导航 + Enter 下移', async () => {
    const ui = useUiStore()
    ui.selectCell('A1')
    await press('ArrowDown')
    expect(ui.activeRef).toBe('A2')
    await press('ArrowRight')
    expect(ui.activeRef).toBe('B2')
    await press('Enter')
    expect(ui.activeRef).toBe('B3')
  })

  it('Ctrl+Z 撤销数据输入（A1 写入后可撤销）', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 123)
    ui.selectCell('A1')
    await press('z', { ctrl: true })
    expect(raw('A1')).toBeNull()
  })

  it('type-to-edit：单击选中后直接输入字符进入编辑（Excel 行为）', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', '旧值')
    ui.selectCell('A1')

    // 单击选中后直接按单字符键 → 立即进入编辑，编辑框内容为该字符（替换语义）
    await press('h')
    expect(ui.isEditing).toBe(true)
    // editInitialValue 会被 SpreadsheetGrid 的 watch 消费写入编辑框
    const input = wrapper.find('.cell-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('h')

    // 输入 = 开头 → 编辑框内容以 = 开头（公式输入路径）
    await press('Escape')
    expect(ui.isEditing).toBe(false)
    await press('=')
    expect(ui.isEditing).toBe(true)
    expect((wrapper.find('.cell-input').element as HTMLInputElement).value).toBe('=')
  })

  it('type-to-edit 不干扰 Ctrl 快捷键与功能键', async () => {
    const store = useWorkbookStore()
    const ui = useUiStore()
    store.setCellValue('A1', 'x')
    ui.selectCell('A1')

    // Ctrl+C 仍是复制，不进入编辑
    await press('c', { ctrl: true })
    expect(ui.isEditing).toBe(false)
    expect(clipboardManager.isCopyMode).toBe(true)

    // 功能键不进入编辑
    await press('F2')
    expect(ui.isEditing).toBe(true) // F2 = 编辑当前单元格
    await press('Escape')
    expect(ui.isEditing).toBe(false)

    // 方向键导航不进入编辑
    await press('ArrowDown')
    expect(ui.isEditing).toBe(false)
    expect(ui.activeRef).toBe('A2')
  })

  it('退出登录 → 工作簿重置为空白（数据隔离，下一位用户看不到上一份数据）', async () => {
    const store = useWorkbookStore()
    // 先写入"上一个用户"的数据
    store.setCellValue('A1', '机密数据')
    const oldId = store.workbook.id

    // 模拟已登录：localStorage 有 token + 用户名 → 重新挂载让 AuthBar 显示退出按钮
    localStorage.setItem('moffice_token', 'fake-token')
    localStorage.setItem('moffice_username', 'tester')
    wrapper.unmount()
    wrapper = mount(AppShell)
    await flushPromises()

    // 点击"退出"按钮
    const logoutBtn = wrapper.findAll('button').find((b) => b.text().includes('退出'))
    expect(logoutBtn).toBeTruthy()
    await logoutBtn!.trigger('click')
    await flushPromises()

    // 登出后：新 id + 空白单表 + 命令栈清空（撤销无法恢复旧数据）
    expect(store.workbook.id).not.toBe(oldId)
    expect(store.workbook.sheets).toHaveLength(1)
    expect(store.activeSheet!.cells.size).toBe(0)
    store.undo()
    expect(store.activeSheet!.cells.size).toBe(0)
  })
})
