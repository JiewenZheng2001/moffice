import type { Token } from './tokens'
import { TokenType } from './tokens'

/**
 * 词法分析器 —— 将公式字符串切分为 Token 流
 *
 * 输入: "=SUM(A1, B2)"
 * 输出: [FUNC('SUM'), LPAREN, CELL('A1'), COMMA, CELL('B2'), RPAREN, EOF]
 */
export function tokenize(input: string): Token[] {
  // 去掉开头的 "="，公式引擎只处理表达式部分
  const src = input.startsWith('=') ? input.slice(1) : input
  const tokens: Token[] = []
  let pos = 0

  while (pos < src.length) {
    const ch = src[pos]

    // 跳过空白
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pos++
      continue
    }

    // 数字：整数或小数
    if (isDigit(ch) || (ch === '.' && pos + 1 < src.length && isDigit(src[pos + 1]))) {
      const start = pos
      while (pos < src.length && (isDigit(src[pos]) || src[pos] === '.')) pos++
      tokens.push({ type: TokenType.NUMBER, value: src.slice(start, pos), pos: start })
      continue
    }

    // 字符串："..."
    if (ch === '"') {
      const start = pos
      pos++ // 跳开头的引号
      while (pos < src.length && src[pos] !== '"') pos++
      if (pos >= src.length) {
        // 未闭合的字符串
        tokens.push({ type: TokenType.STRING, value: src.slice(start, pos), pos: start })
        break
      }
      pos++ // 跳结尾的引号
      tokens.push({ type: TokenType.STRING, value: src.slice(start, pos), pos: start })
      continue
    }

    // 运算符
    if (ch === '+') { tokens.push({ type: TokenType.PLUS, value: '+', pos }); pos++; continue }
    if (ch === '-') { tokens.push({ type: TokenType.MINUS, value: '-', pos }); pos++; continue }
    if (ch === '*') { tokens.push({ type: TokenType.MULTIPLY, value: '*', pos }); pos++; continue }
    if (ch === '/') { tokens.push({ type: TokenType.DIVIDE, value: '/', pos }); pos++; continue }
    if (ch === '^') { tokens.push({ type: TokenType.POWER, value: '^', pos }); pos++; continue }
    if (ch === '&') { tokens.push({ type: TokenType.CONCAT, value: '&', pos }); pos++; continue }
    if (ch === '(') { tokens.push({ type: TokenType.LPAREN, value: '(', pos }); pos++; continue }
    if (ch === ')') { tokens.push({ type: TokenType.RPAREN, value: ')', pos }); pos++; continue }
    if (ch === ',') { tokens.push({ type: TokenType.COMMA, value: ',', pos }); pos++; continue }
    if (ch === ':') { tokens.push({ type: TokenType.COLON, value: ':', pos }); pos++; continue }

    // 比较运算符：<=, >=, <>, <, >, =
    if (ch === '<') {
      if (pos + 1 < src.length && src[pos + 1] === '=') {
        tokens.push({ type: TokenType.LE, value: '<=', pos }); pos += 2
      } else if (pos + 1 < src.length && src[pos + 1] === '>') {
        tokens.push({ type: TokenType.NE, value: '<>', pos }); pos += 2
      } else {
        tokens.push({ type: TokenType.LT, value: '<', pos }); pos++
      }
      continue
    }
    if (ch === '>') {
      if (pos + 1 < src.length && src[pos + 1] === '=') {
        tokens.push({ type: TokenType.GE, value: '>=', pos }); pos += 2
      } else {
        tokens.push({ type: TokenType.GT, value: '>', pos }); pos++
      }
      continue
    }
    if (ch === '=') {
      tokens.push({ type: TokenType.EQ, value: '=', pos }); pos++; continue
    }

    // 字母开头 → 函数名 / 单元格引用
    if (isAlpha(ch)) {
      const start = pos
      while (pos < src.length && (isAlphaNumeric(src[pos]) || src[pos] === '$')) pos++
      const word = src.slice(start, pos)

      // 判断是函数还是单元格引用：看后面是否紧跟 (
      const nextNonSpace = skipSpace(src, pos)
      if (nextNonSpace < src.length && src[nextNonSpace] === '(') {
        tokens.push({ type: TokenType.FUNCTION, value: word, pos: start })
      } else if (pos < src.length && src[pos] === ':') {
        // "A1:" 的情况，先识别为 CELL_REF，range 在 parser 里组合
        tokens.push({ type: TokenType.CELL_REF, value: word, pos: start })
      } else {
        tokens.push({ type: TokenType.CELL_REF, value: word, pos: start })
      }
      continue
    }

    // 无法识别的字符，跳过
    pos++
  }

  tokens.push({ type: TokenType.EOF, value: '', pos: src.length })
  return tokens
}

// ---- 辅助 ----

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isAlpha(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch) || ch === '$'
}

/** 从 pos 开始跳过空白，返回第一个非空白字符的位置 */
function skipSpace(src: string, pos: number): number {
  while (pos < src.length && (src[pos] === ' ' || src[pos] === '\t')) pos++
  return pos
}
