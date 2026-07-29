import { tokenize } from './lexer'
import { parse, FormulaParseError } from './parser'
import { evaluate } from './evaluator'
import { DependencyGraph } from './dependency'
import type { EvalContext, FormulaErrorType, AstNode } from './tokens'

export { tokenize, parse, evaluate, DependencyGraph, FormulaParseError }
export type { EvalContext, FormulaErrorType, AstNode }
// Re-export from tokens for convenience
export { TokenType } from './tokens'
export type { Token } from './tokens'

/**
 * 公式引擎对外统一接口
 * 输入公式字符串和求值上下文，输出计算结果
 *
 * 使用示例：
 *   const result = computeFormula('=SUM(A1:A5)', evalCtx)
 */
export function computeFormula(
  formula: string,
  ctx: EvalContext,
): { value: number | string | boolean | FormulaErrorType; ast: AstNode | null; deps: string[] } {
  try {
    const tokens = tokenize(formula)
    const ast = parse(tokens)
    const deps = DependencyGraph.extractRefs(ast)
    const value = evaluate(ast, ctx)
    return { value, ast, deps }
  } catch (e) {
    if (e instanceof FormulaParseError) {
      return { value: '#ERROR!', ast: null, deps: [] }
    }
    return { value: '#ERROR!', ast: null, deps: [] }
  }
}
