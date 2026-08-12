import { onMounted, onUnmounted, type Ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorkbookStore } from '@/stores/workbookStore'
import { parseRef, toCellRef } from '@/utils/columnUtils'
import type { CellFormat } from '@/model/types'
import {
  clipboardManager,
  serializeSelection,
  computePasteCells,
  getSelectionBounds,
  parseTSV,
} from '@/services/clipboardManager'
import type { SelectionBounds } from '@/services/clipboardManager'
import { CutPasteCommand } from '@/model/command'
import { commandService } from '@/services/commandService'
import { saveWorkbook } from '@/services/workbookService'
import { isLoggedIn } from '@/services/authService'

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

  async function handleKeydown(e: KeyboardEvent): Promise<void> {
    // ---- 剪贴板快捷键（编辑模式和非编辑模式均生效） ----
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const sheet = workbookStore.activeSheet
      if (!sheet) return

      // 如果焦点在任何输入框内，让浏览器原生处理剪贴板
      const isInputFocused = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'

      if (e.key === 'c' || e.key === 'C') {
        if (isInputFocused) return
        e.preventDefault()
        const range = uiStore.getSelectionRange()
        const bounds = getSelectionBounds(range.startRef, range.endRef)
        const tsv = serializeSelection(sheet, bounds)
        clipboardManager.startCopy(
          { startRef: range.startRef, endRef: range.endRef },
          tsv,
        )
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        if (isInputFocused) return
        e.preventDefault()
        const range = uiStore.getSelectionRange()
        const bounds = getSelectionBounds(range.startRef, range.endRef)
        const tsv = serializeSelection(sheet, bounds)
        clipboardManager.startCut(
          { startRef: range.startRef, endRef: range.endRef },
          tsv,
        )
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        if (isInputFocused) return
        e.preventDefault()

        // 源选区：剪切/复制虚线框位置（公式相对引用偏移需要）
        const sourceBounds = clipboardManager.sourceRange
          ? getSelectionBounds(clipboardManager.sourceRange.startRef, clipboardManager.sourceRange.endRef)
          : null
        // 是否剪切模式：只有剪切粘贴才清空源格
        const isCutPaste = clipboardManager.isCutMode

        await handlePaste(isCutPaste ? sourceBounds : null, sourceBounds)

        // 剪切粘贴后退出剪切模式（清空虚线框 + 剪贴板）
        if (isCutPaste) {
          clipboardManager.exitCutMode()
        }
        return
      }
      // Ctrl+Shift+= → 在下方插入行
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        const parsed = parseRef(uiStore.activeRef)
        if (parsed) workbookStore.insertRow(parsed.row)
        return
      }
      // Ctrl+- → 删除当前行
      if (e.key === '-') {
        e.preventDefault()
        const parsed = parseRef(uiStore.activeRef)
        if (parsed) workbookStore.deleteRow(parsed.row)
        return
      }
      // Ctrl+Z → 撤销
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        workbookStore.undo()
        return
      }
      // Ctrl+Y / Ctrl+Shift+Z → 重做
      if (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault()
        workbookStore.redo()
        return
      }
      // Ctrl+S → 保存到后端（需登录）
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        if (!isLoggedIn()) return
        const sheet = workbookStore.activeSheet
        if (sheet) void saveWorkbook(workbookStore.workbook)
        return
      }
      // Ctrl+B → 粗体切换
      if (e.key === 'b' || e.key === 'B') {
        if (isInputFocused) return
        e.preventDefault()
        toggleBold()
        return
      }
      // Ctrl+I → 斜体切换
      if (e.key === 'i' || e.key === 'I') {
        if (isInputFocused) return
        e.preventDefault()
        toggleItalic()
        return
      }
      // Ctrl+U → 下划线切换
      if (e.key === 'u' || e.key === 'U') {
        if (isInputFocused) return
        e.preventDefault()
        toggleUnderline()
        return
      }
    }

    // Escape → 退出剪切/复制模式 / 格式刷（无论焦点在哪）
    if (e.key === 'Escape') {
      if (clipboardManager.isActive) {
        clipboardManager.exitAllModes()
        return
      }
      if (uiStore.isPainting) {
        uiStore.exitPainting()
        return
      }
    }

    // 如果事件来自输入框（编辑中），不处理方向键等导航 — 但允许 Tab/Enter/Escape 穿透
    if ((e.target as HTMLElement)?.tagName === 'INPUT') {
      if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Escape') return
    }

    const active = uiStore.activeRef
    const parsed = parseRef(active)
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
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          // 清空整个选区（原子命令，可撤销）
          workbookStore.clearCells(getSelectedRefs())
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
          break
        case 'Tab':
          e.preventDefault()
          uiStore.cancelEdit()
          navigateTo(row, col + 1)
          break
        case 'F2':
          e.preventDefault()
          break
      }
    }
  }

  /** 获取当前选区内的所有单元格引用 */
  function getSelectedRefs(): string[] {
    const range = uiStore.getSelectionRange()
    const bounds = getSelectionBounds(range.startRef, range.endRef)
    const refs: string[] = []
    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        refs.push(toCellRef(r, c))
      }
    }
    return refs
  }

  /** 当前选区激活格的格式（读当前值用于 toggle） */
  function getActiveCellFormat(): CellFormat {
    const sheet = workbookStore.activeSheet
    const cell = sheet?.cells.get(uiStore.activeRef)
    return cell?.format ?? {}
  }

  /** Ctrl+B：粗体开关（以激活格当前状态为准，反转为新值） */
  function toggleBold(): void {
    const fmt = getActiveCellFormat()
    workbookStore.applyFormat(getSelectedRefs(), { bold: !fmt.bold })
  }

  /** Ctrl+I：斜体开关 */
  function toggleItalic(): void {
    const fmt = getActiveCellFormat()
    workbookStore.applyFormat(getSelectedRefs(), { italic: !fmt.italic })
  }

  /** Ctrl+U：下划线开关 */
  function toggleUnderline(): void {
    const fmt = getActiveCellFormat()
    workbookStore.applyFormat(getSelectedRefs(), { underline: !fmt.underline })
  }

  /**
   * 粘贴：
   * - 普通粘贴：从剪贴板读取 → 映射到单元格 → 批量写入（公式偏移 + 求值）
   * - 剪切模式粘贴：清空源格 + 粘贴目标 → 打包为一个原子命令
   * @param cutSourceBounds 剪切模式的源区（非 null 时清空源格）
   * @param offsetSourceBounds 公式相对引用偏移的源区（剪切/复制模式都有）
   */
  async function handlePaste(
    cutSourceBounds: SelectionBounds | null,
    offsetSourceBounds: SelectionBounds | null = null,
  ): Promise<void> {
    const sheet = workbookStore.activeSheet
    if (!sheet) return
    const active = uiStore.activeRef

    // 从系统剪贴板读取（降级时用 clipboardManager 缓存）
    const clipText = await clipboardManager.readSystemClipboard()
    const data = parseTSV(clipText)
    if (data.length === 0) return

    // 公式相对引用按源区偏移量平移
    const pasteCells = computePasteCells(sheet, active, data, offsetSourceBounds)

    if (cutSourceBounds) {
      // 剪切模式粘贴 → 原子命令（清空源格 + 写入目标）
      // skipClipboardReset：剪切模式的退出由调用方（Ctrl+V 分支）统一处理
      const sourceRefs: string[] = []
      for (let r = cutSourceBounds.startRow; r <= cutSourceBounds.endRow; r++) {
        for (let c = cutSourceBounds.startCol; c <= cutSourceBounds.endCol; c++) {
          sourceRefs.push(toCellRef(r, c))
        }
      }
      commandService.execute(
        new CutPasteCommand(sheet, sourceRefs, pasteCells, clipboardManager.tsvCache),
        { skipClipboardReset: true },
      )
      // 剪切粘贴的公式统一求值（偏移后的公式字符串 → 计算 + 依赖注册）
      workbookStore.evaluatePastedFormulas(pasteCells)
    } else {
      // 普通粘贴（含公式求值）
      workbookStore.pasteCells(pasteCells)
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
