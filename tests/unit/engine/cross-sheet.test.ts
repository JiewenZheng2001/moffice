import { describe, it, expect } from 'vitest'
import { tokenize, parse, computeFormula, TokenType, DependencyGraph } from '@/engine'
import type { AstNode, EvalContext } from '@/engine'

/** 多 sheet 求值上下文：按名字查 sheet */
function createMultiSheetContext(sheets: Record<string, Record<string, number | string>>): EvalContext {
  return {
    getCellValue(ref: string, sheetName?: string): number | string | null {
      const sheet = sheetName ? sheets[sheetName] : sheets['Sheet1']
      if (!sheet) return null
      return sheet[ref.toUpperCase()] ?? null
    },
    getRangeValues(startRef: string, endRef: string, sheetName?: string): (number | string | null)[] {
      const sheet = sheetName ? sheets[sheetName] : sheets['Sheet1']
      if (!sheet) return []
      // 简化：测试只覆盖小范围
      const values: (number | string | null)[] = []
      const m1 = startRef.match(/^([A-Z]+)(\d+)$/)
      const m2 = endRef.match(/^([A-Z]+)(\d+)$/)
      if (!m1 || !m2) return []
      const c1 = m1[1].charCodeAt(0) - 65
      const c2 = m2[1].charCodeAt(0) - 65
      const r1 = parseInt(m1[2], 10)
      const r2 = parseInt(m2[2], 10)
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          const ref = `${String.fromCharCode(65 + c)}${r}`
          values.push(sheet[ref] ?? null)
        }
      }
      return values
    },
  }
}

describe('跨 Sheet 公式引用', () => {
  describe('Lexer', () => {
    it('识别 Sheet2!A1 为 SHEET_REF', () => {
      const tokens = tokenize('=Sheet2!A1')
      expect(tokens[0]).toMatchObject({ type: TokenType.SHEET_REF, value: 'Sheet2!A1' })
    })

    it('带数字的 sheet 名识别', () => {
      const tokens = tokenize('=Sheet2!A1')
      expect(tokens[0]).toMatchObject({ type: TokenType.SHEET_REF, value: 'Sheet2!A1' })
    })

    it('普通引用不受影响', () => {
      const tokens = tokenize('=A1')
      expect(tokens[0].type).toBe(TokenType.CELL_REF)
    })

    it('跨 sheet 范围：Sheet2!A1:B2', () => {
      const tokens = tokenize('=Sheet2!A1:B2')
      expect(tokens[0]).toMatchObject({ type: TokenType.SHEET_REF, value: 'Sheet2!A1' })
      expect(tokens[1].type).toBe(TokenType.COLON)
      expect(tokens[2]).toMatchObject({ type: TokenType.CELL_REF, value: 'B2' })
    })
  })

  describe('Parser', () => {
    it('Sheet2!A1 → sheetRef 节点', () => {
      const ast = parse(tokenize('=Sheet2!A1')) as Extract<AstNode, { kind: 'sheetRef' }>
      expect(ast.kind).toBe('sheetRef')
      expect(ast.sheet).toBe('Sheet2')
      expect(ast.ref).toBe('A1')
    })

    it('Sheet2!A1:B2 → sheetRange 节点', () => {
      const ast = parse(tokenize('=Sheet2!A1:B2')) as Extract<AstNode, { kind: 'sheetRange' }>
      expect(ast.kind).toBe('sheetRange')
      expect(ast.sheet).toBe('Sheet2')
      expect(ast.startRef).toBe('A1')
      expect(ast.endRef).toBe('B2')
    })

    it('函数参数内支持跨 sheet 引用', () => {
      const ast = parse(tokenize('=SUM(Sheet2!A1:B2)')) as Extract<AstNode, { kind: 'functionCall' }>
      expect(ast.args[0].kind).toBe('sheetRange')
    })
  })

  describe('Evaluator', () => {
    const ctx = createMultiSheetContext({
      Sheet1: { A1: 10 },
      Sheet2: { A1: 5, A2: 7 },
    })

    it('跨 sheet 单格引用', () => {
      expect(computeFormula('=Sheet2!A1', ctx).value).toBe(5)
    })

    it('跨 sheet 参与运算', () => {
      expect(computeFormula('=Sheet2!A1*2', ctx).value).toBe(10)
    })

    it('跨 sheet 范围求和', () => {
      expect(computeFormula('=SUM(Sheet2!A1:A2)', ctx).value).toBe(12)
    })

    it('不存在的 sheet 返回 0（空单元格语义）', () => {
      expect(computeFormula('=Nonexistent!A1', ctx).value).toBe(0)
    })

    it('依赖提取：跨 sheet 引用带名字前缀', () => {
      const result = computeFormula('=Sheet2!A1+Sheet2!B1', ctx)
      expect(result.deps.sort()).toEqual(['Sheet2!A1', 'Sheet2!B1'])
    })

    it('依赖提取：跨 sheet 范围展开', () => {
      const result = computeFormula('=SUM(Sheet2!A1:B2)', ctx)
      expect(result.deps.sort()).toEqual(['Sheet2!A1', 'Sheet2!A2', 'Sheet2!B1', 'Sheet2!B2'])
    })
  })

  describe('DependencyGraph.extractRefs', () => {
    it('跨 sheet 引用去重', () => {
      const ast = parse(tokenize('=Sheet2!A1+Sheet2!A1'))
      expect(DependencyGraph.extractRefs(ast)).toEqual(['Sheet2!A1'])
    })
  })
})
