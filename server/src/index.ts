/**
 * MOffice 后端服务
 *
 * 职责：用户认证（JWT）+ 工作簿的保存 / 加载 / 列表 / 删除（REST API）
 * 技术栈：Express + node:sqlite（内置）+ node:crypto（scrypt / HMAC）
 *
 * 运行：cd server && pnpm dev（默认 3000 端口）
 * 前端通过 Vite proxy 访问 /api → localhost:3000
 */
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import {
  createUser,
  getUserByUsername,
  listWorkbooks,
  getWorkbook,
  upsertWorkbook,
  renameWorkbook,
  deleteWorkbook,
} from './db.js'
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3000)

/**
 * CORS：
 * - 生产：允许前端域名（CORS_ORIGIN 环境变量，逗号分隔多域名）
 * - 开发：允许所有来源（cors 默认行为）
 */
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(cors(
  allowedOrigins.length > 0
    ? { origin: allowedOrigins }
    : undefined,
))
app.use(express.json({ limit: '10mb' })) // 工作簿 JSON 可能较大，放宽限制

// 请求体校验：非对象直接拒绝
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ───────────────────────────────
// 认证
// ───────────────────────────────

/** POST /api/auth/register — 注册（用户名 + 密码） */
app.post('/api/auth/register', (req, res) => {
  const body = req.body
  if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string') {
    res.status(400).json({ error: 'body 需要 { username: string, password: string }' })
    return
  }
  const username = body.username.trim()
  const password = body.password
  // 基础校验：用户名 3-32 字符，密码至少 6 位
  if (username.length < 3 || username.length > 32) {
    res.status(400).json({ error: '用户名长度需在 3-32 字符之间' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' })
    return
  }
  if (getUserByUsername(username)) {
    res.status(409).json({ error: '用户名已存在' })
    return
  }
  const id = randomUUID()
  createUser(id, username, hashPassword(password))
  res.status(201).json({ ok: true, token: signToken(id, username), username })
})

/** POST /api/auth/login — 登录（返回 JWT） */
app.post('/api/auth/login', (req, res) => {
  const body = req.body
  if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string') {
    res.status(400).json({ error: 'body 需要 { username: string, password: string }' })
    return
  }
  const user = getUserByUsername(body.username.trim())
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    // 统一错误消息，避免暴露"用户名存在"
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }
  res.json({ ok: true, token: signToken(user.id, user.username), username: user.username })
})

/**
 * 鉴权中间件：校验 Authorization: Bearer <token>
 * 成功 → req.user = { id, username }
 */
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录或 token 缺失' })
    return
  }
  const payload = verifyToken(header.slice('Bearer '.length))
  if (!payload) {
    res.status(401).json({ error: 'token 无效或已过期' })
    return
  }
  ;(req as express.Request & { user: { id: string; username: string } }).user = {
    id: payload.sub,
    username: payload.username,
  }
  next()
}

// ───────────────────────────────
// REST API（全部需要登录）
// ───────────────────────────────

/** GET /api/workbooks — 当前用户的工作簿列表（元信息，不含数据） */
app.get('/api/workbooks', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  res.json({ workbooks: listWorkbooks(user.id) })
})

/** POST /api/workbooks — 新建（或覆盖保存）工作簿 */
app.post('/api/workbooks', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  const body = req.body
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.name !== 'string' || typeof body.data !== 'string') {
    res.status(400).json({ error: 'body 需要 { id: string, name: string, data: string }' })
    return
  }
  upsertWorkbook(body.id, user.id, body.name, body.data)
  res.status(201).json({ ok: true, id: body.id })
})

/** GET /api/workbooks/:id — 加载单个工作簿（校验归属） */
app.get('/api/workbooks/:id', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  const row = getWorkbook(req.params.id, user.id)
  if (!row) {
    res.status(404).json({ error: 'workbook not found' })
    return
  }
  res.json({ id: row.id, name: row.name, data: row.data, updatedAt: row.updated_at })
})

/** PUT /api/workbooks/:id — 覆盖保存 */
app.put('/api/workbooks/:id', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  const body = req.body
  if (!isRecord(body) || typeof body.name !== 'string' || typeof body.data !== 'string') {
    res.status(400).json({ error: 'body 需要 { name: string, data: string }' })
    return
  }
  upsertWorkbook(req.params.id, user.id, body.name, body.data)
  res.json({ ok: true, id: req.params.id })
})

/** PATCH /api/workbooks/:id — 仅重命名（不动数据） */
app.patch('/api/workbooks/:id', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  const body = req.body
  if (!isRecord(body) || typeof body.name !== 'string' || body.name.trim() === '') {
    res.status(400).json({ error: 'body 需要 { name: string }（非空）' })
    return
  }
  const renamed = renameWorkbook(req.params.id, user.id, body.name.trim())
  if (!renamed) {
    res.status(404).json({ error: 'workbook not found' })
    return
  }
  res.json({ ok: true, id: req.params.id, name: body.name.trim() })
})

/** DELETE /api/workbooks/:id — 删除 */
app.delete('/api/workbooks/:id', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: { id: string } }).user
  const deleted = deleteWorkbook(req.params.id, user.id)
  if (!deleted) {
    res.status(404).json({ error: 'workbook not found' })
    return
  }
  res.json({ ok: true })
})

// 统一错误兜底（防止未捕获异常导致进程崩溃）
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', err)
  res.status(500).json({ error: 'internal server error' })
})

app.listen(PORT, () => {
  console.log(`[moffice-server] listening on http://localhost:${PORT}`)
})
