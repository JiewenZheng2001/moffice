import { describe, it, expect } from 'vitest'
import { computeFormula } from '@/engine'
import { createTestContext } from './helpers'

/** 便捷：计算并返回值 */
function calc(formula: string, cells: Record<string, number | string | null> = {}): unknown {
  return computeFormula(formula, createTestContext(cells)).value
}

describe('Evaluator 求值器', () => {
  describe('算术运算', () => {
    it('加减乘除', () => {
      expect(calc('1+2')).toBe(3)
      expect(calc('5-3')).toBe(2)
      expect(calc('2*3')).toBe(6)
      expect(calc('10/4')).toBe(2.5)
    })

    it('运算优先级', () => {
      expect(calc('1+2*3')).toBe(7)
      expect(calc('(1+2)*3')).toBe(9)
      expect(calc('2+3*4-5')).toBe(9)
    })

    it('幂运算（右结合）', () => {
      expect(calc('2^3')).toBe(8)
      expect(calc('2^3^2')).toBe(512) // 2^(3^2)
    })

    it('一元负号', () => {
      expect(calc('-5+3')).toBe(-2)
      expect(calc('--5')).toBe(5)
      expect(calc('-2^2')).toBe(-4) // -(2^2)
    })

    it('除零返回 #DIV/0!', () => {
      expect(calc('1/0')).toBe('#DIV/0!')
    })

    it('小数', () => {
      expect(calc('0.1+0.2')).toBeCloseTo(0.3)
    })
  })

  describe('字符串与连接', () => {
    it('字符串字面量', () => {
      expect(calc('"hello"')).toBe('hello')
    })

    it('& 连接', () => {
      expect(calc('"a"&"b"')).toBe('ab')
      expect(calc('"x"&1&2.5')).toBe('x12.5')
    })
  })

  describe('比较运算', () => {
    it('数值比较', () => {
      expect(calc('1<2')).toBe(true)
      expect(calc('2<=2')).toBe(true)
      expect(calc('3>2')).toBe(true)
      expect(calc('3>=4')).toBe(false)
      expect(calc('1=1')).toBe(true)
      expect(calc('1<>2')).toBe(true)
    })

    it('字符串比较（大小写不敏感）', () => {
      expect(calc('"ABC"="abc"')).toBe(true)
      expect(calc('"a"="b"')).toBe(false)
    })
  })

  describe('单元格引用', () => {
    it('读取单元格值', () => {
      expect(calc('A1', { A1: 10 })).toBe(10)
    })

    it('空单元格返回 0（数值上下文）', () => {
      expect(calc('B9')).toBe(0)
    })

    it('单元格参与运算', () => {
      expect(calc('A1*2+1', { A1: 3 })).toBe(7)
    })

    it('范围单独使用：单值返回该值，多值返回 #VALUE!', () => {
      expect(calc('A1:A1', { A1: 5 })).toBe(5)
      expect(calc('A1:A2', { A1: 5, A2: 6 })).toBe('#VALUE!')
    })
  })

  describe('内置函数', () => {
    it('SUM：数值累加', () => {
      expect(calc('SUM(1,2,3)')).toBe(6)
    })

    it('SUM：范围求和', () => {
      expect(calc('SUM(A1:A3)', { A1: 1, A2: 2, A3: 3 })).toBe(6)
    })

    it('SUM：混合参数', () => {
      expect(calc('SUM(1, A1, B1:B2)', { A1: 10, B1: 1, B2: 2 })).toBe(14)
    })

    it('SUM：字符串转为 0', () => {
      expect(calc('SUM("abc")')).toBe(0)
    })

    it('AVERAGE', () => {
      expect(calc('AVERAGE(1,2,3)')).toBe(2)
      expect(calc('AVERAGE(A1:A2)', { A1: 0, A2: 10 })).toBe(5)
    })

    it('AVERAGE：空参数返回 0', () => {
      expect(calc('AVERAGE()')).toBe(0)
    })

    it('COUNT：只统计数字', () => {
      expect(calc('COUNT(1,"a",2)')).toBe(2)
      expect(calc('COUNT(1,2,3)')).toBe(3)
    })

    it('COUNTA：统计非空', () => {
      expect(calc('COUNTA(1,"a","")')).toBe(2)
      expect(calc('COUNTA(1,"a","x")')).toBe(3)
    })

    it('MAX / MIN', () => {
      expect(calc('MAX(3,1,2)')).toBe(3)
      expect(calc('MIN(3,1,2)')).toBe(1)
      expect(calc('MAX(A1:A2)', { A1: -5, A2: 5 })).toBe(5)
    })

    it('MAX/MIN：空返回 0', () => {
      expect(calc('MAX()')).toBe(0)
      expect(calc('MIN()')).toBe(0)
    })

    it('IF：真/假分支', () => {
      expect(calc('IF(1>0,"yes","no")')).toBe('yes')
      expect(calc('IF(1<0,"yes","no")')).toBe('no')
      expect(calc('IF(false,1)')).toBe(false) // 无 else 返回 false
    })

    it('IF：条件参数数量错误返回 #VALUE!', () => {
      expect(calc('IF(1)')).toBe('#VALUE!')
      expect(calc('IF(1,2,3,4)')).toBe('#VALUE!')
    })

    it('IF：数值条件（非零为真）', () => {
      expect(calc('IF(1,"t","f")')).toBe('t')
      expect(calc('IF(0,"t","f")')).toBe('f')
    })

    it('CONCATENATE', () => {
      expect(calc('CONCATENATE("a","b",1)')).toBe('ab1')
    })
  })

  describe('错误处理', () => {
    it('未知函数返回 #NAME?', () => {
      expect(calc('FOO(1)')).toBe('#NAME?')
    })

    it('解析错误返回 #ERROR!', () => {
      expect(calc('1+')).toBe('#ERROR!')
      expect(calc('SUM(1,')).toBe('#ERROR!')
    })

    it('错误传播：左侧错误', () => {
      expect(calc('FOO(1)+1')).toBe('#NAME?')
    })

    it('错误传播：右侧错误', () => {
      expect(calc('1+FOO(1)')).toBe('#NAME?')
    })

    it('除零错误传播', () => {
      expect(calc('1/(2-2)')).toBe('#DIV/0!')
      expect(calc('(1/0)+5')).toBe('#DIV/0!')
    })
  })

  describe('computeFormula 依赖提取', () => {
    it('提取单元格引用和范围引用', () => {
      const result = computeFormula('=SUM(A1:B2, C5)', createTestContext())
      expect(result.deps.sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C5'])
    })

    it('提取去重', () => {
      const result = computeFormula('=A1+A1', createTestContext())
      expect(result.deps).toEqual(['A1'])
    })

    it('无引用的公式返回空 deps', () => {
      const result = computeFormula('=1+2', createTestContext())
      expect(result.deps).toEqual([])
    })

    it('返回 AST', () => {
      const result = computeFormula('=1+2', createTestContext())
      expect(result.ast).not.toBeNull()
    })
  })
})
