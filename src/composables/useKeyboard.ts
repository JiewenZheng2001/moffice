import { onMounted, onUnmounted, type Ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorkbookStore } from '@/stores/workbookStore'
import { colToIndex, toCellRef } from '@/utils/columnUtils'

/**
 * 从单元格引用字符串解析出行列索引
 * "A1" → { row: 0, col: 0 }, "B3" → { row: 2, col: 1 }
 */
function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!match) return null
  const col = colToIndex(match[1].toUpperCase())
  const row = parseInt(match[2], 10) - 1
  return { row, col }
}

const ROW_H = 24
const COL_W = 100
const COL_HEADER_H = 24  // <thead> 高度，cellTop 计算必须加上
const ROW_HEADER_W = 48
const JUMP_ROWS = 5
const JUMP_COLS = 1

/**
 * 键盘导航 composable
 * 统一管理所有表格快捷键。
 * 核心：方向键移动前先判断目标格是否完整可见，
 * 若不可见则先滚动视图再移动选区，确保格子从不"出界闪现"。
 */
export function useKeyboard(scrollContainer: Ref<HTMLElement | null>): void {
  const uiStore = useUiStore()
  const workbookStore = useWorkbookStore()

  /** 先滚动确保目标行列在视口内完整可见 */
  function ensureVisible(row: number, col: number): void {
    const el = scrollContainer.value
    if (!el) return

    // ---- 垂直（cellTop 必须加 COL_HEADER_H，因为 <thead> 占 24px） ----
    const cellTop = COL_HEADER_H + row * ROW_H
    const cellBottom = cellTop + ROW_H
    const vpTop = el.scrollTop
    const vpBottom = vpTop + el.clientHeight

    if (cellTop < vpTop) {
      el.scrollTop = Math.max(0, cellTop - JUMP_ROWS * ROW_H - 1)  // -1 防亚像素贴边
    } else if (cellBottom > vpBottom) {
      el.scrollTop = cellTop - el.clientHeight + ROW_H + JUMP_ROWS * ROW_H + 1  // +1 缓冲
    }

    // ---- 水平 ----
    const cellLeft = col * COL_W + ROW_HEADER_W
    const cellRight = cellLeft + COL_W
    const vpLeft = el.scrollLeft
    const vpRight = vpLeft + el.clientWidth

    if (cellLeft < vpLeft) {
      el.scrollLeft = Math.max(0, cellLeft - JUMP_COLS * COL_W - 1)
    } else if (cellRight > vpRight) {
      el.scrollLeft = cellLeft - el.clientWidth + COL_W + JUMP_COLS * COL_W + 1
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    // 如果事件来自输入框（编辑中），不处理 — 让 input 自己的 handler 处理
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return

    const active = uiStore.activeRef
    const parsed = parseCellRef(active)
    if (!parsed) return

    const { row, col } = parsed

    // ---- 导航键（选择模式下移动） ----
    if (!uiStore.isEditing) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          if (row > 0) navigateTo(row - 1, col)
          break
        case 'ArrowDown':
          e.preventDefault()
          navigateTo(row + 1, col)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (col > 0) navigateTo(row, col - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          navigateTo(row, col + 1)
          break
        case 'Tab':
          e.preventDefault()
          navigateTo(row, col + 1)
          break
        case 'Enter':
          e.preventDefault()
          navigateTo(row + 1, col)
          break
        case 'F2':
          e.preventDefault()
          uiStore.startEdit()
          break
      }
      return
    }

    // ---- 编辑模式下 ----
    if (uiStore.isEditing) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          uiStore.cancelEdit()
          break
        case 'Enter':
          // 编辑模式 Enter → 确认并下移，交由 GridBody 的 input 处理
          // 这里不做默认行为，让 input 的 @keydown.enter 处理
          break
        case 'Tab':
          e.preventDefault()
          uiStore.cancelEdit()
          navigateTo(row, col + 1)
          break
        case 'F2':
          e.preventDefault()
          // 编辑中按 F2 不做操作
          break
      }
    }
  }

  /** 先滚动再移动选区 —— 格子永远不会出现"出界闪现" */
  function navigateTo(row: number, col: number): void {
    const sheet = workbookStore.activeSheet
    if (!sheet) return
    if (col < 0 || row < 0 || col >= sheet.columnCount || row >= sheet.rowCount) return
    ensureVisible(row, col)
    uiStore.selectCell(toCellRef(row, col))
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
