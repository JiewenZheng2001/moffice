import type { Token } from './tokens'
import { TokenType } from './tokens'
import type { AstNode, NumberLiteralNode, StringLiteralNode, CellRefNode, SheetRefNode, SheetRangeNode, RangeNode, FunctionCallNode, BinaryOpNode, UnaryOpNode } from './tokens'

/**
 * 语法分析器 —— 递归下降解析，将 Token 流转换为 AST
 *
 * 运算符优先级（从低到高）：
 *   比较 ( = < > <= >= <> )
 *   文本连接 ( & )
 *   加减 ( + - )
 *   乘除 ( * / )
 *   一元负号 ( - )
 *   幂 ( ^ )
 *   原子 (数字/字符串/引用/函数/括号)
 */
export function parse(tokens: Token[]): AstNode {
  let pos = 0

  const ast = expression()
  if (current().type !== TokenType.EOF) {
    throw new FormulaParseError(`Unexpected token: ${current().value}`, current().pos)
  }
  return ast

  // ---- 辅助 ----

  function current(): Token {
    return tokens[pos] ?? tokens[tokens.length - 1]
  }

  function advance(): Token {
    return tokens[pos++] ?? tokens[tokens.length - 1]
  }

  function expect(type: TokenType): Token {
    const t = advance()
    if (t.type !== type) {
      throw new FormulaParseError(`Expected ${type}, got ${t.type}`, t.pos)
    }
    return t
  }

  // ---- 语法规则 ----

  function expression(): AstNode {
    return comparison()
  }

  /** 比较运算：= <> < > <= >= */
  function comparison(): AstNode {
    let left = concat()
    while (
      current().type === TokenType.EQ ||
      current().type === TokenType.NE ||
      current().type === TokenType.LT ||
      current().type === TokenType.GT ||
      current().type === TokenType.LE ||
      current().type === TokenType.GE
    ) {
      const op = advance().type
      const right = concat()
      left = { kind: 'binaryOp', op, left, right } as BinaryOpNode
    }
    return left
  }

  /** 文本连接：& */
  function concat(): AstNode {
    let left = term()
    while (current().type === TokenType.CONCAT) {
      advance()
      const right = term()
      left = { kind: 'binaryOp', op: TokenType.CONCAT, left, right } as BinaryOpNode
    }
    return left
  }

  /** 加减：+ - */
  function term(): AstNode {
    let left = factor()
    while (current().type === TokenType.PLUS || current().type === TokenType.MINUS) {
      const op = advance().type
      const right = factor()
      left = { kind: 'binaryOp', op, left, right } as BinaryOpNode
    }
    return left
  }

  /** 乘除：* / */
  function factor(): AstNode {
    let left = unary()
    while (current().type === TokenType.MULTIPLY || current().type === TokenType.DIVIDE) {
      const op = advance().type
      const right = unary()
      left = { kind: 'binaryOp', op, left, right } as BinaryOpNode
    }
    return left
  }

  /** 一元负号 */
  function unary(): AstNode {
    if (current().type === TokenType.MINUS) {
      advance()
      const operand = unary()
      return { kind: 'unaryOp', op: TokenType.MINUS, operand } as UnaryOpNode
    }
    return power()
  }

  /** 幂：^（右结合） */
  function power(): AstNode {
    let left = primary()
    if (current().type === TokenType.POWER) {
      advance()
      const right = power() // 递归调 power 实现右结合
      left = { kind: 'binaryOp', op: TokenType.POWER, left, right } as BinaryOpNode
    }
    return left
  }

  /** 原子表达式 */
  function primary(): AstNode {
    const t = current()

    switch (t.type) {
      case TokenType.NUMBER: {
        advance()
        return { kind: 'number', value: parseFloat(t.value) } as NumberLiteralNode
      }

      case TokenType.STRING: {
        advance()
        // 去掉首尾引号
        const val = t.value.slice(1, -1).replace(/""/g, '"')
        return { kind: 'string', value: val } as StringLiteralNode
      }

      case TokenType.CELL_REF: {
        advance()
        // 检查是否跟 COLON → 范围引用
        if (current().type === TokenType.COLON) {
          advance()
          const end = expect(TokenType.CELL_REF)
          return { kind: 'range', startRef: t.value, endRef: end.value } as RangeNode
        }
        return { kind: 'cellRef', ref: t.value } as CellRefNode
      }

      case TokenType.SHEET_REF: {
        advance()
        // token 值形如 "Sheet2!A1" → 拆分为 sheet 名 + 引用
        const bangIdx = t.value.indexOf('!')
        const sheet = t.value.slice(0, bangIdx)
        const ref = t.value.slice(bangIdx + 1)
        // 跨 sheet 范围：Sheet2!A1:B5 → 后面跟 COLON + CELL_REF
        if (current().type === TokenType.COLON) {
          advance()
          const end = expect(TokenType.CELL_REF)
          return { kind: 'sheetRange', sheet, startRef: ref, endRef: end.value } as SheetRangeNode
        }
        return { kind: 'sheetRef', sheet, ref } as SheetRefNode
      }

      case TokenType.FUNCTION: {
        advance()
        const name = t.value.toUpperCase()
        expect(TokenType.LPAREN)
        const args: AstNode[] = []
        if (current().type !== TokenType.RPAREN) {
          args.push(expression())
          while (current().type === TokenType.COMMA) {
            advance()
            args.push(expression())
          }
        }
        expect(TokenType.RPAREN)
        return { kind: 'functionCall', name, args } as FunctionCallNode
      }

      case TokenType.LPAREN: {
        advance()
        const node = expression()
        expect(TokenType.RPAREN)
        return node
      }

      case TokenType.RANGE: {
        advance()
        const [start, end] = t.value.split(':')
        return { kind: 'range', startRef: start, endRef: end } as RangeNode
      }

      default:
        throw new FormulaParseError(`Unexpected token: ${t.value}`, t.pos)
    }
  }
}

/** 公式解析错误 */
export class FormulaParseError extends Error {
  public pos: number
  constructor(message: string, pos: number) {
    super(`Parse error at position ${pos}: ${message}`)
    this.name = 'FormulaParseError'
    this.pos = pos
  }
}
