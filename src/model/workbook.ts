import type { Workbook } from './types'
import { createSheet } from './sheet'

/** 创建空白工作簿（含一个默认 Sheet） */
export function createWorkbook(name: string = '未命名表格'): Workbook {
  const sheet = createSheet('Sheet1')
  return {
    id: `wb-${Date.now()}`,
    name,
    sheets: [sheet],
    activeSheetId: sheet.id,
  }
}
