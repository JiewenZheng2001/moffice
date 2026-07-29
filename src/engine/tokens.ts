// ---- Token 类型 ----

/** 使用 const 对象替代 enum，兼容 TypeScript 6 erasableSyntaxOnly */
export const TokenType = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  CELL_REF: 'CELL_REF',
  RANGE: 'RANGE',
  FUNCTION: 'FUNCTION',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  MULTIPLY: 'MULTIPLY',
  DIVIDE: 'DIVIDE',
  POWER: 'POWER',
  CONCAT: 'CONCAT',
  EQ: 'EQ',
  LT: 'LT',
  GT: 'GT',
  LE: 'LE',
  GE: 'GE',
  NE: 'NE',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  COLON: 'COLON',
  EOF: 'EOF',
} as const

export type TokenType = (typeof TokenType)[keyof typeof TokenType]

export interface Token {
  type: TokenType
  value: string
  /** 在原公式字符串中的起始位置 */
  pos: number
}

// ---- AST 节点类型 ----

export type AstNode =
  | NumberLiteralNode
  | StringLiteralNode
  | CellRefNode
  | RangeNode
  | FunctionCallNode
  | BinaryOpNode
  | UnaryOpNode

export interface NumberLiteralNode {
  kind: 'number'
  value: number
}

export interface StringLiteralNode {
  kind: 'string'
  value: string
}

export interface CellRefNode {
  kind: 'cellRef'
  ref: string       // 如 "A1", "$B$2"
}

export interface RangeNode {
  kind: 'range'
  startRef: string
  endRef: string
}

export interface FunctionCallNode {
  kind: 'functionCall'
  name: string       // 函数名大写，如 "SUM"
  args: AstNode[]
}

export interface BinaryOpNode {
  kind: 'binaryOp'
  op: TokenType
  left: AstNode
  right: AstNode
}

export interface UnaryOpNode {
  kind: 'unaryOp'
  op: TokenType      // MINUS（负号）
  operand: AstNode
}

// ---- 公式错误 ----

export type FormulaErrorType =
  | '#REF!'
  | '#VALUE!'
  | '#DIV/0!'
  | '#NAME?'
  | '#NUM!'
  | '#ERROR!'
  | '#CIRCULAR!'

/** 求值上下文：提供单元格取值能力，由外部注入 */
export interface EvalContext {
  /** 获取单元格的 computedValue */
  getCellValue(ref: string): number | string | null
  /** 展开范围引用，返回该范围内所有非空单元格的 computedValue */
  getRangeValues(startRef: string, endRef: string): (number | string | null)[]
}
