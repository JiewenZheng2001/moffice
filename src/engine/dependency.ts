import type { AstNode } from './tokens'
import type { FormulaErrorType } from './tokens'

/**
 * 公式依赖图 —— 有向无环图（DAG）
 *
 * 用途：
 * 1. 当单元格 A 的公式引用了单元格 B，则记录 B → A 的边
 * 2. 当 B 的值改变时，需要重新计算 A（以及所有间接依赖 A 的单元格）
 * 3. 在添加依赖前检测是否会形成环（循环引用）
 */
export class DependencyGraph {
  /** 出边：key 依赖 values（key 的公式引用了 values 中的单元格） */
  private deps = new Map<string, Set<string>>()

  /** 入边：key 被 values 依赖（key 的值改变时 values 需要重算） */
  private dependents = new Map<string, Set<string>>()

  /**
   * 为指定单元格设置新的依赖列表
   * @param cellRef 包含公式的单元格
   * @param newDeps 公式中引用的所有单元格
   * @returns 如果检测到循环引用则返回 "#CIRCULAR!"，否则返回 null
   */
  setDeps(cellRef: string, newDeps: string[]): FormulaErrorType | null {
    // 清除旧依赖
    this.removeDeps(cellRef)

    // 临时添加新依赖用于循环检测
    const depSet = new Set(newDeps)
    this.deps.set(cellRef, depSet)
    for (const dep of newDeps) {
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set())
      }
      this.dependents.get(dep)!.add(cellRef)
    }

    // 循环检测
    if (this.hasCycle(cellRef)) {
      // 回滚
      this.removeDeps(cellRef)
      return '#CIRCULAR!'
    }

    return null
  }

  /** 移除单元格的所有依赖关系 */
  removeDeps(cellRef: string): void {
    const oldDeps = this.deps.get(cellRef)
    if (oldDeps) {
      for (const dep of oldDeps) {
        this.dependents.get(dep)?.delete(cellRef)
      }
    }
    this.deps.delete(cellRef)
  }

  /** 获取指定单元格变更后需要重算的所有单元格（包括间接依赖） */
  getAffectedCells(cellRef: string): string[] {
    const visited = new Set<string>()
    const result: string[] = []
    const stack = [cellRef]

    while (stack.length > 0) {
      const current = stack.pop()!
      const deps = this.dependents.get(current)
      if (!deps) continue
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep)
          result.push(dep)
          stack.push(dep) // 继续追踪间接依赖
        }
      }
    }
    return result
  }

  /** 获取指定单元格的直接依赖 */
  getDirectDeps(cellRef: string): string[] {
    return [...(this.deps.get(cellRef) ?? [])]
  }

  /** DFS 检测从 start 出发是否存在环 */
  private hasCycle(start: string): boolean {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const deps = this.deps // 捕获 this，避免内部函数 this 丢失

    function dfs(node: string): boolean {
      if (visiting.has(node)) return true // 发现环
      if (visited.has(node)) return false
      visiting.add(node)
      const neighbors = deps.get(node)
      if (neighbors) {
        for (const n of neighbors) {
          if (dfs(n)) return true
        }
      }
      visiting.delete(node)
      visited.add(node)
      return false
    }

    return dfs(start)
  }

  /** 从 AST 中提取所有单元格引用 */
  static extractRefs(node: AstNode): string[] {
    const refs: string[] = []
    collectRefs(node, refs)
    return [...new Set(refs)]
  }
}

/** 递归收集 AST 中的 CELL_REF 和 RANGE 引用 */
function collectRefs(node: AstNode, refs: string[]): void {
  switch (node.kind) {
    case 'cellRef':
      refs.push(node.ref)
      break
    case 'sheetRef':
      // 跨 sheet 引用：deps key 用完整 "Sheet2!A1"（与 formulaStore 的 sheetId 隔离策略配合）
      refs.push(`${node.sheet}!${node.ref}`)
      break
    case 'sheetRange':
      // 跨 sheet 范围展开，同样带 sheet 前缀
      for (const r of expandRange(node.startRef, node.endRef)) {
        refs.push(`${node.sheet}!${r}`)
      }
      break
    case 'range':
      // 展开范围引用为单个单元格引用
      const expanded = expandRange(node.startRef, node.endRef)
      refs.push(...expanded)
      break
    case 'binaryOp':
      collectRefs(node.left, refs)
      collectRefs(node.right, refs)
      break
    case 'unaryOp':
      collectRefs(node.operand, refs)
      break
    case 'functionCall':
      for (const arg of node.args) {
        collectRefs(arg, refs)
      }
      break
    // number / string 无需处理
  }
}

/** 展开范围引用 "A1:B3" → ["A1","A2","A3","B1","B2","B3"] */
function expandRange(startRef: string, endRef: string): string[] {
  const s = parseCellRef(startRef)
  const e = parseCellRef(endRef)
  if (!s || !e) return [startRef, endRef]

  const refs: string[] = []
  const startCol = Math.min(s.col, e.col)
  const endCol = Math.max(s.col, e.col)
  const startRow = Math.min(s.row, e.row)
  const endRow = Math.max(s.row, e.row)

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      refs.push(`${colToLetter(c)}${r + 1}`)
    }
  }
  return refs
}

/** 解析 "A1" → { col: 0, row: 0 } */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return {
    col: colToIndex(m[1].toUpperCase()),
    row: parseInt(m[2], 10) - 1,
  }
}

function colToIndex(col: string): number {
  let result = 0
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64)
  }
  return result - 1
}

function colToLetter(col: number): string {
  let result = ''
  let n = col
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}
