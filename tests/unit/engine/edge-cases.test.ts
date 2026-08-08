import { describe, it, expect } from 'vitest'
import { tokenize, parse, evaluate, computeFormula, DependencyGraph, TokenType, FormulaParseError } from '@/engine'
import type { EvalContext, AstNode, Token } from '@/engine'
import { createTestContext } from './helpers'

/**
 * 边缘分支覆盖测试 —— 补齐 100% 分支覆盖的缺口
 * 多为防御性代码（运行时不可自然触达的分支），通过构造 AST / Token 直接测试
 */
describe('边缘分支覆盖', () => {
  describe('Lexer', () => {
    it('.5 以点开头的小数', () => {
      const tokens = tokenize('.5')
      expect(tokens[0]).toMatchObject({ type: TokenType.NUMBER, value: '.5' })
    })

    it('空字符串 ""', () => {
      const tokens = tokenize('""')
      expect(tokens[0]).toMatchObject({ type: TokenType.STRING, value: '""' })
    })

    it('空公式只产生 EOF', () => {
      const tokens = tokenize('')
      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })
  })

  describe('Parser RANGE token 防御分支', () => {
    it('直接构造 RANGE token 可解析为 range 节点', () => {
      const tokens: Token[] = [
        { type: TokenType.RANGE, value: 'A1:B2', pos: 0 },
        { type: TokenType.EOF, value: '', pos: 5 },
      ]
      const ast = parse(tokens) as Extract<AstNode, { kind: 'range' }>
      expect(ast.kind).toBe('range')
      expect(ast.startRef).toBe('A1')
      expect(ast.endRef).toBe('B2')
    })
  })

  describe('Evaluator 防御分支', () => {
    const ctx = createTestContext()

    it('未知二元操作符 → #ERROR!', () => {
      const ast = {
        kind: 'binaryOp',
        op: 'BAD_OP',
        left: { kind: 'number', value: 1 },
        right: { kind: 'number', value: 2 },
      } as unknown as AstNode
      expect(evaluate(ast, ctx)).toBe('#ERROR!')
    })

    it('一元操作符非 MINUS → 返回原值', () => {
      const ast = {
        kind: 'unaryOp',
        op: 'PLUS',
        operand: { kind: 'number', value: 7 },
      } as unknown as AstNode
      expect(evaluate(ast, ctx)).toBe(7)
    })

    it('未知 AST 节点类型 → #ERROR!', () => {
      const ast = { kind: 'unknownNode', value: 1 } as unknown as AstNode
      expect(evaluate(ast, ctx)).toBe('#ERROR!')
    })

    it('函数参数求值错误 → 压入 null（SUM 忽略）', () => {
      // FOO(1) 是 #NAME?，flattenArgs 将其转为 null → SUM 结果为 0
      expect(computeFormula('=SUM(FOO(1), 5)', ctx).value).toBe(5)
    })

    it('比较：数值 vs 字符串混合（走字符串比较分支）', () => {
      expect(computeFormula('=1="1"', ctx).value).toBe(true)
      expect(computeFormula('="abc"=1', ctx).value).toBe(false)
    })

    it('IF：字符串条件（非空/非 "0" 为真；# 开头视为错误传播）', () => {
      expect(computeFormula('=IF("x","t","f")', ctx).value).toBe('t')
      expect(computeFormula('=IF("","t","f")', ctx).value).toBe('f')
      expect(computeFormula('=IF("0","t","f")', ctx).value).toBe('f')
      // "#NAME?" 字符串被 isError 拦截 → 错误传播而非走 isTruthy
      expect(computeFormula('=IF("#NAME?","t","f")', ctx).value).toBe('#NAME?')
    })

    it('一元负号作用于错误值 → 错误传播', () => {
      const ast = {
        kind: 'unaryOp',
        op: TokenType.MINUS,
        operand: { kind: 'cellRef', ref: 'BAD' },
      } as unknown as AstNode
      // BAD 单元格不存在 → 返回 0 → 一元负号得 -0（JS 语义，数值上等于 0）
      expect(Object.is(evaluate(ast, ctx), -0)).toBe(true)
      // 错误传播路径：operand 是未知函数调用
      const errAst = {
        kind: 'unaryOp',
        op: TokenType.MINUS,
        operand: { kind: 'functionCall', name: 'FOO', args: [] },
      } as unknown as AstNode
      expect(evaluate(errAst, ctx)).toBe('#NAME?')
    })
  })

  describe('DependencyGraph 防御分支', () => {
    it('依赖已存在时复用 dependents Set', () => {
      const g = new DependencyGraph()
      g.setDeps('C1', ['A1'])
      // A1 已存在于 dependents，走 has() 为真的分支
      expect(g.setDeps('D1', ['A1'])).toBeNull()
      expect(g.getAffectedCells('A1').sort()).toEqual(['C1', 'D1'])
    })

    it('getAffectedCells 去重：同一节点被多个父依赖', () => {
      const g = new DependencyGraph()
      // C1 同时依赖 A1 和 B1；B1 也依赖 A1
      // → A1 的依赖者 {C1, B1}，B1 的依赖者 {C1} 已被访问 → visited 去重分支
      g.setDeps('C1', ['A1', 'B1'])
      g.setDeps('B1', ['A1'])
      const affected = g.getAffectedCells('A1').sort()
      expect(affected).toEqual(['B1', 'C1'])
    })

    it('getAffectedCells 对无依赖者返回空', () => {
      const g = new DependencyGraph()
      expect(g.getAffectedCells('ZZ99')).toEqual([])
    })

    it('DFS 经过无邻居节点（叶子引用）', () => {
      const g = new DependencyGraph()
      // B1 是叶子（无出边），DFS 检测环时会经过 neighbors 为空的节点
      expect(g.setDeps('C1', ['A1', 'B1'])).toBeNull()
    })

    it('expandRange 非法引用防御（无数字的列引用）', () => {
      // A:B2 中 "A" 不是合法单元格引用 → expandRange 原样返回
      const ast = parse(tokenize('=A:B2'))
      expect(DependencyGraph.extractRefs(ast)).toEqual(['A', 'B2'])
    })

    it('多字母列的范围展开（AA1:AB2）', () => {
      const ast = parse(tokenize('=AA1:AB2'))
      expect(DependencyGraph.extractRefs(ast).sort()).toEqual([
        'AA1', 'AA2', 'AB1', 'AB2',
      ])
    })

    it('范围两端非法时原样返回', () => {
      const ast = parse(tokenize('=XX:YY'))
      expect(DependencyGraph.extractRefs(ast)).toEqual(['XX', 'YY'])
    })

    it('循环检测：visited 缓存命中（菱形依赖）', () => {
      const g = new DependencyGraph()
      // A1 → B1 → D1，A1 → C1 → D1（菱形）
      // 检测 A1 的环时，第二条路径遇到 D1 已 visited → 短路
      expect(g.setDeps('B1', ['D1'])).toBeNull()
      expect(g.setDeps('C1', ['D1'])).toBeNull()
      expect(g.setDeps('A1', ['B1', 'C1'])).toBeNull()
    })
  })

  describe('computeFormula 错误兜底', () => {
    it('求值器抛出非解析错误 → #ERROR!', () => {
      const badCtx: EvalContext = {
        getCellValue() {
          throw new Error('boom')
        },
        getRangeValues() {
          return []
        },
      }
      const result = computeFormula('=A1', badCtx)
      expect(result.value).toBe('#ERROR!')
      expect(result.ast).toBeNull()
    })

    it('FormulaParseError 显示为 #ERROR!', () => {
      const result = computeFormula('=SUM(', createTestContext())
      expect(result.value).toBe('#ERROR!')
    })

    it('非法公式不会抛出异常（对外安全）', () => {
      expect(() => computeFormula('=1+', createTestContext())).not.toThrow()
    })
  })

  describe('FormulaParseError 类', () => {
    it('包含位置信息和格式化消息', () => {
      const err = new FormulaParseError('Unexpected token', 5)
      expect(err.name).toBe('FormulaParseError')
      expect(err.pos).toBe(5)
      expect(err.message).toContain('position 5')
    })
  })
})
