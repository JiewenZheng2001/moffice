import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CellRef, CellRange } from '@/model/types'
import { parseRef, indexToCol } from '@/utils/columnUtils'
import { clipboardManager } from '@/services/clipboardManager'

/**
 * UI Store —— 管理选区、编辑、拖拽等纯 UI 状态
 *
 * 剪贴板状态（剪切/复制虚线框）由 ClipboardManager 服务统一管理，
 * uiStore 只暴露 computed 只读视图 + 委托方法。
 */
export const useUiStore = defineStore('ui', () => {
  const activeRef = ref<CellRef>('A1')
  const selection = ref<CellRange | null>(null)
  const isEditing = ref(false)
  const isDragging = ref(false)

  // ---- 剪贴板状态（委托给 ClipboardManager，这里只暴露只读视图） ----

  /** 剪切模式虚线框范围（只读，修改请通过 clipboardManager） */
  const cutRange = computed<CellRange | null>(() =>
    clipboardManager.isCutMode ? clipboardManager.sourceRange : null,
  )

  /** 复制模式虚线框范围（只读，修改请通过 clipboardManager） */
  const copyRange = computed<CellRange | null>(() =>
    clipboardManager.isCopyMode ? clipboardManager.sourceRange : null,
  )

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
    // 编辑操作结束所有虚线框模式
    clipboardManager.exitAllModes()
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
    const s = parseRef(sel.startRef)
    const e = parseRef(sel.endRef)
    if (!s || !e) return { startRef: activeRef.value, endRef: activeRef.value }
    const startRow = Math.min(s.row, e.row)
    const endRow = Math.max(s.row, e.row)
    const startCol = Math.min(s.col, e.col)
    const endCol = Math.max(s.col, e.col)
    return {
      startRef: `${indexToCol(startCol)}${startRow + 1}`,
      endRef: `${indexToCol(endCol)}${endRow + 1}`,
    }
  }

  // ---- 剪切/复制模式（委托给 ClipboardManager） ----

  /** 进入剪切模式 */
  function setCutRange(range: CellRange): void {
    // tsv 已在调用方通过 serializeSelection 计算，此处保持兼容
    clipboardManager.startCut(range, clipboardManager.tsvCache)
  }

  /** 进入复制模式 */
  function setCopyRange(range: CellRange): void {
    clipboardManager.startCopy(range, clipboardManager.tsvCache)
  }

  /** 退出剪切模式 */
  function clearCutRange(): void {
    clipboardManager.exitCutMode()
  }

  /** 退出复制模式 */
  function clearCopyRange(): void {
    clipboardManager.exitCopyMode()
  }

  /** 退出所有虚线框模式（数据变更时调用） */
  function clearAllRanges(): void {
    clipboardManager.exitAllModes()
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
