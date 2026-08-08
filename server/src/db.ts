/**
 * 数据库层 —— 使用 Node 内置 node:sqlite（Node 22.5+，零原生依赖）
 *
 * 为什么用整表 JSON 快照而非逐单元格落库：
 * - Workbook 类型天然可 JSON.stringify，一次读/写就是完整文档
 * - Excel 类应用的行级存储复杂度高、收益低（无高频局部更新需求）
 * - 快照天然支持"版本历史"（每条记录一个版本）
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const DB_PATH = join(DATA_DIR, 'moffice.db')

// 确保 data 目录存在（首次启动时创建）
mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

// 初始化表结构（CREATE TABLE IF NOT EXISTS 幂等）
db.exec(`
  CREATE TABLE IF NOT EXISTS workbooks (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

/** 工作簿行记录 */
export interface WorkbookRow {
  id: string
  name: string
  data: string
  created_at: string
  updated_at: string
}

/** 列表项（不含 data 大字段，列表页不需要） */
export interface WorkbookMeta {
  id: string
  name: string
  updated_at: string
}

/** 查询全部工作簿元信息（按更新时间倒序） */
export function listWorkbooks(): WorkbookMeta[] {
  const rows = db
    .prepare(
      `SELECT id, name, updated_at FROM workbooks ORDER BY updated_at DESC`,
    )
    .all() as unknown as WorkbookMeta[]
  return rows
}

/** 按 id 查询单个工作簿（含 data） */
export function getWorkbook(id: string): WorkbookRow | null {
  const row = db
    .prepare(`SELECT * FROM workbooks WHERE id = ?`)
    .get(id) as unknown as WorkbookRow | undefined
  return row ?? null
}

/** 新建或整体覆盖保存（UPSERT） */
export function upsertWorkbook(id: string, name: string, data: string): void {
  db.prepare(
    `INSERT INTO workbooks (id, name, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       data = excluded.data,
       updated_at = datetime('now')`,
  ).run(id, name, data)
}

/** 仅更新名称（不动数据，重命名用），返回是否成功 */
export function renameWorkbook(id: string, name: string): boolean {
  const result = db
    .prepare(`UPDATE workbooks SET name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, id)
  return result.changes > 0
}

/** 删除工作簿，返回是否删除成功 */
export function deleteWorkbook(id: string): boolean {
  const result = db.prepare(`DELETE FROM workbooks WHERE id = ?`).run(id)
  return result.changes > 0
}
