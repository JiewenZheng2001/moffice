import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
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

/**
 * 键盘导航 composable
 * 统一管理所有表格快捷键，按 spec 中的快捷键映射表实现
 *
 * 快捷键映射：
 *   Arrow     → 方向键移动选区
 *   Tab       → 右移一个单元格
 *   Enter     → 若编辑中则确认，否则下移一个单元格
 *   F2        → 编辑当前单元格
 *   Esc       → 取消编辑
 */
export function useKeyboard(): void {
  const uiStore = useUiStore()

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

  /** 移动选区到指定行列 */
  function navigateTo(row: number, col: number): void {
    if (col < 0 || row < 0) return
    const ref = toCellRef(row, col)
    uiStore.selectCell(ref)
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
