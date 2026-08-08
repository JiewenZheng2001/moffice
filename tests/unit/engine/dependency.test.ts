import { describe, it, expect } from 'vitest'
import { DependencyGraph, parse, tokenize } from '@/engine'

describe('DependencyGraph 依赖图', () => {
  it('setDeps：建立依赖关系', () => {
    const g = new DependencyGraph()
    g.setDeps('C1', ['A1', 'B1'])
    expect(g.getDirectDeps('C1').sort()).toEqual(['A1', 'B1'])
  })

  it('getAffectedCells：直接依赖', () => {
    const g = new DependencyGraph()
    g.setDeps('C1', ['A1'])
    expect(g.getAffectedCells('A1')).toEqual(['C1'])
  })

  it('getAffectedCells：间接依赖（BFS）', () => {
    const g = new DependencyGraph()
    // A1 ← B1 ← C1（C1 依赖 B1，B1 依赖 A1）
    g.setDeps('B1', ['A1'])
    g.setDeps('C1', ['B1'])
    const affected = g.getAffectedCells('A1').sort()
    expect(affected).toEqual(['B1', 'C1'])
  })

  it('setDeps：替换旧依赖', () => {
    const g = new DependencyGraph()
    g.setDeps('C1', ['A1'])
    g.setDeps('C1', ['B1'])
    expect(g.getDirectDeps('C1')).toEqual(['B1'])
    // A1 不再影响 C1
    expect(g.getAffectedCells('A1')).toEqual([])
    expect(g.getAffectedCells('B1')).toEqual(['C1'])
  })

  it('removeDeps：移除依赖关系', () => {
    const g = new DependencyGraph()
    g.setDeps('C1', ['A1'])
    g.removeDeps('C1')
    expect(g.getAffectedCells('A1')).toEqual([])
    expect(g.getDirectDeps('C1')).toEqual([])
  })

  it('循环引用检测：直接环', () => {
    const g = new DependencyGraph()
    g.setDeps('A1', ['B1'])
    expect(g.setDeps('B1', ['A1'])).toBe('#CIRCULAR!')
    // 环被回滚
    expect(g.getDirectDeps('B1')).toEqual([])
  })

  it('循环引用检测：间接环', () => {
    const g = new DependencyGraph()
    g.setDeps('A1', ['B1'])
    g.setDeps('B1', ['C1'])
    expect(g.setDeps('C1', ['A1'])).toBe('#CIRCULAR!')
    expect(g.getDirectDeps('C1')).toEqual([])
  })

  it('非循环的多级依赖返回 null', () => {
    const g = new DependencyGraph()
    g.setDeps('A1', ['B1'])
    g.setDeps('B1', ['C1'])
    expect(g.setDeps('C1', ['D1'])).toBeNull()
  })

  it('自引用是环', () => {
    const g = new DependencyGraph()
    expect(g.setDeps('A1', ['A1'])).toBe('#CIRCULAR!')
  })

  describe('extractRefs 静态方法', () => {
    it('提取 cellRef', () => {
      const ast = parse(tokenize('=A1'))
      expect(DependencyGraph.extractRefs(ast)).toEqual(['A1'])
    })

    it('展开范围引用', () => {
      const ast = parse(tokenize('=A1:B2'))
      expect(DependencyGraph.extractRefs(ast).sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
    })

    it('遍历嵌套结构', () => {
      const ast = parse(tokenize('=SUM(A1:C1, D5)'))
      expect(DependencyGraph.extractRefs(ast).sort()).toEqual(['A1', 'B1', 'C1', 'D5'])
    })

    it('逆序范围正常展开', () => {
      const ast = parse(tokenize('=B2:A1'))
      expect(DependencyGraph.extractRefs(ast).sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
    })

    it('去重', () => {
      const ast = parse(tokenize('=A1+A1+A2'))
      expect(DependencyGraph.extractRefs(ast).sort()).toEqual(['A1', 'A2'])
    })

    it('纯数字公式无引用', () => {
      const ast = parse(tokenize('=1+2'))
      expect(DependencyGraph.extractRefs(ast)).toEqual([])
    })

    it('一元负号内引用', () => {
      const ast = parse(tokenize('=-A1'))
      expect(DependencyGraph.extractRefs(ast)).toEqual(['A1'])
    })
  })
})
