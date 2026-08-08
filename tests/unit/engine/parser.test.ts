import { describe, it, expect } from 'vitest'
import { parse, tokenize, FormulaParseError, TokenType } from '@/engine'
import type { AstNode, Token } from '@/engine'

/** 便捷：直接解析公式字符串 → AST */
function parseFormula(input: string): AstNode {
  return parse(tokenize(input))
}

/** 便捷：从 AST 提取二元操作信息 */
function binaryOp(node: AstNode): { op: string; left: AstNode; right: AstNode } {
  expect(node.kind).toBe('binaryOp')
  const n = node as Extract<AstNode, { kind: 'binaryOp' }>
  return { op: n.op, left: n.left, right: n.right }
}

describe('Parser 语法分析', () => {
  it('数字字面量', () => {
    const ast = parseFormula('42') as Extract<AstNode, { kind: 'number' }>
    expect(ast.kind).toBe('number')
    expect(ast.value).toBe(42)
  })

  it('小数', () => {
    const ast = parseFormula('3.5') as Extract<AstNode, { kind: 'number' }>
    expect(ast.value).toBe(3.5)
  })

  it('字符串字面量：剥离引号 + 转义双引号', () => {
    const ast = parseFormula('"a""b"') as Extract<AstNode, { kind: 'string' }>
    expect(ast.value).toBe('a"b')
  })

  it('单元格引用', () => {
    const ast = parseFormula('A1') as Extract<AstNode, { kind: 'cellRef' }>
    expect(ast.kind).toBe('cellRef')
    expect(ast.ref).toBe('A1')
  })

  it('范围引用 A1:B3', () => {
    const ast = parseFormula('A1:B3') as Extract<AstNode, { kind: 'range' }>
    expect(ast.kind).toBe('range')
    expect(ast.startRef).toBe('A1')
    expect(ast.endRef).toBe('B3')
  })

  it('运算符优先级：乘除高于加减', () => {
    const ast = parseFormula('1+2*3')
    const { op, left, right } = binaryOp(ast)
    expect(op).toBe('PLUS')
    expect((left as Extract<AstNode, { kind: 'number' }>).value).toBe(1)
    // right 应该是 2*3
    const r = binaryOp(right)
    expect(r.op).toBe('MULTIPLY')
  })

  it('幂运算右结合：2^3^2 = 2^(3^2)', () => {
    const ast = parseFormula('2^3^2')
    const { op, left, right } = binaryOp(ast)
    expect(op).toBe('POWER')
    expect((left as Extract<AstNode, { kind: 'number' }>).value).toBe(2)
    // right 应该是 3^2
    const r = binaryOp(right)
    expect(r.op).toBe('POWER')
  })

  it('一元负号', () => {
    const ast = parseFormula('-5') as Extract<AstNode, { kind: 'unaryOp' }>
    expect(ast.kind).toBe('unaryOp')
    expect(ast.op).toBe('MINUS')
  })

  it('括号改变优先级', () => {
    const ast = parseFormula('(1+2)*3')
    const { op, left } = binaryOp(ast)
    expect(op).toBe('MULTIPLY')
    expect(left.kind).toBe('binaryOp') // 括号内是 1+2
  })

  it('比较运算符解析', () => {
    const ast = parseFormula('1<2')
    expect(binaryOp(ast).op).toBe('LT')
    expect(binaryOp(parseFormula('1<=2')).op).toBe('LE')
    expect(binaryOp(parseFormula('1>=2')).op).toBe('GE')
    expect(binaryOp(parseFormula('1<>2')).op).toBe('NE')
    expect(binaryOp(parseFormula('1=2')).op).toBe('EQ')
  })

  it('文本连接 &', () => {
    const ast = parseFormula('"a"&"b"')
    expect(binaryOp(ast).op).toBe('CONCAT')
  })

  it('函数调用：无参 / 单参 / 多参', () => {
    const empty = parseFormula('NOW()') as Extract<AstNode, { kind: 'functionCall' }>
    expect(empty.name).toBe('NOW')
    expect(empty.args).toHaveLength(0)

    const one = parseFormula('SUM(1)') as Extract<AstNode, { kind: 'functionCall' }>
    expect(one.args).toHaveLength(1)

    const multi = parseFormula('SUM(1,2,3)') as Extract<AstNode, { kind: 'functionCall' }>
    expect(multi.args).toHaveLength(3)
  })

  it('函数名转为大写', () => {
    const ast = parseFormula('sum(1)') as Extract<AstNode, { kind: 'functionCall' }>
    expect(ast.name).toBe('SUM')
  })

  it('函数参数支持表达式', () => {
    const ast = parseFormula('SUM(1+2, A1*2)') as Extract<AstNode, { kind: 'functionCall' }>
    expect(ast.args[0].kind).toBe('binaryOp')
    expect(ast.args[1].kind).toBe('binaryOp')
  })

  it('嵌套函数', () => {
    const ast = parseFormula('SUM(MAX(1,2),3)') as Extract<AstNode, { kind: 'functionCall' }>
    const first = ast.args[0] as Extract<AstNode, { kind: 'functionCall' }>
    expect(first.name).toBe('MAX')
  })

  it('多余 token 报错', () => {
    expect(() => parseFormula('1 2')).toThrow(FormulaParseError)
  })

  it('非法 token 报错', () => {
    expect(() => parseFormula(')')).toThrow(FormulaParseError)
  })

  it('未闭合括号报错', () => {
    expect(() => parseFormula('(1+2')).toThrow(FormulaParseError)
  })

  it('缺少右括号报错', () => {
    expect(() => parseFormula('SUM(1,2')).toThrow(FormulaParseError)
  })

  it('解析错误携带位置', () => {
    try {
      parseFormula('1+')
      expect.unreachable()
    } catch (e) {
      const err = e as FormulaParseError
      expect(err.name).toBe('FormulaParseError')
      expect(typeof err.pos).toBe('number')
    }
  })
})

describe('Parser token 越界防御', () => {
  it('advance 越界时回退到最后一个 token（expect 报错路径）', () => {
    // SUM(1 缺右括号：expect(RPAREN) 时 advance 越过数组末尾
    expect(() => parseFormula('SUM(1')).toThrow(FormulaParseError)
  })

  it('current 越界时回退到 EOF（正常收尾路径）', () => {
    // (1) 解析完成后 pos 到达数组末尾，current() 回退到 EOF 不报错
    const ast = parseFormula('(1)')
    expect(ast.kind).toBe('number')
  })

  it('空 token 数组直接报错', () => {
    expect(() => parse([])).toThrow()
  })

  it('无 EOF 的数组 advance 越界时回退最后一个 token', () => {
    // 手工构造不含 EOF 的 token 数组：expect(RPAREN) 时 advance 真正越界
    const tokens: Token[] = [
      { type: TokenType.LPAREN, value: '(', pos: 0 },
      { type: TokenType.NUMBER, value: '1', pos: 1 },
    ]
    expect(() => parse(tokens)).toThrow(FormulaParseError)
  })
})
