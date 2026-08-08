import type { CellFormat, CellRef, CellValue, Sheet } from './types'
import { createCell } from './cell'
import { colToIndex, toCellRef } from '@/utils/columnUtils'

// ═══════════════════════════════════════════════
// 命令模式 — 所有修改 Workbook 数据的操作必须封装为 Command
// 通过 CommandService 统一入栈，支持撤销/重做
// ═══════════════════════════════════════════════

/**
 * Command 抽象接口
 * - execute(): 执行操作（首次执行或重做时调用）
 * - undo(): 撤销操作
 * - description: 调试用描述文本
 */
export interface ICommand {
  readonly description: string
  execute(): void
  undo(): void
  /** 返回此命令影响的所有单元格引用（用于 undo/redo 后触发依赖重算） */
  getAffectedRefs(): CellRef[]
  /** 如果是剪切命令，返回源区域引用（用于 undo 后恢复虚线框 UI 状态） */
  getSourceRefs?(): CellRef[]
  /**
   * 是否需要触发公式依赖重算
   * 默认 true；纯格式命令返回 false（格式不改变值，跳过不必要的重算）
   */
  needsRecalc?(): boolean
}

// ═══════════════════════════════════════════════
// 组合命令 —— 将多个命令打包为一个原子操作
// ═══════════════════════════════════════════════

export class CompoundCommand implements ICommand {
  readonly description: string
  private commands: ICommand[]

  constructor(
    commands: ICommand[],
    desc?: string,
  ) {
    this.commands = commands
    this.description = desc ?? `Batch ${commands.length} commands`
  }

  execute(): void {
    for (const cmd of this.commands) cmd.execute()
  }

  undo(): void {
    // 逆序撤销（最后执行的最先撤销）
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo()
    }
  }

  getAffectedRefs(): CellRef[] {
    return this.commands.flatMap((c) => c.getAffectedRefs())
  }
}

// ═══════════════════════════════════════════════
// 设置单元格值
// ═══════════════════════════════════════════════

export class SetCellCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private ref: CellRef
  private newValue: CellValue
  private formula: string | null
  private oldValue: CellValue
  private oldFormula: string | null
  private oldError: string | null
  private hadOldCell: boolean

  /** @param formulaStr 如果是公式，传入公式字符串（如 "=SUM(A1:A3)"）；否则为 null */
  constructor(sheet: Sheet, ref: CellRef, newValue: CellValue, formulaStr: string | null = null) {
    this.sheet = sheet
    this.ref = ref
    this.newValue = newValue
    this.formula = formulaStr
    this.description = formulaStr ? `SET ${ref} = ${formulaStr}` : `SET ${ref} = ${String(newValue)}`
    // 保存旧状态用于撤销
    const oldCell = sheet.cells.get(ref)
    if (oldCell) {
      this.hadOldCell = true
      this.oldValue = oldCell.rawValue
      this.oldFormula = oldCell.formula
      this.oldError = oldCell.error
    } else {
      this.hadOldCell = false
      this.oldValue = null
      this.oldFormula = null
      this.oldError = null
    }
  }

  /** 值以 # 开头（如 #DIV/0!、#CIRCULAR!）→ 视为错误 */
  private static errorOf(value: CellValue): string | null {
    return typeof value === 'string' && value.startsWith('#') ? value : null
  }

  execute(): void {
    if (this.newValue === null || this.newValue === '') {
      this.sheet.cells.delete(this.ref)
    } else {
      const error = SetCellCommand.errorOf(this.newValue)
      const existing = this.sheet.cells.get(this.ref)
      if (existing) {
        existing.rawValue = this.formula ?? this.newValue
        existing.computedValue = this.newValue
        existing.formula = this.formula
        existing.error = error
      } else {
        const cell = createCell(this.ref)
        cell.rawValue = this.formula ?? this.newValue
        cell.computedValue = this.newValue
        cell.formula = this.formula
        cell.error = error
        this.sheet.cells.set(this.ref, cell)
      }
    }
  }

  undo(): void {
    if (!this.hadOldCell) {
      this.sheet.cells.delete(this.ref)
    } else {
      const cell = createCell(this.ref)
      cell.rawValue = this.oldValue
      cell.computedValue = this.oldValue
      cell.formula = this.oldFormula
      cell.error = this.oldError
      this.sheet.cells.set(this.ref, cell)
    }
  }

  getAffectedRefs(): CellRef[] {
    return [this.ref]
  }
}

// ═══════════════════════════════════════════════
// 批量设置单元格（粘贴）
// ═══════════════════════════════════════════════

/** 单元格状态快照：用于撤销批量操作 */
interface CellSnapshot {
  ref: CellRef
  value: CellValue
  formula: string | null
}

export class PasteCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private cellsToPaste: Map<CellRef, CellValue>
  private snapshots: CellSnapshot[] = []

  constructor(sheet: Sheet, cellsToPaste: Map<CellRef, CellValue>) {
    this.sheet = sheet
    this.cellsToPaste = cellsToPaste
    this.description = `PASTE ${cellsToPaste.size} cells`
    // 保存将被覆盖的单元格的旧状态
    for (const ref of cellsToPaste.keys()) {
      const old = sheet.cells.get(ref)
      if (old) {
        this.snapshots.push({
          ref,
          value: old.rawValue,
          formula: old.formula,
        })
      } else {
        this.snapshots.push({ ref, value: null, formula: null })
      }
    }
  }

  execute(): void {
    for (const [ref, value] of this.cellsToPaste) {
      if (value === null || value === '') {
        this.sheet.cells.delete(ref)
      } else {
        const existing = this.sheet.cells.get(ref)
        if (existing) {
          existing.rawValue = value
          existing.computedValue = value
          existing.formula = null
          existing.error = null
        } else {
          const cell = createCell(ref)
          cell.rawValue = value
          cell.computedValue = value
          this.sheet.cells.set(ref, cell)
        }
      }
    }
  }

  undo(): void {
    for (const snap of this.snapshots) {
      if (snap.value === null) {
        this.sheet.cells.delete(snap.ref)
      } else {
        const cell = createCell(snap.ref)
        cell.rawValue = snap.value
        cell.computedValue = snap.value
        cell.formula = snap.formula
        cell.error = null
        this.sheet.cells.set(snap.ref, cell)
      }
    }
  }

  getAffectedRefs(): CellRef[] {
    return [...this.cellsToPaste.keys()]
  }
}

// ═══════════════════════════════════════════════
// 剪切+粘贴（Excel 虚线框模式）
// ═══════════════════════════════════════════════

export class CutPasteCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private pasteCells: Map<CellRef, CellValue>
  private sourceSnapshots: CellSnapshot[] = []
  private targetSnapshots: CellSnapshot[] = []
  /** 源格 TSV，用于 undo 后恢复剪贴板 */
  private clipboardTsv: string = ''

  constructor(
    sheet: Sheet,
    sourceRefs: CellRef[],
    pasteCells: Map<CellRef, CellValue>,
    clipboardTsv: string = '',
  ) {
    this.sheet = sheet
    this.pasteCells = pasteCells
    this.clipboardTsv = clipboardTsv
    this.description = `Cut & Paste ${sourceRefs.length} → ${pasteCells.size}`

    // 保存源格快照
    for (const ref of sourceRefs) {
      const cell = sheet.cells.get(ref)
      this.sourceSnapshots.push({
        ref,
        value: cell?.rawValue ?? null,
        formula: cell?.formula ?? null,
      })
    }
    // 保存粘贴目标的旧状态
    for (const ref of pasteCells.keys()) {
      const cell = sheet.cells.get(ref)
      this.targetSnapshots.push({
        ref,
        value: cell?.rawValue ?? null,
        formula: cell?.formula ?? null,
      })
    }
  }

  execute(): void {
    // 1. 清空源格
    for (const snap of this.sourceSnapshots) {
      this.sheet.cells.delete(snap.ref)
    }
    // 2. 写入目标
    for (const [ref, value] of this.pasteCells) {
      if (value === null || value === '') {
        this.sheet.cells.delete(ref)
      } else {
        const existing = this.sheet.cells.get(ref)
        if (existing) {
          existing.rawValue = value
          existing.computedValue = value
          existing.formula = null
          existing.error = null
        } else {
          const cell = createCell(ref)
          cell.rawValue = value
          cell.computedValue = value
          this.sheet.cells.set(ref, cell)
        }
      }
    }
  }

  undo(): void {
    // 1. 恢复粘贴目标到旧状态
    for (const snap of this.targetSnapshots) {
      if (snap.value === null) {
        this.sheet.cells.delete(snap.ref)
      } else {
        const cell = createCell(snap.ref)
        cell.rawValue = snap.value
        cell.computedValue = snap.value
        cell.formula = snap.formula
        cell.error = null
        this.sheet.cells.set(snap.ref, cell)
      }
    }
    // 2. 恢复源格
    for (const snap of this.sourceSnapshots) {
      if (snap.value === null) {
        this.sheet.cells.delete(snap.ref)
      } else {
        const cell = createCell(snap.ref)
        cell.rawValue = snap.value
        cell.computedValue = snap.value
        cell.formula = snap.formula
        cell.error = null
        this.sheet.cells.set(snap.ref, cell)
      }
    }
    // 3. 恢复剪贴板（撤销后用户可直接再粘贴）
    restoreClipboard(this.clipboardTsv)
  }

  getAffectedRefs(): CellRef[] {
    return [...this.pasteCells.keys(), ...this.sourceSnapshots.map((s) => s.ref)]
  }

  /** 返回剪切源区域（用于 undo 后恢复虚线框 UI） */
  getSourceRefs(): CellRef[] {
    return this.sourceSnapshots.map((s) => s.ref)
  }
}

// ═══════════════════════════════════════════════
// 批量设置单元格格式（字体/颜色/对齐/边框等）
// ═══════════════════════════════════════════════

/** 格式快照：撤销时恢复的每个单元格的旧格式 */
interface FormatSnapshot {
  ref: CellRef
  format: CellFormat
}

export class SetCellFormatCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private refs: CellRef[]
  /** 要应用的格式片段（Partial，未提供的字段保持不变） */
  private formatPatch: Partial<CellFormat>
  private snapshots: FormatSnapshot[] = []

  /**
   * @param sheet 目标 Sheet
   * @param refs 应用格式的所有单元格
   * @param formatPatch 格式片段（如 { bold: true }，只改粗体，其他不动）
   */
  constructor(sheet: Sheet, refs: CellRef[], formatPatch: Partial<CellFormat>) {
    this.sheet = sheet
    this.refs = refs
    this.formatPatch = formatPatch
    this.description = `FORMAT ${refs.length} cells`

    // 构造时深拷贝每个目标单元格的旧格式，撤销时按原样恢复
    for (const ref of refs) {
      const cell = sheet.cells.get(ref)
      this.snapshots.push({
        ref,
        // 深拷贝：嵌套对象（border*）必须复制，避免 undo 时引用同一对象。
        // 注意不能用 structuredClone：Pinia 中的 format 是 reactive Proxy，无法克隆
        format: cell ? JSON.parse(JSON.stringify(cell.format)) : {},
      })
    }
  }

  execute(): void {
    for (const ref of this.refs) {
      // 格式可以应用到空单元格：需要时惰性创建 Cell（无值）
      let cell = this.sheet.cells.get(ref)
      if (!cell) {
        cell = createCell(ref)
        this.sheet.cells.set(ref, cell)
      }
      // 合并格式片段
      cell.format = { ...cell.format, ...this.formatPatch }
    }
  }

  undo(): void {
    for (const snap of this.snapshots) {
      const cell = this.sheet.cells.get(snap.ref)
      if (!cell) continue
      cell.format = snap.format
      // 如果单元格原本不存在（仅因格式创建）且现在无值，删除它
      if (cell.rawValue === null && cell.computedValue === null && !cell.formula) {
        this.sheet.cells.delete(snap.ref)
      }
    }
  }

  getAffectedRefs(): CellRef[] {
    // 格式变化不改变值 → 无需触发依赖重算
    return []
  }

  needsRecalc(): boolean {
    return false
  }

  /**
   * 判断能否与下一个格式命令合并（相同目标单元格集合）
   * 连续对同一批单元格做格式操作（如加粗→加边框）应合并为一个命令，
   * 否则用户需要按多次 Ctrl+Z，且撤销后"看起来没变"（恢复到上一次格式状态）
   */
  mergeableWith(next: SetCellFormatCommand): boolean {
    if (this.snapshots.length !== next.snapshots.length) return false
    const myRefs = new Set(this.snapshots.map((s) => s.ref))
    return next.snapshots.every((s) => myRefs.has(s.ref))
  }

  /**
   * 合并下一个格式命令的 patch（后者优先）
   * - 自己的快照保留（最早的旧状态）→ undo 一次恢复全部
   * - formatPatch 取并集（后设置的字段覆盖先设置的）
   * 注意：调用方需先执行 next.execute() 再调用 merge（应用效果 + 更新 patch）
   */
  merge(next: SetCellFormatCommand): void {
    this.formatPatch = { ...this.formatPatch, ...next.formatPatch }
  }
}

// ═══════════════════════════════════════════════
// 插入行
// ═══════════════════════════════════════════════

export class InsertRowCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private afterRow: number

  constructor(sheet: Sheet, afterRow: number) {
    this.sheet = sheet
    this.afterRow = afterRow
    this.description = `INSERT_ROW after row ${afterRow + 1}`
  }

  execute(): void {
    if (this.afterRow < 0 || this.afterRow >= this.sheet.rowCount) return
    this.sheet.rowCount++
    shiftRows(this.sheet, this.afterRow + 1, 1)
  }

  undo(): void {
    if (this.afterRow < 0 || this.afterRow + 1 >= this.sheet.rowCount) return
    // 删除插入的行（afterRow+1 位置）
    for (let c = 0; c < this.sheet.columnCount; c++) {
      this.sheet.cells.delete(toCellRef(this.afterRow + 1, c))
    }
    // 下方行上移回原位
    shiftRows(this.sheet, this.afterRow + 2, -1)
    this.sheet.rowCount--
  }

  getAffectedRefs(): CellRef[] { return [] }
}

// ═══════════════════════════════════════════════
// 删除行
// ═══════════════════════════════════════════════

export class DeleteRowCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private rowIndex: number
  /** 被删除行中的所有单元格快照 */
  private deletedCells: { ref: CellRef; value: CellValue; formula: string | null }[] = []

  constructor(sheet: Sheet, rowIndex: number) {
    this.sheet = sheet
    this.rowIndex = rowIndex
    this.description = `DELETE_ROW row ${rowIndex + 1}`
    // 保存被删除的单元格状态
    for (let c = 0; c < sheet.columnCount; c++) {
      const ref = toCellRef(rowIndex, c)
      const cell = sheet.cells.get(ref)
      if (cell) {
        this.deletedCells.push({
          ref,
          value: cell.rawValue,
          formula: cell.formula,
        })
      }
    }
  }

  execute(): void {
    if (this.rowIndex < 0 || this.rowIndex >= this.sheet.rowCount || this.sheet.rowCount <= 1) return
    for (let c = 0; c < this.sheet.columnCount; c++) {
      this.sheet.cells.delete(toCellRef(this.rowIndex, c))
    }
    shiftRows(this.sheet, this.rowIndex + 1, -1)
    this.sheet.rowCount--
  }

  undo(): void {
    // 恢复删除的行：下方行先下移
    this.sheet.rowCount++
    shiftRows(this.sheet, this.rowIndex, 1)
    // 恢复被删除的单元格内容
    for (const { ref, value, formula } of this.deletedCells) {
      const cell = createCell(ref)
      cell.rawValue = value
      cell.computedValue = value
      cell.formula = formula
      cell.error = null
      this.sheet.cells.set(ref, cell)
    }
  }

  getAffectedRefs(): CellRef[] { return [] }
}

// ═══════════════════════════════════════════════
// 插入列
// ═══════════════════════════════════════════════

export class InsertColumnCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private afterCol: number

  constructor(sheet: Sheet, afterCol: number) {
    this.sheet = sheet
    this.afterCol = afterCol
    this.description = `INSERT_COL after col ${String.fromCharCode(65 + afterCol)}`
  }

  execute(): void {
    if (this.afterCol < 0 || this.afterCol >= this.sheet.columnCount) return
    this.sheet.columnCount++
    shiftColumns(this.sheet, this.afterCol + 1, 1)
  }

  undo(): void {
    if (this.afterCol < 0 || this.afterCol + 1 >= this.sheet.columnCount) return
    for (let r = 0; r < this.sheet.rowCount; r++) {
      this.sheet.cells.delete(toCellRef(r, this.afterCol + 1))
    }
    shiftColumns(this.sheet, this.afterCol + 2, -1)
    this.sheet.columnCount--
  }

  getAffectedRefs(): CellRef[] { return [] }
}

// ═══════════════════════════════════════════════
// 删除列
// ═══════════════════════════════════════════════

export class DeleteColumnCommand implements ICommand {
  readonly description: string
  private sheet: Sheet
  private colIndex: number
  private deletedCells: { ref: CellRef; value: CellValue; formula: string | null }[] = []

  constructor(sheet: Sheet, colIndex: number) {
    this.sheet = sheet
    this.colIndex = colIndex
    this.description = `DELETE_COL col ${String.fromCharCode(65 + colIndex)}`
    for (let r = 0; r < sheet.rowCount; r++) {
      const ref = toCellRef(r, colIndex)
      const cell = sheet.cells.get(ref)
      if (cell) {
        this.deletedCells.push({
          ref,
          value: cell.rawValue,
          formula: cell.formula,
        })
      }
    }
  }

  execute(): void {
    if (this.colIndex < 0 || this.colIndex >= this.sheet.columnCount || this.sheet.columnCount <= 1) return
    for (let r = 0; r < this.sheet.rowCount; r++) {
      this.sheet.cells.delete(toCellRef(r, this.colIndex))
    }
    shiftColumns(this.sheet, this.colIndex + 1, -1)
    this.sheet.columnCount--
  }

  undo(): void {
    this.sheet.columnCount++
    shiftColumns(this.sheet, this.colIndex, 1)
    for (const { ref, value, formula } of this.deletedCells) {
      const cell = createCell(ref)
      cell.rawValue = value
      cell.computedValue = value
      cell.formula = formula
      cell.error = null
      this.sheet.cells.set(ref, cell)
    }
  }

  getAffectedRefs(): CellRef[] { return [] }
}

// ═══════════════════════════════════════════════
// 行列位移辅助函数（纯函数，不引入副作用）
// ═══════════════════════════════════════════════

/** 从 fromRow 起，所有行 +delta（delta 可正可负） */
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

/** 从 fromCol 起，所有列 +delta */
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

/** 恢复剪贴板内容（撤销剪切粘贴后调用） */
async function restoreClipboard(tsv: string): Promise<void> {
  if (!tsv) return
  try {
    await navigator.clipboard.writeText(tsv)
  } catch {
    // 降级：非 HTTPS 环境可能失败
  }
}
