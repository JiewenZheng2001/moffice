import type { CellRef } from './types'

/**
 * 公式相对引用偏移工具 —— 复制/粘贴时平移公式中的单元格引用
 *
 * Excel 行为：复制 C1 的公式 =A1+B1 粘贴到 C2 → =A2+B2
 * - 相对引用（A1）按行列差偏移
 * - 绝对引用（$A$1）不偏移；混合引用（$A1 / A$1）只偏移非 $ 的部分
 * - 跨 sheet 引用（Sheet2!A1）同样偏移
 * - 范围引用（A1:B2）的起止都偏移
 *
 * 实现方式：在公式字符串上做一次扫描，识别 CELL_REF 模式并平移，
 * 不改动公式的其余部分（运算符/函数名/字符串字面量等）
 */

/** 解析单元格引用 → 行列索引（0-based） */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = ref.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i)
  if (!m) return null
  return {
    col: colNameToIndex(m[2]),
    row: parseInt(m[4], 10) - 1,
  }
}

/** 列名 → 列索引（0-based） */
function colNameToIndex(col: string): number {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index - 1
}

/** 列索引 → 列名（0-based → A/Z/AA） */
function indexToColName(col: number): string {
  let result = ''
  let n = col
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

/**
 * 平移一个单元格引用
 * @param ref 形如 "A1" / "$A$1" / "A$1" / "$A1"
 * @param deltaRow 行偏移（目标行 - 源行）
 * @param deltaCol 列偏移（目标列 - 源列）
 * @returns 平移后的引用（绝对部分保持）
 */
export function shiftCellRef(ref: string, deltaRow: number, deltaCol: number): string {
  const m = ref.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/)
  if (!m) return ref
  const [, colAbs, colName, rowAbs, rowNum] = m
  let newCol = colNameToIndex(colName)
  let newRow = parseInt(rowNum, 10) - 1
  // 绝对部分不偏移
  if (!colAbs) newCol += deltaCol
  if (!rowAbs) newRow += deltaRow
  // 越界（列 < 0 或行 < 0）时返回原引用（避免生成非法引用）
  if (newCol < 0 || newRow < 0) return ref
  return `${colAbs}${indexToColName(newCol)}${rowAbs}${newRow + 1}`
}

/**
 * 平移公式字符串中的所有单元格引用
 * 扫描策略：找 "字母+数字" 模式，跳过函数名（后跟 (）与字符串字面量（"..."）
 *
 * @param formula 原公式（可带 = 前缀）
 * @param deltaRow 行偏移
 * @param deltaCol 列偏移
 */
export function shiftFormulaRefs(formula: string, deltaRow: number, deltaCol: number): string {
  // 无偏移直接返回（常见情况：原位粘贴）
  if (deltaRow === 0 && deltaCol === 0) return formula

  let result = ''
  let i = 0
  let inString = false

  while (i < formula.length) {
    const ch = formula[i]

    // 字符串字面量：跳过（其中的文本不偏移）
    if (ch === '"') {
      inString = !inString
      result += ch
      i++
      continue
    }
    if (inString) {
      result += ch
      i++
      continue
    }

    // 检测单元格引用：字母开头（含 $ 前缀），后跟数字
    if (ch === '$' || /[A-Za-z]/.test(ch)) {
      // 尝试匹配完整的单元格引用模式（$?列名$?行号）
      const m = formula.slice(i).match(/^(\$?[A-Za-z]+\$?\d+)/)
      if (m) {
        const ref = m[1]
        // 函数名排除：引用后紧跟 ( 的是函数调用（如 SUM(），不偏移
        const nextChar = formula[i + ref.length]
        const isFunction = nextChar === '('
        // 合法引用要求列名后确实有数字（$A1 合法；纯字母 $A 不合法）
        const refParts = ref.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/)
        const isCellRef = !!refParts && !isFunction

        if (isCellRef) {
          result += shiftCellRef(ref, deltaRow, deltaCol)
          i += ref.length
          continue
        }
        // 不是引用（函数名/部分匹配）→ 按单字符前进
        result += ch
        i++
        continue
      }
      // 可能是列字母前缀（如 "SUM" 的一部分）→ 单字符前进
      result += ch
      i++
      continue
    }

    result += ch
    i++
  }
  return result
}

/** 从单元格引用解析行列（供 computePasteCells 使用） */
export function parseRef(ref: CellRef): { row: number; col: number } | null {
  return parseCellRef(ref)
}

/**
 * 平移一个单元格引用（条件版）—— 插入/删除行/列时使用
 *
 * Excel 语义：相对引用中「越过插入/删除位置」的部分平移，
 * 绝对引用（$）不调整；未越过位置的不动。
 *
 * @param ref 形如 "A1" / "$A$1" / "A$1" / "$A1"
 * @param rowThreshold 行阈值（0-based）：row >= 此值 的相对行 +rowDelta
 * @param rowDelta 行平移量（插入 +1 / 删除 -1）
 * @param colThreshold 列阈值（0-based）：col >= 此值 的相对列 +colDelta
 * @param colDelta 列平移量
 */
export function shiftCellRefPartial(
  ref: string,
  rowThreshold: number,
  rowDelta: number,
  colThreshold: number,
  colDelta: number,
): string {
  const m = ref.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/)
  if (!m) return ref
  const [, colAbs, colName, rowAbs, rowNum] = m
  const col = colNameToIndex(colName)
  const row = parseInt(rowNum, 10) - 1
  let newCol = col
  let newRow = row
  // 绝对部分不调整；相对部分仅在越过阈值时平移
  if (!colAbs && col >= colThreshold) newCol += colDelta
  if (!rowAbs && row >= rowThreshold) newRow += rowDelta
  // 越界保护（列 < 0 / 行 < 0 不生成非法引用）
  if (newCol < 0 || newRow < 0) return ref
  return `${colAbs}${indexToColName(newCol)}${rowAbs}${newRow + 1}`
}

/**
 * 平移公式字符串中的所有单元格引用（条件版）—— 插入/删除行/列后调用
 *
 * 与 shiftFormulaRefs（粘贴用，整体偏移）的区别：
 * - 只有越过插入/删除位置的引用才平移（Excel 语义）
 * - 跳过跨 sheet 引用（`Sheet2!A1`）：插入/删除行只影响当前 sheet，
 *   其他 sheet 的引用必须原样保留（否则 `Sheet2` 会被误识别为引用并平移）
 *
 * @param formula 原公式（可带 = 前缀）
 * @param rowThreshold 行阈值（0-based）
 * @param rowDelta 行平移量
 * @param colThreshold 列阈值（0-based）
 * @param colDelta 列平移量
 */
export function shiftFormulaRefsPartial(
  formula: string,
  rowThreshold: number,
  rowDelta: number,
  colThreshold: number,
  colDelta: number,
): string {
  // 无平移直接返回
  if (rowDelta === 0 && colDelta === 0) return formula

  let result = ''
  let i = 0
  let inString = false

  while (i < formula.length) {
    const ch = formula[i]

    // 字符串字面量：跳过（其中的文本不偏移）
    if (ch === '"') {
      inString = !inString
      result += ch
      i++
      continue
    }
    if (inString) {
      result += ch
      i++
      continue
    }

    // 检测引用模式：$ 或字母开头
    if (ch === '$' || /[A-Za-z]/.test(ch)) {
      const m = formula.slice(i).match(/^(\$?[A-Za-z]+\$?\d+)/)
      if (m) {
        const token = m[1]
        const nextChar = formula[i + token.length]
        // 函数名排除：后跟 ( 的是函数调用（如 SUM(）
        const isFunction = nextChar === '('
        // 跨 sheet 前缀排除：`Sheet2!A1` 整体原样复制（不平移）
        if (nextChar === '!') {
          // 向后找 cell 引用部分（$?列名$?行号）
          const sheetRef = formula.slice(i + token.length + 1).match(/^(\$?[A-Za-z]+\$?\d+)/)
          if (sheetRef) {
            result += token + '!' + sheetRef[1]
            i += token.length + 1 + sheetRef[1].length
            continue
          }
          // 异常的 `Name!` 没有引用 → 原样输出
          result += ch
          i++
          continue
        }
        // 合法引用要求列名后确实有数字（$A1 合法；纯字母 $A 不合法）
        const isCellRef = !!token.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/) && !isFunction
        if (isCellRef) {
          result += shiftCellRefPartial(token, rowThreshold, rowDelta, colThreshold, colDelta)
          i += token.length
          continue
        }
      }
      // 函数名 / 部分匹配 → 单字符前进
      result += ch
      i++
      continue
    }

    result += ch
    i++
  }
  return result
}
