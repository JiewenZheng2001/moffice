import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CellRef, CellRange } from '@/model/types'

/**
 * UI Store —— 持有选区、焦点、工具栏状态等纯 UI 状态
 */
export const useUiStore = defineStore('ui', () => {
  // ---- 选区 ----
  const activeRef = ref<CellRef>('A1')
  const selection = ref<CellRange | null>(null)
  const isEditing = ref(false)

  // ---- Actions ----
  function selectCell(ref: CellRef): void {
    activeRef.value = ref
    selection.value = { startRef: ref, endRef: ref }
    isEditing.value = false
  }

  function startEdit(): void {
    isEditing.value = true
  }

  function cancelEdit(): void {
    isEditing.value = false
  }

  return {
    activeRef,
    selection,
    isEditing,
    selectCell,
    startEdit,
    cancelEdit,
  }
})
