import type { AstNode, EvalContext, FormulaErrorType } from './tokens'
import { TokenType } from './tokens'

/**
 * 公式求值器 —— 遍历 AST 计算结果
 *
 * 支持：
 * - 算术运算：+ - * / ^
 * - 比较运算：= <> < > <= >=
 * - 文本连接：&
 * - 一元负号：-
 * - 内置函数：SUM, AVERAGE, COUNT, COUNTA, MAX, MIN, IF, CONCATENATE
 */
export function evaluate(node: AstNode, ctx: EvalContext): number | string | boolean | FormulaErrorType {
  switch (node.kind) {
    case 'number':
      return node.value

    case 'string':
      return node.value

    case 'cellRef': {
      const val = ctx.getCellValue(node.ref)
      // 空单元格返回 0（对于数值上下文），但保留字符串为 ""
      return val ?? 0
    }

    case 'range': {
      // 范围引用单独出现时（如 =A1:B5），返回 #VALUE!
      const values = ctx.getRangeValues(node.startRef, node.endRef)
      return values.length === 1 ? (values[0] ?? 0) : '#VALUE!'
    }

    case 'binaryOp': {
      const left = evaluate(node.left, ctx)
      const right = evaluate(node.right, ctx)

      // 错误传播
      if (isError(left)) return left
      if (isError(right)) return right

      switch (node.op) {
        case TokenType.PLUS:
          return toNumber(left) + toNumber(right)
        case TokenType.MINUS:
          return toNumber(left) - toNumber(right)
        case TokenType.MULTIPLY:
          return toNumber(left) * toNumber(right)
        case TokenType.DIVIDE: {
          const divisor = toNumber(right)
          if (divisor === 0) return '#DIV/0!'
          return toNumber(left) / divisor
        }
        case TokenType.POWER:
          return Math.pow(toNumber(left), toNumber(right))
        case TokenType.CONCAT:
          return toString(left) + toString(right)
        case TokenType.EQ:
          return compareEq(left, right)
        case TokenType.NE:
          return !compareEq(left, right)
        case TokenType.LT:
          return toNumber(left) < toNumber(right)
        case TokenType.GT:
          return toNumber(left) > toNumber(right)
        case TokenType.LE:
          return toNumber(left) <= toNumber(right)
        case TokenType.GE:
          return toNumber(left) >= toNumber(right)
        default:
          return '#ERROR!'
      }
    }

    case 'unaryOp': {
      const val = evaluate(node.operand, ctx)
      if (isError(val)) return val
      if (node.op === TokenType.MINUS) return -toNumber(val)
      return val
    }

    case 'functionCall': {
      return callFunction(node.name, node.args, ctx)
    }

    default:
      return '#ERROR!'
  }
}

// ═══════════════════════════════════════════
// 内置函数
// ═══════════════════════════════════════════

function callFunction(name: string, argNodes: AstNode[], ctx: EvalContext): number | string | boolean | FormulaErrorType {
  switch (name) {
    case 'SUM':     return fnSum(argNodes, ctx)
    case 'AVERAGE': return fnAverage(argNodes, ctx)
    case 'COUNT':   return fnCount(argNodes, ctx)
    case 'COUNTA':  return fnCountA(argNodes, ctx)
    case 'MAX':     return fnMax(argNodes, ctx)
    case 'MIN':     return fnMin(argNodes, ctx)
    case 'IF':      return fnIf(argNodes, ctx)
    case 'CONCATENATE': return fnConcatenate(argNodes, ctx)
    default:
      return '#NAME?' // 未知函数
  }
}

/** 展开参数中的范围引用为具体值列表 */
function flattenArgs(argNodes: AstNode[], ctx: EvalContext): (number | string | null)[] {
  const result: (number | string | null)[] = []
  for (const arg of argNodes) {
    if (arg.kind === 'range') {
      result.push(...ctx.getRangeValues(arg.startRef, arg.endRef))
    } else {
      const val = evaluate(arg, ctx)
      if (isError(val)) {
        result.push(null)
      } else {
        result.push(val as number | string | null)
      }
    }
  }
  return result
}

function fnSum(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  return values.reduce<number>((sum, v) => sum + toNumber(v), 0)
}

function fnAverage(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  const nums = values.filter((v) => !isError(v) && toNumber(v) === toNumber(v)) // NaN check
  if (nums.length === 0) return 0
  return nums.reduce<number>((sum, v) => sum + toNumber(v), 0) / nums.length
}

function fnCount(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  return values.filter((v) => typeof v === 'number').length
}

function fnCountA(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  return values.filter((v) => v !== null && v !== '').length
}

function fnMax(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  const nums = values.map(toNumber).filter((n) => !isNaN(n))
  if (nums.length === 0) return 0
  return Math.max(...nums)
}

function fnMin(argNodes: AstNode[], ctx: EvalContext): number {
  const values = flattenArgs(argNodes, ctx)
  const nums = values.map(toNumber).filter((n) => !isNaN(n))
  if (nums.length === 0) return 0
  return Math.min(...nums)
}

function fnIf(argNodes: AstNode[], ctx: EvalContext): number | string | boolean | FormulaErrorType {
  if (argNodes.length < 2 || argNodes.length > 3) return '#VALUE!'
  const condition = evaluate(argNodes[0], ctx)
  if (isError(condition)) return condition
  if (isTruthy(condition)) {
    return evaluate(argNodes[1], ctx)
  } else {
    return argNodes.length === 3 ? evaluate(argNodes[2], ctx) : false
  }
}

function fnConcatenate(argNodes: AstNode[], ctx: EvalContext): string {
  return argNodes.map((a) => {
    const val = evaluate(a, ctx)
    return isError(val) ? '' : toString(val)
  }).join('')
}

// ═══════════════════════════════════════════
// 类型转换辅助
// ═══════════════════════════════════════════

function isError(val: unknown): val is FormulaErrorType {
  return typeof val === 'string' && val.startsWith('#')
}

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'boolean') return val ? 1 : 0
  if (typeof val === 'string') {
    const n = parseFloat(val)
    return isNaN(n) ? 0 : n
  }
  return 0
}

function toString(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

function compareEq(a: unknown, b: unknown): boolean {
  // 数值比较
  if (typeof a === 'number' && typeof b === 'number') return a === b
  // 字符串比较（大小写不敏感）
  return toString(a).toLowerCase() === toString(b).toLowerCase()
}

function isTruthy(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val !== 0
  if (typeof val === 'string') return val !== '' && val !== '0' && !val.startsWith('#')
  return !!val
}
