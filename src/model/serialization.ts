import type { Sheet, Workbook } from './types'

/**
 * 工作簿序列化工具 —— 处理 Map ↔ 普通对象的转换
 *
 * 背景：JSON.stringify 无法序列化 Map（会变成空对象 {}）。
 * Workbook 中 `cells` / `columnWidths` / `rowHeights` 都是 Map，
 * 保存到后端再加载回来后必须手动还原为 Map。
 *
 * - serializeWorkbook: Workbook → JSON 字符串（保存用）
 * - deserializeWorkbook: JSON 字符串 → Workbook（加载用，Map 还原）
 */

/** 将 Sheet 中的 Map 字段转回 Map（反序列化核心） */
function restoreSheetMaps(sheet: Sheet): Sheet {
  return {
    ...sheet,
    // cells: JSON 序列化后是 { "A1": {...} }，转回 Map
    cells: sheet.cells instanceof Map
      ? sheet.cells
      : new Map(Object.entries(sheet.cells as unknown as Record<string, never>)),
    // columnWidths / rowHeights: key 是数字索引，序列化后变成字符串，需 parseInt 还原
    columnWidths: restoreNumberMap(sheet.columnWidths),
    rowHeights: restoreNumberMap(sheet.rowHeights),
  }
}

/** 数字 key 的 Map：JSON 往返后 key 变成字符串，转回 number */
function restoreNumberMap(map: Map<number, number> | Record<string, number>): Map<number, number> {
  if (map instanceof Map) return map
  const result = new Map<number, number>()
  for (const [k, v] of Object.entries(map as Record<string, number>)) {
    result.set(parseInt(k, 10), v)
  }
  return result
}

/** 将工作簿序列化为 JSON 字符串（后端保存用）
 * JSON.stringify 无法序列化 Map（会变成空 {}），
 * 保存前必须先把 Map 字段转为普通对象，加载时再还原。
 */
export function serializeWorkbook(workbook: Workbook): string {
  return JSON.stringify({
    ...workbook,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      // Map → 普通对象 { "A1": {...} }，key 保持字符串
      cells: Object.fromEntries(sheet.cells),
      columnWidths: Object.fromEntries(sheet.columnWidths),
      rowHeights: Object.fromEntries(sheet.rowHeights),
    })),
  })
}

/** 将 JSON 字符串反序列化为工作簿（后端加载用，还原所有 Map 字段） */
export function deserializeWorkbook(json: string): Workbook {
  const parsed = JSON.parse(json) as Workbook
  return {
    ...parsed,
    sheets: parsed.sheets.map(restoreSheetMaps),
  }
}
