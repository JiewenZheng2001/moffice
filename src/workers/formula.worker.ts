import { tokenize } from '@/engine/lexer'
import { parse, FormulaParseError } from '@/engine/parser'
import { evaluate } from '@/engine/evaluator'
import { DependencyGraph } from '@/engine/dependency'
import type { EvalContext } from '@/engine/tokens'

// ═══════════════════════════════════════════════
// 公式计算 Worker —— 在独立线程运行公式引擎，不阻塞 UI 主线程
//
// 协议：
//   主线程 → Worker: { id, formula, cells }
//   Worker → 主线程: { id, value, deps, error? }
// ═══════════════════════════════════════════════

interface WorkerRequest {
  id: number
  formula: string
  cells: Record<string, number | string | null>   // 简单的单元格快照
}

interface WorkerResponse {
  id: number
  value: number | string | boolean | string  // 计算结果或错误码
  deps: string[]
  error?: string
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, formula, cells } = e.data

  try {
    const tokens = tokenize(formula)
    const ast = parse(tokens)
    const deps = DependencyGraph.extractRefs(ast)

    // 将主线程传来的简单数据适配为 EvalContext
    const ctx: EvalContext = {
      getCellValue(ref: string): number | string | null {
        return cells[ref.toUpperCase()] ?? null
      },
      getRangeValues(startRef: string, endRef: string): (number | string | null)[] {
        const range = expandRange(startRef, endRef)
        return range.map((r) => cells[r] ?? null)
      },
    }

    const value = evaluate(ast, ctx)

    const response: WorkerResponse = { id, value, deps }
    self.postMessage(response)
  } catch (e) {
    const errMsg = e instanceof FormulaParseError ? e.message : String(e)
    const response: WorkerResponse = {
      id,
      value: '#ERROR!',
      deps: [],
      error: errMsg,
    }
    self.postMessage(response)
  }
}

// ---- 辅助：展开范围引用 ----

function expandRange(startRef: string, endRef: string): string[] {
  const s = parseRef(startRef)
  const e = parseRef(endRef)
  if (!s || !e) return [startRef, endRef]

  const refs: string[] = []
  const startCol = Math.min(s.col, e.col)
  const endCol = Math.max(s.col, e.col)
  const startRow = Math.min(s.row, e.row)
  const endRow = Math.max(s.row, e.row)

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      refs.push(`${colToLetter(c)}${r + 1}`)
    }
  }
  return refs
}

function parseRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 }
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
