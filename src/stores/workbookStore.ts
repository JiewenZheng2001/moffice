import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Workbook, Sheet, CellRef, CellValue, CellFormat } from '@/model/types'
import type { ICommand } from '@/model/command'
import { SetCellCommand, PasteCommand, SetCellFormatCommand, InsertRowCommand, DeleteRowCommand, InsertColumnCommand, DeleteColumnCommand } from '@/model/command'
import { createSheet } from '@/model/sheet'
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
  /**
   * 工作簿 id 持久化到 localStorage：
   * 刷新页面后 id 保持稳定，登录用户可自动恢复上次的工作簿，
   * 避免"刷新后是新表、自动保存产生重复记录"的问题
   */
  const WORKBOOK_ID_KEY = 'moffice_workbook_id'

  function loadPersistedId(): string {
    const saved = localStorage.getItem(WORKBOOK_ID_KEY)
    if (saved) return saved
    const id = `wb-${Date.now()}`
    localStorage.setItem(WORKBOOK_ID_KEY, id)
    return id
  }

  function persistId(id: string): void {
    localStorage.setItem(WORKBOOK_ID_KEY, id)
  }

  const workbook = ref<Workbook>({
    id: loadPersistedId(),
    name: '未命名表格',
    sheets: [],
    activeSheetId: '',
  })

  /** 加载/替换工作簿后置 true，Toolbar 自动保存 watch 消费后跳过回写 */
  const autoSaveSuppressed = ref(false)

  // ---- Getters ----
  const activeSheet = computed<Sheet | undefined>(() =>
    workbook.value.sheets.find((s) => s.id === workbook.value.activeSheetId),
  )

  // ---- Actions ----
  /** 自增计数器：防止同一毫秒内创建多个 sheet 时 id 冲突 */
  let sheetSeq = 0
  function nextSheetId(): string {
    sheetSeq++
    return `sheet-${Date.now()}-${sheetSeq}`
  }

  /**
   * 自动生成不重名的 sheet 名（Sheet1、Sheet2...跳过已占用）
   * 为什么不用 sheets.length + 1：一旦未来支持删除 sheet，
   * 如 [Sheet1, Sheet3] 删除 Sheet3 后 length=1 → 会生成重名的 Sheet2
   */
  function nextSheetName(): string {
    const names = new Set(workbook.value.sheets.map((s) => s.name))
    let i = 1
    while (names.has(`Sheet${i}`)) i++
    return `Sheet${i}`
  }

  /**
   * 添加新 Sheet（Excel 行为：新建即激活）
   * @param name 可选；缺省时自动生成不重名名字
   * 复用 setActiveSheet：清命令栈 + 退出剪贴板模式 + 同步公式上下文
   */
  function addSheet(name?: string): void {
    const id = nextSheetId()
    const sheet: Sheet = {
      id,
      name: name?.trim() || nextSheetName(),
      cells: new Map(),
      rowCount: 200,
      columnCount: 26,
      columnWidths: new Map(),
      rowHeights: new Map(),
      tabColor: null,
    }
    workbook.value.sheets.push(sheet)
    setActiveSheet(id)
  }

  function setActiveSheet(sheetId: string): void {
    const target = workbook.value.sheets.find((s) => s.id === sheetId)
    workbook.value.activeSheetId = sheetId
    // 切换 Sheet → 清空命令栈（避免 Ctrl+Z 作用于错误的 Sheet）
    commandService.clear()
    // 退出剪贴板模式（虚线框属于旧 Sheet 的选区）
    clipboardManager.exitAllModes()
    // 同步公式依赖图上下文（不同 Sheet 的依赖图 key 隔离）
    useFormulaStore().setActiveSheetContext(sheetId, target?.name)
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
    useFormulaStore().setActiveSheetContext(newSheets[0].id, newSheets[0].name)
    autoSaveSuppressed.value = true
    persistId(workbook.value.id)
  }

  /**
   * 用后端加载的工作簿替换整个当前工作簿（打开文件语义）
   * - 保持传入的 id / name / sheets
   * - 清空命令栈（加载不可撤销）
   */
  function replaceWorkbook(loaded: Workbook): void {
    workbook.value = {
      id: loaded.id,
      name: loaded.name,
      sheets: loaded.sheets,
      activeSheetId: loaded.activeSheetId || loaded.sheets[0]?.id || '',
    }
    commandService.clear()
    clipboardManager.exitAllModes()
    if (workbook.value.activeSheetId) {
      const active = workbook.value.sheets.find((s) => s.id === workbook.value.activeSheetId)
      useFormulaStore().setActiveSheetContext(workbook.value.activeSheetId, active?.name)
    }
    autoSaveSuppressed.value = true
    persistId(loaded.id)
  }

  /** 自增计数器：新建工作簿 id 也防同毫秒冲突 */
  let wbSeq = 0
  function nextWorkbookId(): string {
    wbSeq++
    return `wb-${Date.now()}-${wbSeq}`
  }

  /**
   * 新建空白工作簿（打开"新建文件"语义）
   * - 生成新 id 并持久化（后续编辑自动保存到新记录）
   * - 清空命令栈 / 退出剪贴板模式 / 重置依赖图上下文
   * - 抑制自动保存：空白新表不立即回写后端（用户编辑后才保存）
   */
  function newWorkbook(): void {
    const id = nextWorkbookId()
    const sheet = createSheet('Sheet1')
    workbook.value = {
      id,
      name: '未命名表格',
      sheets: [sheet],
      activeSheetId: sheet.id,
    }
    commandService.clear()
    clipboardManager.exitAllModes()
    useFormulaStore().setActiveSheetContext(id, sheet.name)
    autoSaveSuppressed.value = true
    persistId(id)
  }

  /**
   * 退出登录时重置工作簿（数据隔离）
   *
   * 为什么登出必须重置：
   * - 登出 = 会话结束。内存中的表格属于上一个用户，
   *   若不清理，下一位使用同一浏览器的用户会直接看到/导出上一份数据（隐私问题）
   * - 复用 newWorkbook 语义：生成新 id 并持久化，
   *   保证登出后的本地编辑写入新记录，绝不会覆盖旧用户已保存的云端数据
   * - 云端数据不受影响：按账号存在后端，重新登录后可从工具栏"打开"列表恢复
   */
  function resetForLogout(): void {
    newWorkbook()
  }

  /**
   * 启动时自动恢复上次的工作簿（登录用户）
   * - 刷新页面后 id 稳定（localStorage），直接按 id 从后端加载
   * - 首次访问 / 后端无此 id → 静默忽略（保留空白新表）
   */
  async function restoreLastWorkbook(): Promise<boolean> {
    const id = loadPersistedId()
    try {
      const { loadWorkbook } = await import('@/services/workbookService')
      const loaded = await loadWorkbook(id)
      replaceWorkbook(loaded)
      return true
    } catch {
      // 未登录（无 token 401）或 404：保持当前空白表
      return false
    }
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
      const result = formulaStore.compute(value, sheet, workbook.value)
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

      // 传播重算：重新计算所有依赖此格的公式（含跨 sheet）
      recalcDependents(ref)
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
    recalcDependents(ref)
  }

  /**
   * 重算所有依赖指定单元格的公式（含跨 sheet）
   * getAffectedCells 返回带 sheet 名前缀的 key（"Sheet1!B1"），
   * 按名字解析目标 sheet 后重算其公式
   */
  function recalcDependents(ref: CellRef): void {
    const formulaStore = useFormulaStore()
    const affected = formulaStore.getAffectedCells(ref)
    for (const key of affected) {
      // 解析 "Sheet1!B1" → sheet 名 + 裸 ref
      const bang = key.indexOf('!')
      const targetSheet = bang >= 0
        ? workbook.value.sheets.find((s) => s.name === key.slice(0, bang))
        : activeSheet.value
      const targetRef = bang >= 0 ? key.slice(bang + 1) : key
      if (!targetSheet) continue

      const cell = targetSheet.cells.get(targetRef)
      if (cell && cell.formula) {
        const r = formulaStore.compute(cell.formula, targetSheet, workbook.value)
        cell.computedValue = r.value
        cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
        formulaStore.setDeps(targetRef, r.deps)
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

    /**
     * 两阶段粘贴（修复计算时机 bug）：
     * 1. 先执行 PasteCommand 写入所有值（含公式字符串作为 rawValue）
     * 2. 再计算公式 → 此时同批粘贴的目标格已有值，
     *    引用它们的公式（如 D1 引用同批粘贴的 C1）结果正确
     *
     * 之前的问题：在 executeBatch 前计算公式 → C1 还没写入 → D1(=C1) 算成 0
     */
    commandService.execute(new PasteCommand(sheet, cells), { skipClipboardReset: true })
    evaluatePastedFormulas(cells)
  }

  /**
   * 剪切粘贴后的公式统一求值（CutPasteCommand 只搬原始值，这里补计算）
   * 注意：此时粘贴目标已写入公式字符串（rawValue = "=..."），
   * 本函数把公式格升级为完整公式（computedValue + formula + 依赖注册）
   */
  function evaluatePastedFormulas(cells: Map<CellRef, CellValue>): void {
    const sheet = activeSheet.value
    if (!sheet) return
    const formulaCells = collectFormulaCells(cells)
    if (formulaCells.size === 0) return

    const commands: ICommand[] = []
    const formulaStore = useFormulaStore()
    for (const [ref, formula] of formulaCells) {
      const result = formulaStore.compute(formula, sheet, workbook.value)
      let computedValue = result.value
      if (computedValue !== '#CIRCULAR!') {
        const cycle = formulaStore.setDeps(ref, result.deps)
        if (cycle) computedValue = '#CIRCULAR!'
      }
      commands.push(new SetCellCommand(sheet, ref, computedValue, formula))
      recalcDependents(ref)
    }
    commandService.executeBatch(
      commands,
      `Evaluate ${formulaCells.size} pasted formulas`,
      { skipClipboardReset: true },
    )
  }

  /** 收集粘贴映射中以 "=" 开头的公式格 */
  function collectFormulaCells(cells: Map<CellRef, CellValue>): Map<CellRef, string> {
    const result = new Map<CellRef, string>()
    for (const [ref, value] of cells) {
      if (typeof value === 'string' && value.startsWith('=')) {
        result.set(ref, value)
      }
    }
    return result
  }

  /**
   * 清空选区内的所有单元格（Delete 键）
   * 通过命令模式打包为原子操作，支持一次撤销全部恢复
   * @returns 是否执行了清空
   */
  function clearCells(refs: CellRef[]): boolean {
    const sheet = activeSheet.value
    if (!sheet || refs.length === 0) return false
    // 只清空有内容的单元格，避免空操作入栈
    const targets = refs.filter((r) => sheet.cells.has(r))
    if (targets.length === 0) return false
    commandService.executeBatch(
      targets.map((r) => new SetCellCommand(sheet, r, null)),
      `Clear ${targets.length} cells`,
    )
    // 清空后删除对应依赖（公式格）
    const formulaStore = useFormulaStore()
    for (const r of targets) {
      formulaStore.removeDeps(r)
    }
    return true
  }

  /** 在指定位置后插入一行 */
  function insertRow(afterRow: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterRow < 0 || afterRow >= sheet.rowCount) return
    commandService.execute(new InsertRowCommand(sheet, afterRow))
    // 行移动会平移公式字符串（Excel 语义），但 computedValue 是旧缓存 →
    // 全量重算所有 sheet 的公式（行列操作低频，全量可接受）
    recalcAll()
  }

  /** 删除指定行 */
  function deleteRow(rowIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || rowIndex < 0 || rowIndex >= sheet.rowCount || sheet.rowCount <= 1) return
    commandService.execute(new DeleteRowCommand(sheet, rowIndex))
    recalcAll()
  }

  /** 在指定位置后插入一列 */
  function insertColumn(afterCol: number): void {
    const sheet = activeSheet.value
    if (!sheet || afterCol < 0 || afterCol >= sheet.columnCount) return
    commandService.execute(new InsertColumnCommand(sheet, afterCol))
    recalcAll()
  }

  /** 删除指定列 */
  function deleteColumn(colIndex: number): void {
    const sheet = activeSheet.value
    if (!sheet || colIndex < 0 || colIndex >= sheet.columnCount || sheet.columnCount <= 1) return
    commandService.execute(new DeleteColumnCommand(sheet, colIndex))
    recalcAll()
  }

  /**
   * 全量重算所有 sheet 的公式（行列插入/删除后调用）
   * 为什么需要：行列命令移动单元格时平移了公式字符串，
   * 但 computedValue 与依赖图还是旧位置的 —— 必须整体重算。
   * 行列操作是低频动作，O(全部公式数) 完全可接受。
   */
  function recalcAll(): void {
    const formulaStore = useFormulaStore()
    for (const targetSheet of workbook.value.sheets) {
      for (const [ref, cell] of targetSheet.cells) {
        if (cell.formula) {
          const r = formulaStore.compute(cell.formula, targetSheet, workbook.value)
          cell.computedValue = r.value
          cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
          formulaStore.setDeps(ref, r.deps)
        }
      }
    }
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

  /** undo/redo 后重算受影响的公式（含跨 sheet 依赖传播） */
  function recalcAffected(command: { getAffectedRefs(): string[]; needsRecalc?(): boolean }): void {
    // 纯格式命令不改变值 → 跳过重算
    if (command.needsRecalc?.() === false) return
    const sheet = activeSheet.value
    if (!sheet) return
    const formulaStore = useFormulaStore()
    const refs = command.getAffectedRefs()

    /** 解析 deps key（"Sheet1!B1"）→ 目标 sheet；裸 ref 用当前 sheet */
    function resolveTarget(key: string, currentSheet: Sheet): { sheet: Sheet; ref: string } | null {
      const bang = key.indexOf('!')
      if (bang < 0) return { sheet: currentSheet, ref: key }
      const targetSheet = workbook.value.sheets.find((s) => s.name === key.slice(0, bang))
      if (!targetSheet) return null
      return { sheet: targetSheet, ref: key.slice(bang + 1) }
    }

    if (refs.length === 0) {
      // 行列操作：做全量公式重算（含跨 sheet 引用的公式）
      for (const targetSheet of workbook.value.sheets) {
        for (const [ref, cell] of targetSheet.cells) {
          if (cell.formula) {
            const r = formulaStore.compute(cell.formula, targetSheet, workbook.value)
            cell.computedValue = r.value
            cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
            formulaStore.setDeps(ref, r.deps)
          }
        }
      }
    } else {
      // 精确重算：遍历受影响的格 + 其依赖（跨 sheet）
      const visited = new Set<string>()
      const queue = [...refs]
      while (queue.length > 0) {
        const key = queue.shift()!
        if (visited.has(key)) continue
        visited.add(key)

        const target = resolveTarget(key, sheet)
        if (!target) continue

        // 如果该格有公式，重新求值
        const cell = target.sheet.cells.get(target.ref)
        if (cell && cell.formula) {
          const r = formulaStore.compute(cell.formula, target.sheet, workbook.value)
          cell.computedValue = r.value
          cell.error = typeof r.value === 'string' && r.value.startsWith('#') ? r.value : null
          formulaStore.setDeps(target.ref, r.deps)
        }

        // BFS：该格的依赖者也需要重算（key 含 sheet 名，跨 sheet 自然传播）
        const deps = formulaStore.getAffectedCells(target.ref)
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
    autoSaveSuppressed,
    addSheet,
    setActiveSheet,
    importSheets,
    replaceWorkbook,
    restoreLastWorkbook,
    persistWorkbookId: persistId,
    newWorkbook,
    resetForLogout,
    setCellValue,
    addRows,
    pasteCells,
    evaluatePastedFormulas,
    clearCells,
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
