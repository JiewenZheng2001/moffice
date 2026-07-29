import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CellRef, CellRange } from '@/model/types'
import { colToIndex } from '@/utils/columnUtils'

/** 解析 "A1" → { col: 0, row: 0 } */
function parseRef(ref: CellRef): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colToIndex(m[1].toUpperCase()),
    row: parseInt(m[2], 10) - 1,
  }
}

export const useUiStore = defineStore('ui', () => {
  const activeRef = ref<CellRef>('A1')
  const selection = ref<CellRange | null>(null)
  const isEditing = ref(false)
  const isDragging = ref(false)

  /** 剪切模式：Excel 虚线框标记的源区域，粘贴后清空并复位 */
  const cutRange = ref<CellRange | null>(null)

  /** 复制模式：虚线框标记的源区域，粘贴后不清空也不复位 */
  const copyRange = ref<CellRange | null>(null)

  // 列宽/行高拖拽调整状态
  const resizeState = ref<{
    type: 'col' | 'row'
    index: number
    startX: number
    startY: number
    startSize: number
  } | null>(null)

  function selectCell(ref: CellRef): void {
    activeRef.value = ref
    selection.value = { startRef: ref, endRef: ref }
    isEditing.value = false
  }

  /** 开始矩形选区拖拽 */
  function startRangeSelection(ref: CellRef): void {
    isDragging.value = true
    selectCell(ref)
  }

  /** 拖拽中扩展选区 */
  function extendSelection(ref: CellRef): void {
    if (!selection.value || !isDragging.value) return
    selection.value = { ...selection.value, endRef: ref }
  }

  /** 结束拖拽 */
  function finishSelection(): void {
    isDragging.value = false
  }

  /**
   * 判断指定单元格是否在当前选区内
   * 比较行列号，不区分 start/end 顺序
   */
  function isInSelection(ref: CellRef): boolean {
    if (!selection.value) return false
    const s = parseRef(selection.value.startRef)
    const e = parseRef(selection.value.endRef)
    const c = parseRef(ref)
    if (!s || !e || !c) return false

    const minRow = Math.min(s.row, e.row)
    const maxRow = Math.max(s.row, e.row)
    const minCol = Math.min(s.col, e.col)
    const maxCol = Math.max(s.col, e.col)

    return c.row >= minRow && c.row <= maxRow && c.col >= minCol && c.col <= maxCol
  }

  function startEdit(): void {
    isEditing.value = true
    // 编辑操作结束所有虚线框模式（剪切+复制均被打断）
    clearAllRanges()
  }
  function cancelEdit(): void { isEditing.value = false }

  function startResize(type: 'col' | 'row', index: number, startX: number, startY: number, startSize: number): void {
    resizeState.value = { type, index, startX, startY, startSize }
  }
  function updateResize(x: number, y: number): number {
    if (!resizeState.value) return 0
    const diff = resizeState.value.type === 'col' ? x - resizeState.value.startX : y - resizeState.value.startY
    return Math.max(20, resizeState.value.startSize + diff) // 最小 20px
  }
  function finishResize(): void {
    resizeState.value = null
  }

  /** 获取当前选区的归一化边界（用于复制粘贴等操作） */
  function getSelectionRange(): { startRef: CellRef; endRef: CellRef } {
    const sel = selection.value
    if (!sel) return { startRef: activeRef.value, endRef: activeRef.value }
    // 交换确保 start 在左上角
    const s = parseRef(sel.startRef)
    const e = parseRef(sel.endRef)
    if (!s || !e) return { startRef: activeRef.value, endRef: activeRef.value }
    const startRow = Math.min(s.row, e.row)
    const endRow = Math.max(s.row, e.row)
    const startCol = Math.min(s.col, e.col)
    const endCol = Math.max(s.col, e.col)
    return {
      startRef: `${colToIndexStr(startCol)}${startRow + 1}`,
      endRef: `${colToIndexStr(endCol)}${endRow + 1}`,
    }
  }

  // ---- 剪切/复制模式 ----

  /** 进入剪切模式（粘贴后清空源格 + 清除虚线框） */
  function setCutRange(range: CellRange): void {
    cutRange.value = range
    copyRange.value = null
  }

  /** 进入复制模式（粘贴后保留源格和虚线框） */
  function setCopyRange(range: CellRange): void {
    copyRange.value = range
    cutRange.value = null
  }

  /** 退出剪切模式（同时清空剪贴板） */
  function clearCutRange(): void {
    if (cutRange.value) {
      cutRange.value = null
      clearClipboard()
    }
  }

  /** 退出复制模式 */
  function clearCopyRange(): void {
    copyRange.value = null
  }

  /** 退出所有虚线框模式（同时清空剪贴板） */
  function clearAllRanges(): void {
    if (cutRange.value) {
      clearClipboard()
    }
    cutRange.value = null
    copyRange.value = null
  }

  return {
    activeRef, selection, isEditing, isDragging,
    selectCell, startRangeSelection, extendSelection, finishSelection,
    isInSelection, startEdit, cancelEdit, getSelectionRange,
    resizeState, startResize, updateResize, finishResize,
    cutRange, copyRange,
    setCutRange, setCopyRange, clearCutRange, clearCopyRange, clearAllRanges,
  }
})

// 辅助：数字 → 列字母
function colToIndexStr(col: number): string {
  let result = ''
  while (col >= 0) {
    result = String.fromCharCode(65 + (col % 26)) + result
    col = Math.floor(col / 26) - 1
  }
  return result
}

/** 清空系统剪贴板 */
async function clearClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText('')
  } catch { /* 非 HTTPS 环境降级 */ }
}
