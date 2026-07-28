import { onMounted, onUnmounted, type Ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorkbookStore } from '@/stores/workbookStore'
import { colToIndex, toCellRef } from '@/utils/columnUtils'
import { copySelection, cutSelection, readClipboardForPaste, computePasteCells } from '@/services/clipboardService'

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
    const sheet = workbookStore.activeSheet
    if (!sheet) return

    // ---- 垂直：按实际行高累加 ----
    const DEFAULT_ROW_H = 24
    const COL_HEADER_H = 24
    let cellTop = COL_HEADER_H
    for (let r = 0; r < row; r++) {
      cellTop += sheet.rowHeights.get(r) ?? DEFAULT_ROW_H
    }
    const cellHeight = sheet.rowHeights.get(row) ?? DEFAULT_ROW_H
    const cellBottom = cellTop + cellHeight
    const vpTop = el.scrollTop
    const vpBottom = vpTop + el.clientHeight

    if (cellTop < vpTop) {
      el.scrollTop = Math.max(0, cellTop - JUMP_ROWS * DEFAULT_ROW_H - 1)
    } else if (cellBottom > vpBottom) {
      el.scrollTop = cellTop - el.clientHeight + cellHeight + JUMP_ROWS * DEFAULT_ROW_H + 1
    }

    // ---- 水平：按实际列宽累加 ----
    const DEFAULT_COL_W = 100
    const ROW_HEADER_W = 48
    let cellLeft = ROW_HEADER_W
    for (let c = 0; c < col; c++) {
      cellLeft += sheet.columnWidths.get(c) ?? DEFAULT_COL_W
    }
    const cellWidth = sheet.columnWidths.get(col) ?? DEFAULT_COL_W
    const cellRight = cellLeft + cellWidth
    const vpLeft = el.scrollLeft
    const vpRight = vpLeft + el.clientWidth

    if (cellLeft < vpLeft) {
      el.scrollLeft = Math.max(0, cellLeft - JUMP_COLS * DEFAULT_COL_W - 1)
    } else if (cellRight > vpRight) {
      el.scrollLeft = cellLeft - el.clientWidth + cellWidth + JUMP_COLS * DEFAULT_COL_W + 1
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    // ---- 剪贴板快捷键（编辑模式和非编辑模式均生效） ----
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const sheet = workbookStore.activeSheet
      if (!sheet) return

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        const range = uiStore.getSelectionRange()
        copySelection(sheet, range.startRef, range.endRef)
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        const range = uiStore.getSelectionRange()
        cutSelection(sheet, range.startRef, range.endRef)
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        handlePaste()
        return
      }
      // Ctrl+Shift+= → 在下方插入行
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        const parsed = parseCellRef(uiStore.activeRef)
        if (parsed) workbookStore.insertRow(parsed.row)
        return
      }
      // Ctrl+- → 删除当前行
      if (e.key === '-') {
        e.preventDefault()
        const parsed = parseCellRef(uiStore.activeRef)
        if (parsed) workbookStore.deleteRow(parsed.row)
        return
      }
    }

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

  /** 粘贴：从剪贴板读取 → 计算映射 → 批量写入 */
  async function handlePaste(): Promise<void> {
    const sheet = workbookStore.activeSheet
    if (!sheet) return
    const active = uiStore.activeRef
    const data = await readClipboardForPaste()
    if (data.length === 0) return
    const cells = computePasteCells(sheet, active, data)
    workbookStore.pasteCells(cells)
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
