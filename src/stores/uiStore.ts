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

  function selectCell(ref: CellRef): void {
    activeRef.value = ref
    selection.value = { startRef: ref, endRef: ref }
    isEditing.value = false
  }

  /** 开始矩形选区拖拽（不立即设 isDragging，防止点击触发的滚动导致误拖拽） */
  function startRangeSelection(ref: CellRef): void {
    selectCell(ref)
  }

  /** 拖拽中扩展选区（首次调用才设 isDragging） */
  function extendSelection(ref: CellRef): void {
    if (!selection.value) return
    if (!isDragging.value) {
      isDragging.value = true
    }
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

  function startEdit(): void { isEditing.value = true }
  function cancelEdit(): void { isEditing.value = false }

  return {
    activeRef, selection, isEditing, isDragging,
    selectCell, startRangeSelection, extendSelection, finishSelection,
    isInSelection, startEdit, cancelEdit,
  }
})
