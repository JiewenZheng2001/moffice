import type { Sheet, CellRef, CellValue } from '@/model/types'
import { colToIndex, toCellRef } from '@/utils/columnUtils'

/** 选区的归一化矩形范围 */
export interface SelectionBounds {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

/**
 * 解析 CellRef 为 {col, row}
 */
function parseRef(ref: CellRef): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colToIndex(m[1].toUpperCase()),
    row: parseInt(m[2], 10) - 1,
  }
}

/**
 * 从 startRef/endRef 获取归一化边界
 */
export function getSelectionBounds(startRef: CellRef, endRef: CellRef): SelectionBounds {
  const s = parseRef(startRef)
  const e = parseRef(endRef)
  if (!s || !e) return { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }

  return {
    startRow: Math.min(s.row, e.row),
    endRow: Math.max(s.row, e.row),
    startCol: Math.min(s.col, e.col),
    endCol: Math.max(s.col, e.col),
  }
}

/**
 * 将选区内单元格序列化为 TSV 字符串（与 Excel/飞书兼容）
 */
export function serializeSelection(sheet: Sheet, bounds: SelectionBounds): string {
  const rows: string[] = []
  for (let r = bounds.startRow; r <= bounds.endRow; r++) {
    const cols: string[] = []
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const ref = toCellRef(r, c)
      const cell = sheet.cells.get(ref)
      // rawValue 优先，computedValue 兜底
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
function parseTSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split('\t'))
}

/**
 * 复制：序列化选区 → 写入系统剪贴板
 */
export async function copySelection(sheet: Sheet, startRef: CellRef, endRef: CellRef): Promise<void> {
  const bounds = getSelectionBounds(startRef, endRef)
  const tsv = serializeSelection(sheet, bounds)
  try {
    await navigator.clipboard.writeText(tsv)
  } catch {
    // 降级：使用 textarea + execCommand
    fallbackCopy(tsv)
  }
}

/**
 * 剪切 = 复制到剪贴板（不清空单元格，清空由粘贴时按 Excel 虚线框模式执行）
 * @returns bounds 和 tsv，供调用方设置剪切模式
 */
export async function cutSelection(sheet: Sheet, startRef: CellRef, endRef: CellRef): Promise<{ bounds: SelectionBounds; tsv: string } | null> {
  const bounds = getSelectionBounds(startRef, endRef)
  const tsv = serializeSelection(sheet, bounds)
  try {
    await navigator.clipboard.writeText(tsv)
  } catch {
    fallbackCopy(tsv)
  }
  // 不清空单元格 — 清空操作由粘贴时根据 uiStore.cutRange 执行
  return { bounds, tsv }
}

/**
 * 粘贴：从剪贴板读取 TSV，从 startRef 开始写入
 * 返回需要设置的单元格映射 { ref → value }
 */
export async function readClipboardForPaste(): Promise<string[][]> {
  try {
    const text = await navigator.clipboard.readText()
    return parseTSV(text)
  } catch {
    return []
  }
}

/**
 * 从 startRef 开始，将二维数据写入 Sheet（返回变更映射）
 */
export function computePasteCells(
  sheet: Sheet,
  startRef: CellRef,
  data: string[][],
): Map<CellRef, CellValue> {
  const start = parseRef(startRef)
  if (!start) return new Map()

  const result = new Map<CellRef, CellValue>()
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const targetRow = start.row + r
      const targetCol = start.col + c
      // 不超出 Sheet 边界
      if (targetRow >= sheet.rowCount || targetCol >= sheet.columnCount) continue
      const ref = toCellRef(targetRow, targetCol)
      const val: CellValue = data[r][c] === '' ? null : data[r][c]
      result.set(ref, val)
    }
  }
  return result
}

/**
 * 降级复制方案（非 HTTPS/localhost 环境）
 */
function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}
