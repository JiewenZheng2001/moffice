import { reactive } from 'vue'
import type { CellRange, Sheet, CellRef, CellValue } from '@/model/types'
import { toCellRef } from '@/utils/columnUtils'

// ═══════════════════════════════════════════════════════
// ClipboardManager —— 剪切/复制/粘贴状态机
// 所有剪贴板相关状态和操作的单一事实来源
//
// 解决的问题：
// 1. 之前 cutRange/copyRange/clipboardTsv 分散在 uiStore、
//    useKeyboard、command 三个地方，状态不一致
// 2. 系统剪贴板不可靠（非 HTTPS 环境 writeText 静默失败）
//    → 内部缓存 TSV 保证 undo 后剪贴板可恢复
// 3. 剪切/复制模式切换、粘贴后清除 统一由状态机管理
// ═══════════════════════════════════════════════════════

export type ClipboardMode = 'idle' | 'copy' | 'cut'

/** 剪贴板管理器内部状态（Vue reactive 驱动 UI 响应式更新） */
export interface ClipboardState {
  mode: ClipboardMode
  /** 虚线框标记的源区域 */
  sourceRange: CellRange | null
  /** 内部 TSV 缓存（不依赖系统剪贴板持久性） */
  tsvCache: string
}

class ClipboardManager {
  // 使用 Vue reactive 让组件可以直接读取并响应变化
  private state: ClipboardState = reactive({
    mode: 'idle',
    sourceRange: null,
    tsvCache: '',
  })

  // ---- 只读访问器（供 uiStore / 组件使用） ----

  get mode(): ClipboardMode {
    return this.state.mode
  }

  get sourceRange(): CellRange | null {
    return this.state.sourceRange
  }

  get tsvCache(): string {
    return this.state.tsvCache
  }

  get isCutMode(): boolean {
    return this.state.mode === 'cut'
  }

  get isCopyMode(): boolean {
    return this.state.mode === 'copy'
  }

  get isActive(): boolean {
    return this.state.mode !== 'idle'
  }

  // ---- 操作：进入模式 ----

  /**
   * Ctrl+C → 进入复制模式
   * - 保留虚线框直到用户按 Esc 或开始编辑
   * - 粘贴后不清除（可多次粘贴）
   */
  startCopy(range: CellRange, tsv: string): void {
    this.state.mode = 'copy'
    this.state.sourceRange = { startRef: range.startRef, endRef: range.endRef }
    this.state.tsvCache = tsv
    this.writeToSystemClipboard(tsv)
  }

  /**
   * Ctrl+X → 进入剪切模式
   * - 显示虚线框，粘贴后清空源格 + 退出模式（一次性行为）
   */
  startCut(range: CellRange, tsv: string): void {
    this.state.mode = 'cut'
    this.state.sourceRange = { startRef: range.startRef, endRef: range.endRef }
    this.state.tsvCache = tsv
    this.writeToSystemClipboard(tsv)
  }

  // ---- 操作：退出模式 ----

  /**
   * 退出剪切模式（粘贴完成后调用）
   * 清空系统剪贴板 + 内部缓存
   */
  exitCutMode(): void {
    if (this.state.mode !== 'cut') return
    this.state.mode = 'idle'
    this.state.sourceRange = null
    this.state.tsvCache = ''
    this.clearSystemClipboard()
  }

  /**
   * 退出复制模式
   */
  exitCopyMode(): void {
    if (this.state.mode !== 'copy') return
    this.state.mode = 'idle'
    this.state.sourceRange = null
  }

  /**
   * 退出所有模式（Esc / 开始编辑 / 数据变更触发）
   * 剪切模式下同时清空系统和内部剪贴板
   */
  exitAllModes(): void {
    if (this.state.mode === 'cut') {
      this.clearSystemClipboard()
    }
    this.state.mode = 'idle'
    this.state.sourceRange = null
    this.state.tsvCache = ''
  }

  // ---- 操作：恢复（undo/redo 用） ----

  /**
   * 恢复剪切/复制模式（undo/redo 后恢复虚线框 UI）
   * @param mode 要恢复的模式
   * @param range 虚线框范围
   * @param tsv 要写回的 TSV（为空则用缓存）
   */
  restoreMode(mode: 'copy' | 'cut', range: CellRange, tsv?: string): void {
    const cachedTsv = tsv ?? this.state.tsvCache
    this.state.mode = mode
    this.state.sourceRange = range
    this.state.tsvCache = cachedTsv
    // 写回系统剪贴板，确保 undo 后还能 Ctrl+V
    if (cachedTsv) {
      this.writeToSystemClipboard(cachedTsv)
    }
  }

  // ---- 系统剪贴板桥接 ----

  /** 写入系统剪贴板（静默失败降级） */
  async writeToSystemClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 非 HTTPS 环境降级：使用 textarea + execCommand
      this.fallbackWrite(text)
    }
  }

  /** 从系统剪贴板读取 */
  async readSystemClipboard(): Promise<string> {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }

  /** 清空系统剪贴板 */
  async clearSystemClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText('')
    } catch {
      // 非 HTTPS 环境降级：忽略
    }
  }

  /** 降级写入方案（非 HTTPS/localhost 环境） */
  private fallbackWrite(text: string): void {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/** 全局单例 */
export const clipboardManager = new ClipboardManager()

// ═══════════════════════════════════════════════════════
// 剪贴板工具函数（纯函数，不依赖状态机）
// ═══════════════════════════════════════════════════════

/** 选区的归一化矩形范围 */
export interface SelectionBounds {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

/** 解析单元格引用 → 行列索引 */
export function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colNameToIndex(m[1].toUpperCase()),
    row: parseInt(m[2], 10) - 1,
  }
}

/** 列名 → 列索引（内部实现，与 columnUtils.colToIndex 逻辑一致但内联避免循环依赖） */
function colNameToIndex(col: string): number {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index - 1
}

/**
 * 从 startRef/endRef 获取归一化边界
 */
export function getSelectionBounds(startRef: CellRef, endRef: CellRef): SelectionBounds {
  const s = parseCellRef(startRef)
  const e = parseCellRef(endRef)
  if (!s || !e) return { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }

  return {
    startRow: Math.min(s.row, e.row),
    endRow: Math.max(s.row, e.row),
    startCol: Math.min(s.col, e.col),
    endCol: Math.max(s.col, e.col),
  }
}

/**
 * 将选区内单元格序列化为 TSV 字符串
 */
export function serializeSelection(sheet: Sheet, bounds: SelectionBounds): string {
  const rows: string[] = []
  for (let r = bounds.startRow; r <= bounds.endRow; r++) {
    const cols: string[] = []
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const ref = toCellRef(r, c)
      const cell = sheet.cells.get(ref)
      const val = cell?.rawValue ?? cell?.computedValue ?? ''
      cols.push(String(val))
    }
    rows.push(cols.join('\t'))
  }
  return rows.join('\n')
}

/**
 * 将 TSV 字符串解析为二维数组
 */
export function parseTSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split('\t'))
}

/**
 * 从 startRef 开始，将二维数组映射为单元格写入映射 { ref → value }
 */
export function computePasteCells(
  sheet: Sheet,
  startRef: CellRef,
  data: string[][],
): Map<CellRef, CellValue> {
  const start = parseCellRef(startRef)
  if (!start) return new Map()

  const result = new Map<CellRef, CellValue>()
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const targetRow = start.row + r
      const targetCol = start.col + c
      if (targetRow >= sheet.rowCount || targetCol >= sheet.columnCount) continue
      const ref = toCellRef(targetRow, targetCol)
      const val: CellValue = data[r][c] === '' ? null : data[r][c]
      result.set(ref, val)
    }
  }
  return result
}
