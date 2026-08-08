import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Toolbar from '@/components/toolbar/Toolbar.vue'
import { useWorkbookStore } from '@/stores/workbookStore'

// Mock 后端服务：记录 saveWorkbook 调用
const saveMock = vi.fn()
vi.mock('@/services/workbookService', () => ({
  saveWorkbook: (...args: unknown[]) => {
    saveMock(...args)
    return Promise.resolve({ ok: true })
  },
  loadWorkbook: vi.fn(),
  listWorkbooks: vi.fn().mockResolvedValue({ workbooks: [] }),
  ApiError: class extends Error {
    status = 0
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

describe('Toolbar 自动保存', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    saveMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('数据变更后 2 秒自动保存', async () => {
    const store = useWorkbookStore()
    mount(Toolbar, { props: { authed: true } })

    store.setCellValue('A1', 1)
    await flushPromises()

    // 未到 2 秒：不保存
    expect(saveMock).not.toHaveBeenCalled()

    // 推进 2 秒：触发自动保存
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveMock).toHaveBeenCalledTimes(1)
    // 保存的是包含 A1 的工作簿
    const wb = saveMock.mock.calls[0][0]
    expect(wb.sheets[0].cells.get('A1')?.rawValue).toBe(1)
  })

  it('连续变更 debounce：只保存一次（始终保存最新状态）', async () => {
    const store = useWorkbookStore()
    mount(Toolbar, { props: { authed: true } })

    // 1 秒内连续变更 3 次
    store.setCellValue('A1', 1)
    await vi.advanceTimersByTimeAsync(1000)
    store.setCellValue('A1', 2)
    await vi.advanceTimersByTimeAsync(1000)
    store.setCellValue('A1', 3)
    await vi.advanceTimersByTimeAsync(1999)
    expect(saveMock).not.toHaveBeenCalled() // 距最后一次变更不足 2 秒

    await vi.advanceTimersByTimeAsync(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock.mock.calls[0][0].sheets[0].cells.get('A1')?.rawValue).toBe(3)
  })

  it('组件卸载时清理计时器', async () => {
    const store = useWorkbookStore()
    const wrapper = mount(Toolbar, { props: { authed: true } })
    store.setCellValue('A1', 1)
    await flushPromises()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    // 卸载后计时器被清理，不会触发保存
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('未登录（authed=false）不自动保存', async () => {
    const store = useWorkbookStore()
    mount(Toolbar, { props: { authed: false } })
    store.setCellValue('A1', 1)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).not.toHaveBeenCalled()
  })
})
