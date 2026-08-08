import type { EvalContext } from '@/engine'

/**
 * 创建测试用求值上下文
 * 允许直接指定单元格值（Map），用于公式引擎单元测试
 */
export function createTestContext(initial: Record<string, number | string | null> = {}): EvalContext {
  const cells = new Map(Object.entries(initial))

  return {
    getCellValue(ref: string): number | string | null {
      const v = cells.get(ref.toUpperCase())
      return v === undefined ? null : v
    },
    getRangeValues(startRef: string, endRef: string): (number | string | null)[] {
      const s = parseRef(startRef)
      const e = parseRef(endRef)
      if (!s || !e) return []
      const values: (number | string | null)[] = []
      const startCol = Math.min(s.col, e.col)
      const endCol = Math.max(s.col, e.col)
      const startRow = Math.min(s.row, e.row)
      const endRow = Math.max(s.row, e.row)
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          values.push(cells.get(`${colToLetter(c)}${r + 1}`) ?? null)
        }
      }
      return values
    },
  }
}

function parseRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return { col: colToIndex(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 }
}

function colToIndex(col: string): number {
  let result = 0
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64)
  }
  return result - 1
}

function colToLetter(col: number): string {
  let result = ''
  let n = col
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}
