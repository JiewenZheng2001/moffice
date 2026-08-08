import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workbook, Sheet, CellRef, CellValue, CellFormat } from '@/model/types'
import { SetCellCommand, PasteCommand, SetCellFormatCommand, InsertRowCommand, DeleteRowCommand, InsertColumnCommand, DeleteColumnCommand } from '@/model/command'
import { commandService } from '@/services/commandService'
import { clipboardManager } from '@/services/clipboardManager'
import { applyImport, type ImportedSheet } from '@/services/importService'
import { useFormulaStore } from './formulaStore'

/**
 * 工作簿 Store —— 持有 Workbook 数据模型
 * 所有数据变更必须通过 CommandService → Command 执行（支持撤销/重做）
 *
 * 注意：setCellValue 不再负责清除剪切/复制模式 —
 * 该职责由 commandService.execute() 统一处理。
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
      // 首个 Sheet 创建时同步依赖图上下文
      useFormulaStore().setActiveSheetContext(id)
    }
  }

  function setActiveSheet(sheetId: string): void {
    workbook.value.activeSheetId = sheetId
    // 切换 Sheet → 清空命令栈（避免 Ctrl+Z 作用于错误的 Sheet）
    commandService.clear()
    // 退出剪贴板模式（虚线框属于旧 Sheet 的选区）
    clipboardManager.exitAllModes()
    // 同步公式依赖图上下文（不同 Sheet 的依赖图 key 隔离）
    useFormulaStore().setActiveSheetContext(sheetId)
  }

  /**
   * 导入替换整个工作簿（打开文件语义）
   * - 用导入的 sheets 替换现有所有 sheets
   * - 清空命令栈（导入不可撤销，等价于打开新文件）
   * - 激活第一个导入的 sheet
   */
  function importSheets(imported: ImportedSheet[]): void {
    if (imported.length === 0) return
    const newSheets: Sheet[] = imported.map((imp, i) => {
      const id = `sheet-${Date.now()}-${i}`
      const sheet: Sheet = {
        id,
        name: imp.name,
        cells: new Map(),
        rowCount: 200,
        columnCount: 26,
        columnWidths: new Map(),
        rowHeights: new Map(),
        tabColor: null,
      }
      applyImport(sheet, imp)
      return sheet
    })
    workbook.value.sheets = newSheets
    workbook.value.activeSheetId = newSheets[0].id
    commandService.clear()
    clipboardManager.exitAllModes()
    useFormulaStore().setActiveSheetContext(newSheets[0].id)
  }

  /**
   * 设置单元格值（通过命令模式，支持撤销）
   * 自动检测公式（以 "=" 开头），交由公式引擎计算
   * 自动将数值型字符串转为 number（如 "3" → 3）
   *
   * 注意：不再直接清除剪切/复制模式，由 commandService.execute() 统一处理
   */
  function setCellValue(ref: CellRef, value: CellValue): void {
    const sheet = activeSheet.value
    if (!sheet) return

    // 非公式的字符串值自动转为数值（Excel 标准行为）
    if (typeof value === 'string' && !value.startsWith('=')) {
      const num = parseNumeric(value)
      if (num !== null) {
        value = num
      }
    }

    // 检测公式：以 "=" 开头的字符串
    if (typeof value === 'string' && value.startsWith('=')) {
      const formulaStore = useFormulaStore()
      const result = formulaStore.compute(value, sheet)
      let computedValue = result.value

      // 如果不是循环引用，更新依赖图；若检测到环，结果改为 #CIRCULAR!
      if (computedValue !== '#CIRCULAR!') {
        const cycle = formulaStore.setDeps(ref, result.deps)
        if (cycle) {
          computedValue = '#CIRCULAR!'
        }
      }

      // 用计算后的值创建命令（commandService.execute 会自动退出剪贴板模式）
      commandService.execute(new SetCellCommand(sheet, ref, computedValue, value))

      // 传播重算：重新计算所有依赖此格的公式
      const affected = formulaStore.getAffectedCells(ref)
      for (const affectedRef of affected) {
        const cell = sheet.cells.get(affectedRef)
        if (cell && cell.formula) {
          const r = formulaStore.compute(cell.formula, sheet)
          cell.computedValue = r.value
          cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
          formulaStore.setDeps(affectedRef, r.deps)
        }
      }
      return
    }

    // 普通值：直接写入
    // 如果之前是公式格，清除依赖
    const oldCell = sheet.cells.get(ref)
    if (oldCell?.formula) {
      const formulaStore = useFormulaStore()
      formulaStore.removeDeps(ref)
    }
    commandService.execute(new SetCellCommand(sheet, ref, value))

    // 传播重算（抹掉公式后，引用此格的公式需要反映变化）
    const formulaStore = useFormulaStore()
    const affected = formulaStore.getAffectedCells(ref)
    for (const affectedRef of affected) {
      const cell = sheet.cells.get(affectedRef)
      if (cell && cell.formula) {
        const r = formulaStore.compute(cell.formula, sheet)
        cell.computedValue = r.value
        cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
        formulaStore.setDeps(affectedRef, r.deps)
      }
    }
  }

  /** 手动添加指定数量的行（纯视图操作，不进命令栈） */
  function addRows(count: number): void {
    const sheet = activeSheet.value
    if (sheet && count > 0) {
      sheet.rowCount += count
    }
  }

  /** 批量粘贴单元格（通过命令模式）
   * 注意：粘贴不退出剪贴板模式（复制模式粘贴后保留虚线框，由调用方管理）
   */
  function pasteCells(cells: Map<CellRef, CellValue>): void {
    const sheet = activeSheet.value
    if (!sheet) return
    commandService.execute(new PasteCommand(sheet, cells), { skipClipboardReset: true })
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

  /**
   * 对一组单元格批量应用格式（通过命令模式，支持撤销）
   * @param refs 目标单元格（可为空单元格）
   * @param formatPatch 格式片段（如 { bold: true }，只改指定字段）
   */
  function applyFormat(refs: CellRef[], formatPatch: Partial<CellFormat>): void {
    const sheet = activeSheet.value
    if (!sheet || refs.length === 0) return
    commandService.execute(new SetCellFormatCommand(sheet, refs, formatPatch))
  }

  // ---- 撤销/重做（含依赖传播 + 剪切状态恢复） ----

  function undo(): void {
    const command = commandService.undo()
    if (!command) return
    recalcAffected(command)
    restoreCutRange(command)
  }

  function redo(): void {
    const command = commandService.redo()
    if (!command) return
    recalcAffected(command)
    restoreCutRange(command)
  }

  /**
   * 如果命令关联剪切/复制操作，恢复剪贴板状态机 + 虚线框 UI
   * 通过 ClipboardManager 统一恢复，确保系统剪贴板也被回写
   */
  function restoreCutRange(command: { getSourceRefs?(): string[] }): void {
    if (!command.getSourceRefs) return
    const refs = command.getSourceRefs()
    if (refs.length === 0) return
    const sorted = [...refs].sort()
    const range = { startRef: sorted[0], endRef: sorted[sorted.length - 1] }

    // 恢复剪切模式 + 虚线框 + 系统剪贴板
    clipboardManager.restoreMode('cut', range)
  }

  /** undo/redo 后重算受影响的公式（含依赖传播） */
  function recalcAffected(command: { getAffectedRefs(): string[]; needsRecalc?(): boolean }): void {
    // 纯格式命令不改变值 → 跳过重算
    if (command.needsRecalc?.() === false) return
    const sheet = activeSheet.value
    if (!sheet) return
    const formulaStore = useFormulaStore()
    const refs = command.getAffectedRefs()

    if (refs.length === 0) {
      // 行列操作：做全量公式重算
      for (const [ref, cell] of sheet.cells) {
        if (cell.formula) {
          const r = formulaStore.compute(cell.formula, sheet)
          cell.computedValue = r.value
          cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
          formulaStore.setDeps(ref, r.deps)
        }
      }
    } else {
      // 精确重算：遍历受影响的格 + 其依赖
      const visited = new Set<string>()
      const queue = [...refs]
      while (queue.length > 0) {
        const ref = queue.shift()!
        if (visited.has(ref)) continue
        visited.add(ref)

        // 如果该格有公式，重新求值
        const cell = sheet.cells.get(ref)
        if (cell && cell.formula) {
          const r = formulaStore.compute(cell.formula, sheet)
          cell.computedValue = r.value
          cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
          formulaStore.setDeps(ref, r.deps)
        }

        // BFS：该格的依赖者也需要重算
        const deps = formulaStore.getAffectedCells(ref)
        for (const d of deps) {
          if (!visited.has(d)) queue.push(d)
        }
      }
    }
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
    importSheets,
    setCellValue,
    addRows,
    pasteCells,
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    applyFormat,
    undo,
    redo,
  }
})

/**
 * 尝试将字符串解析为数值
 * 支持：整数 "3"、小数 "3.14"、负号 "-5"
 * 返回 null 表示不是数值字符串
 */
function parseNumeric(s: string): number | null {
  // 去除首尾空格后检查是否全为合法数值字符
  const trimmed = s.trim()
  if (trimmed === '') return null
  // 只允许数字、负号、小数点
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = parseFloat(trimmed)
    return isNaN(n) ? null : n
  }
  return null
}
