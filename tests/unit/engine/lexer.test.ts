import { describe, it, expect } from 'vitest'
import { tokenize, TokenType } from '@/engine'

/** 便捷：取 token 类型数组 */
function typesOf(input: string): TokenType[] {
  return tokenize(input).map((t) => t.type)
}

describe('Lexer 词法分析', () => {
  it('去掉开头的 = 号', () => {
    const tokens = tokenize('=1+2')
    expect(tokens[0].value).toBe('1')
  })

  it('数字：整数和小数', () => {
    const tokens = tokenize('3.14 42')
    expect(tokens[0]).toMatchObject({ type: TokenType.NUMBER, value: '3.14' })
    expect(tokens[1]).toMatchObject({ type: TokenType.NUMBER, value: '42' })
  })

  it('字符串：带引号保留引号（parser 再剥离）', () => {
    const tokens = tokenize('"hello"')
    expect(tokens[0]).toMatchObject({ type: TokenType.STRING, value: '"hello"' })
  })

  it('未闭合字符串：返回剩余内容并停止', () => {
    const tokens = tokenize('"abc')
    expect(tokens[0]).toMatchObject({ type: TokenType.STRING })
    // 不会死循环，最后是 EOF
    expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF)
  })

  it('函数名识别：后跟 ( 的是 FUNCTION', () => {
    const tokens = tokenize('SUM(1)')
    expect(tokens[0]).toMatchObject({ type: TokenType.FUNCTION, value: 'SUM' })
    expect(tokens[1].type).toBe(TokenType.LPAREN)
  })

  it('单元格引用识别：不是函数的是 CELL_REF', () => {
    const tokens = tokenize('A1')
    expect(tokens[0]).toMatchObject({ type: TokenType.CELL_REF, value: 'A1' })
  })

  it('绝对引用 $A$1', () => {
    const tokens = tokenize('$A$1')
    expect(tokens[0]).toMatchObject({ type: TokenType.CELL_REF, value: '$A$1' })
  })

  it('运算符：+ - * / ^ &', () => {
    const tokens = tokenize('+ - * / ^ &')
    expect(typesOf('+')).toContain(TokenType.PLUS)
    expect(typesOf('-')).toContain(TokenType.MINUS)
    expect(typesOf('*')).toContain(TokenType.MULTIPLY)
    expect(typesOf('/')).toContain(TokenType.DIVIDE)
    expect(typesOf('^')).toContain(TokenType.POWER)
    expect(typesOf('&')).toContain(TokenType.CONCAT)
  })

  it('比较运算符：<= >= <> < > =', () => {
    expect(typesOf('<=')).toContain(TokenType.LE)
    expect(typesOf('>=')).toContain(TokenType.GE)
    expect(typesOf('<>')).toContain(TokenType.NE)
    expect(typesOf('<')).toContain(TokenType.LT)
    expect(typesOf('>')).toContain(TokenType.GT)
    // 注意：单独的 "=" 会被当作公式前缀剥掉，用 "1=2" 测试 EQ
    expect(typesOf('1=2')).toContain(TokenType.EQ)
  })

  it('括号与逗号', () => {
    expect(typesOf('(,)')).toEqual([
      TokenType.LPAREN,
      TokenType.COMMA,
      TokenType.RPAREN,
      TokenType.EOF,
    ])
  })

  it('冒号（范围分隔）', () => {
    expect(typesOf(':')).toContain(TokenType.COLON)
  })

  it('跳过空白', () => {
    const tokens = tokenize(' 1 +  2 ')
    expect(tokens[0].value).toBe('1')
    expect(tokens[1].type).toBe(TokenType.PLUS)
    expect(tokens[2].value).toBe('2')
  })

  it('无法识别的字符被跳过', () => {
    const tokens = tokenize('1#2')
    expect(tokens.map((t) => t.value)).toEqual(['1', '2', ''])
  })

  it('末尾总是 EOF', () => {
    expect(tokenize('1')[tokenize('1').length - 1].type).toBe(TokenType.EOF)
  })

  it('记录 token 起始位置', () => {
    const tokens = tokenize('A1+2')
    expect(tokens[0].pos).toBe(0)
    expect(tokens[1].pos).toBe(2)
    expect(tokens[2].pos).toBe(3)
  })
})
