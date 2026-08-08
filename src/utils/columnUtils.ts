/**
 * 列索引转列名：0 → "A", 25 → "Z", 26 → "AA"
 * 类 Excel 的 A1 引用风格转换
 */
export function indexToCol(index: number): string {
  let col = ''
  let n = index
  while (n >= 0) {
    col = String.fromCharCode((n % 26) + 65) + col
    n = Math.floor(n / 26) - 1
  }
  return col
}

/**
 * 列名转列索引："A" → 0, "Z" → 25, "AA" → 26
 */
export function colToIndex(col: string): number {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index - 1
}

/**
 * 将行列号转为单元格引用字符串 (0, 0) → "A1"
 */
export function toCellRef(row: number, col: number): string {
  return `${indexToCol(col)}${row + 1}`
}

/**
 * 解析单元格引用 "A1" → { col: 0, row: 0 }
 * 返回 null 表示格式不合法
 */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colToIndex(m[1].toUpperCase()),
    row: parseInt(m[2], 10) - 1,
  }
}
