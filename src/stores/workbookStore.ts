import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workbook, Sheet, CellRef, CellValue } from '@/model/types'
import { SetCellCommand, PasteCommand, InsertRowCommand, DeleteRowCommand, InsertColumnCommand, DeleteColumnCommand } from '@/model/command'
import { commandService } from '@/services/commandService'

/**
 * 工作簿 Store —— 持有 Workbook 数据模型
 * 所有数据变更必须通过 CommandService → Command 执行（支持撤销/重做）
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

  /**
   * 设置单元格值（通过命令模式，支持撤销）
   */
  function setCellValue(ref: CellRef, value: CellValue): void {
    const sheet = activeSheet.value
    if (!sheet) return
    commandService.execute(new SetCellCommand(sheet, ref, value))
  }

  /** 手动添加指定数量的行（纯视图操作，不进命令栈） */
  function addRows(count: number): void {
    const sheet = activeSheet.value
    if (sheet && count > 0) {
      sheet.rowCount += count
    }
  }

  /** 批量粘贴单元格（通过命令模式） */
  function pasteCells(cells: Map<CellRef, CellValue>): void {
    const sheet = activeSheet.value
    if (!sheet) return
    commandService.execute(new PasteCommand(sheet, cells))
  }

  /** 在指定位置后插入一行 */
  function insertRow(afterRow: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterRow < 0 || afterRow >= sheet.rowCount) return
    commandService.execute(new InsertRowCommand(sheet, afterRow))
  }

  /** 删除指定行 */
  function deleteRow(rowIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || rowIndex < 0 || rowIndex >= sheet.rowCount || sheet.rowCount <= 1) return
    commandService.execute(new DeleteRowCommand(sheet, rowIndex))
  }

  /** 在指定位置后插入一列 */
  function insertColumn(afterCol: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterCol < 0 || afterCol >= sheet.columnCount) return
    commandService.execute(new InsertColumnCommand(sheet, afterCol))
  }

  /** 删除指定列 */
  function deleteColumn(colIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || colIndex < 0 || colIndex >= sheet.columnCount || sheet.columnCount <= 1) return
    commandService.execute(new DeleteColumnCommand(sheet, colIndex))
  }

  // ---- 撤销/重做 ----

  function undo(): void {
    commandService.undo()
  }

  function redo(): void {
    commandService.redo()
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
    setCellValue,
    addRows,
    pasteCells,
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    undo,
    redo,
  }
})
