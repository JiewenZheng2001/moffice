import { ref, computed, onMounted, onUnmounted, toValue, watch, type Ref, type MaybeRef } from 'vue'
import { DEFAULT_ROW_HEIGHT } from '@/model/constants'

export interface VirtualScrollOptions {
  totalRows: MaybeRef<number>
  rowHeight?: number
  overscan?: number
}

/**
 * 手写虚拟滚动 — 只渲染视口内 + 缓冲区的行，其余用 spacer 占位
 */
export function useVirtualScroll(
  containerRef: Ref<HTMLElement | null>,
  options: VirtualScrollOptions,
) {
  const { rowHeight = DEFAULT_ROW_HEIGHT, overscan = 5 } = options

  const scrollTop = ref(0)
  const containerHeight = ref(0)
  const _totalRows = ref(toValue(options.totalRows))

  watch(() => toValue(options.totalRows), (v) => { _totalRows.value = v })

  const visibleCount = computed(() => Math.ceil(containerHeight.value / rowHeight))
  const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan))
  const endRow = computed(() => Math.min(_totalRows.value, startRow.value + visibleCount.value + overscan * 2))
  const offsetY = computed(() => startRow.value * rowHeight)
  const totalHeight = computed(() => _totalRows.value * rowHeight)

  const visibleRows = computed(() =>
    Array.from({ length: endRow.value - startRow.value }, (_, i) => ({
      index: startRow.value + i,
      number: startRow.value + i + 1,
    })),
  )

  function handleScroll(): void {
    const el = containerRef.value
    if (!el) return
    scrollTop.value = el.scrollTop
  }
  function updateContainerHeight(): void {
    const el = containerRef.value
    if (!el) return
    containerHeight.value = el.clientHeight
  }

  /** 检查指定行索引是否在当前可见范围内 */
  function isRowVisible(rowIndex: number): boolean {
    return rowIndex >= startRow.value && rowIndex < endRow.value
  }

  onMounted(() => {
    updateContainerHeight()
    containerRef.value?.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateContainerHeight)
  })
  onUnmounted(() => {
    containerRef.value?.removeEventListener('scroll', handleScroll)
    window.removeEventListener('resize', updateContainerHeight)
  })

  return { startRow, endRow, offsetY, totalHeight, visibleRows, isRowVisible, updateContainerHeight }
}
