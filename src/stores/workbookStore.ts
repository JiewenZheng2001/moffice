import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workbook, Sheet } from '@/model/types'

/**
 * 工作簿 Store —— 持有 Workbook 数据模型
 * 所有数据变更必须通过 Action，禁止组件直接修改 state
 */
export const useWorkbookStore = defineStore('workbook', () => {
  // ---- State ----
  const workbook = ref<Workbook>({
    id: 'default',
    name: '未命名表格',
    sheets: [],
    activeSheetId: '',
  })

  // ---- Getters ----
  const activeSheet = computed<Sheet | undefined>(() =>
    workbook.value.sheets.find((s) => s.id === workbook.value.activeSheetId),
  )

  // ---- Actions ----
  function addSheet(name: string): void {
    const id = `sheet-${Date.now()}`
    const sheet: Sheet = {
      id,
      name,
      cells: new Map(),
      rowCount: 200,
      columnCount: 26,
      columnWidths: new Map(),
      rowHeights: new Map(),
      tabColor: null,
    }
    workbook.value.sheets.push(sheet)
    if (!workbook.value.activeSheetId) {
      workbook.value.activeSheetId = id
    }
  }

  function setActiveSheet(sheetId: string): void {
    workbook.value.activeSheetId = sheetId
  }

  // 确保始终有一个默认 Sheet
  if (workbook.value.sheets.length === 0) {
    addSheet('Sheet1')
  }

  return {
    workbook,
    activeSheet,
    addSheet,
    setActiveSheet,
  }
})
