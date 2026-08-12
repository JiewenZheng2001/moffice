/**
 * MOffice D1 数据层 —— 与 server/src/db.ts 逻辑一致，适配 D1 API
 *
 * D1 是 Cloudflare 的 SQLite 兼容数据库（免费 5GB）
 * - SQL 语句与原版基本一致（datetime('now')、UPSERT 等均支持）
 * - API 差异：prepare().bind().first()/all()/run() 全部异步
 * - 通过 Worker 的 D1 binding（wrangler.toml 中 [[d1_databases]]）访问
 */

/** 用户行记录（与 server/src/db.ts 一致） */
export interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: string
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

/** 列表项（不含 data 大字段） */
export interface WorkbookMeta {
  id: string
  name: string
  updated_at: string
}

/** 按用户名查询用户 */
export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  const row = await db.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>()
  return row ?? null
}

/** 创建用户 */
export async function createUser(db: D1Database, id: string, username: string, passwordHash: string): Promise<void> {
  await db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .bind(id, username, passwordHash)
    .run()
}

/** 查询用户的工作簿元信息（按更新时间倒序） */
export async function listWorkbooks(db: D1Database, userId: string): Promise<WorkbookMeta[]> {
  const { results } = await db.prepare(
    `SELECT id, name, updated_at FROM workbooks
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all<WorkbookMeta>()
  return results
}

/** 按 id 查询单个工作簿（校验归属用户） */
export async function getWorkbook(db: D1Database, id: string, userId: string): Promise<WorkbookRow | null> {
  const row = await db.prepare('SELECT * FROM workbooks WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<WorkbookRow>()
  return row ?? null
}

/** 新建或整体覆盖保存（UPSERT，绑定用户） */
export async function upsertWorkbook(
  db: D1Database,
  id: string,
  userId: string,
  name: string,
  data: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO workbooks (id, user_id, name, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       name = excluded.name,
       data = excluded.data,
       updated_at = datetime('now')`,
  )
    .bind(id, userId, name, data)
    .run()
}

/** 仅更新名称（重命名用），返回是否成功 */
export async function renameWorkbook(db: D1Database, id: string, userId: string, name: string): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE workbooks SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  )
    .bind(name, id, userId)
    .run()
  return result.meta.changes > 0
}

/** 删除工作簿（校验归属用户），返回是否删除成功 */
export async function deleteWorkbook(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM workbooks WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  return result.meta.changes > 0
}
