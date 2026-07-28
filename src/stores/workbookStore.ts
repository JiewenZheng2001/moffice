import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workbook, Sheet, CellRef, CellValue } from '@/model/types'
import { createCell } from '@/model/cell'
import { colToIndex, toCellRef } from '@/utils/columnUtils'

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

  /**
   * 设置单元格值
   * 替换整个 cells 对象以确保 Vue 响应式触发
   */
  function setCellValue(ref: CellRef, value: CellValue): void {
    const sheet = activeSheet.value
    if (!sheet) return

    if (value === null || value === '') {
      sheet.cells.delete(ref)
      return
    }

    const existing = sheet.cells.get(ref)
    if (existing) {
      existing.rawValue = value
      existing.computedValue = value
      existing.formula = null
      existing.error = null
    } else {
      const cell = createCell(ref)
      cell.rawValue = value
      cell.computedValue = value
      sheet.cells.set(ref, cell)
    }
  }

  /** 手动添加指定数量的行 */
  function addRows(count: number): void {
    const sheet = activeSheet.value
    if (sheet && count > 0) {
      sheet.rowCount += count
    }
  }

  /** 批量粘贴单元格 */
  function pasteCells(cells: Map<CellRef, CellValue>): void {
    const sheet = activeSheet.value
    if (!sheet) return
    for (const [ref, value] of cells) {
      if (value === null || value === '') {
        sheet.cells.delete(ref)
      } else {
        const existing = sheet.cells.get(ref)
        if (existing) {
          existing.rawValue = value
          existing.computedValue = value
          existing.formula = null
          existing.error = null
        } else {
          const cell = createCell(ref)
          cell.rawValue = value
          cell.computedValue = value
          sheet.cells.set(ref, cell)
        }
      }
    }
  }

  /** 在指定位置后插入一行，下方单元格全部下移 */
  function insertRow(afterRow: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterRow < 0 || afterRow >= sheet.rowCount) return

    sheet.rowCount++
    shiftRows(sheet, afterRow + 1, 1)
  }

  /** 删除指定行，下方单元格全部上移 */
  function deleteRow(rowIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || rowIndex < 0 || rowIndex >= sheet.rowCount || sheet.rowCount <= 1) return

    // 先删除该行所有单元格
    for (let c = 0; c < sheet.columnCount; c++) {
      sheet.cells.delete(toCellRef(rowIndex, c))
    }
    // 下方行上移
    shiftRows(sheet, rowIndex + 1, -1)
    sheet.rowCount--
  }

  /** 在指定位置后插入一列，右侧单元格全部右移 */
  function insertColumn(afterCol: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterCol < 0 || afterCol >= sheet.columnCount) return

    sheet.columnCount++
    shiftColumns(sheet, afterCol + 1, 1)
  }

  /** 删除指定列，右侧单元格全部左移 */
  function deleteColumn(colIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || colIndex < 0 || colIndex >= sheet.columnCount || sheet.columnCount <= 1) return

    for (let r = 0; r < sheet.rowCount; r++) {
      sheet.cells.delete(toCellRef(r, colIndex))
    }
    shiftColumns(sheet, colIndex + 1, -1)
    sheet.columnCount--
  }

  // 确保始终有一个默认 Sheet
  if (workbook.value.sheets.length === 0) {
    addSheet('Sheet1')
  }

  /** 行位移辅助：从 fromRow 起，所有行 +delta */
  function shiftRows(sheet: Sheet, fromRow: number, delta: number): void {
    const affected: { oldRef: CellRef; cell: ReturnType<typeof createCell> }[] = []
    for (const [ref, cell] of sheet.cells) {
      const m = ref.match(/^([A-Z]+)(\d+)$/i)
      if (!m) continue
      const row = parseInt(m[2], 10) - 1
      if (row >= fromRow) {
        affected.push({ oldRef: ref, cell })
      }
    }
    for (const { oldRef } of affected) {
      sheet.cells.delete(oldRef)
    }
    for (const { cell } of affected) {
      const m = cell.id.match(/^([A-Z]+)(\d+)$/i)!
      const col = colToIndex(m[1].toUpperCase())
      const newRow = parseInt(m[2], 10) - 1 + delta
      if (newRow >= 0 && newRow < sheet.rowCount) {
        const newRef = toCellRef(newRow, col)
        cell.id = newRef
        sheet.cells.set(newRef, cell)
      }
    }
  }

  /** 列位移辅助：从 fromCol 起，所有列 +delta */
  function shiftColumns(sheet: Sheet, fromCol: number, delta: number): void {
    const affected: { oldRef: CellRef; cell: ReturnType<typeof createCell> }[] = []
    for (const [ref, cell] of sheet.cells) {
      const m = ref.match(/^([A-Z]+)(\d+)$/i)
      if (!m) continue
      const col = colToIndex(m[1].toUpperCase())
      if (col >= fromCol) {
        affected.push({ oldRef: ref, cell })
      }
    }
    for (const { oldRef } of affected) {
      sheet.cells.delete(oldRef)
    }
    for (const { cell } of affected) {
      const m = cell.id.match(/^([A-Z]+)(\d+)$/i)!
      const row = parseInt(m[2], 10) - 1
      const newCol = colToIndex(m[1].toUpperCase()) + delta
      if (newCol >= 0 && newCol < sheet.columnCount) {
        const newRef = toCellRef(row, newCol)
        cell.id = newRef
        sheet.cells.set(newRef, cell)
      }
    }
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
  }
})
