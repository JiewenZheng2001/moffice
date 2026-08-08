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
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workbooks (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// 迁移：老数据库的 workbooks 表没有 user_id 列 → 补列并关联默认用户
// （PRAGMA table_info 检查列是否存在，避免重复 ALTER）
const wbColumns = db.prepare(`PRAGMA table_info(workbooks)`).all() as { name: string }[]
if (!wbColumns.some((c) => c.name === 'user_id')) {
  db.exec(`
    ALTER TABLE workbooks ADD COLUMN user_id TEXT REFERENCES users(id);
  `)
  console.warn('[db] migration: workbooks.user_id 已补列（旧数据归入默认用户）')
}

/** 用户行记录 */
export interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: string
}

/** 按用户名查询用户 */
export function getUserByUsername(username: string): UserRow | null {
  const row = db
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as unknown as UserRow | undefined
  return row ?? null
}

/** 创建用户 */
export function createUser(id: string, username: string, passwordHash: string): void {
  db.prepare(`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`)
    .run(id, username, passwordHash)
}

/** 工作簿行记录 */
export interface WorkbookRow {
  id: string
  user_id: string
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

/** 查询用户的工作簿元信息（按更新时间倒序） */
export function listWorkbooks(userId: string): WorkbookMeta[] {
  const rows = db
    .prepare(
      `SELECT id, name, updated_at FROM workbooks
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(userId) as unknown as WorkbookMeta[]
  return rows
}

/** 按 id 查询单个工作簿（含 data，校验归属用户） */
export function getWorkbook(id: string, userId: string): WorkbookRow | null {
  const row = db
    .prepare(`SELECT * FROM workbooks WHERE id = ? AND user_id = ?`)
    .get(id, userId) as unknown as WorkbookRow | undefined
  return row ?? null
}

/** 新建或整体覆盖保存（UPSERT，绑定用户）
 * 注意：冲突时也更新 user_id —— 旧数据（无主时代）迁移后 user_id 为 NULL，
 * 新用户保存同名 id 时必须接管归属，否则保存"成功"但列表里看不到。
 */
export function upsertWorkbook(id: string, userId: string, name: string, data: string): void {
  db.prepare(
    `INSERT INTO workbooks (id, user_id, name, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       name = excluded.name,
       data = excluded.data,
       updated_at = datetime('now')`,
  ).run(id, userId, name, data)
}

/** 仅更新名称（不动数据，重命名用），返回是否成功 */
export function renameWorkbook(id: string, userId: string, name: string): boolean {
  const result = db
    .prepare(`UPDATE workbooks SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(name, id, userId)
  return result.changes > 0
}

/** 删除工作簿（校验归属用户），返回是否删除成功 */
export function deleteWorkbook(id: string, userId: string): boolean {
  const result = db.prepare(`DELETE FROM workbooks WHERE id = ? AND user_id = ?`).run(id, userId)
  return result.changes > 0
}
