/**
 * MOffice Cloudflare Worker 后端入口
 *
 * 与 server/src/index.ts 的 API 完全一致（前端零改动）：
 *   POST   /api/auth/register   注册
 *   POST   /api/auth/login      登录
 *   GET    /api/workbooks       工作簿列表
 *   POST   /api/workbooks       保存/覆盖
 *   GET    /api/workbooks/:id   加载
 *   PATCH  /api/workbooks/:id   重命名
 *   DELETE /api/workbooks/:id   删除
 *
 * 技术栈：Hono（轻量 Worker 框架）+ D1（SQLite 兼容）+ Web Crypto
 *
 * 环境变量（wrangler.toml / Dashboard 配置）：
 *   JWT_SECRET  必填，随机长字符串
 *   CORS_ORIGIN 前端域名（逗号分隔），不设则全放开（开发）
 */
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import {
  createUser,
  getUserByUsername,
  listWorkbooks,
  getWorkbook,
  upsertWorkbook,
  renameWorkbook,
  deleteWorkbook,
} from './db'
import { hashPassword, verifyPassword, signToken, verifyToken, type JwtPayload } from './auth'

/** Worker 环境类型（D1 binding + 环境变量） */
export interface Env {
  DB: D1Database
  JWT_SECRET: string
  CORS_ORIGIN?: string
}

/** 带用户信息的请求上下文 */
type AppEnv = {
  Bindings: Env
  Variables: {
    user?: { id: string; username: string }
  }
}

const app = new Hono<AppEnv>()

// CORS：允许前端域名（逗号分隔）；不设则全放开（开发）
app.use('*', cors({
  origin: (origin, c) => {
    const env = c.env as unknown as Env
    const allowed = (env.CORS_ORIGIN ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
    if (allowed.length === 0) return origin ?? '*'
    return allowed.includes(origin ?? '') ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// 请求体校验：非对象直接拒绝
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 读取请求体 JSON（失败返回 null） */
async function readBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

/** 路由参数（Hono v4 类型为 string | undefined，但路由匹配后必存在） */
function param(c: Context<AppEnv>, name: string): string {
  return c.req.param(name) ?? ''
}

// ───────────────────────────────
// 认证
// ───────────────────────────────

/** POST /api/auth/register — 注册（用户名 + 密码） */
app.post('/api/auth/register', async (c) => {
  const body = await readBody(c)
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return c.json({ error: 'body 需要 { username: string, password: string }' }, 400)
  }
  const username = body.username.trim()
  const password = body.password
  if (username.length < 3 || username.length > 32) {
    return c.json({ error: '用户名长度需在 3-32 字符之间' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: '密码至少 6 位' }, 400)
  }
  if (await getUserByUsername(c.env.DB, username)) {
    return c.json({ error: '用户名已存在' }, 409)
  }
  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  await createUser(c.env.DB, id, username, passwordHash)
  const token = await signToken(id, username, c.env.JWT_SECRET)
  return c.json({ ok: true, token, username }, 201)
})

/** POST /api/auth/login — 登录（返回 JWT） */
app.post('/api/auth/login', async (c) => {
  const body = await readBody(c)
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return c.json({ error: 'body 需要 { username: string, password: string }' }, 400)
  }
  const user = await getUserByUsername(c.env.DB, body.username.trim())
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: '用户名或密码错误' }, 401)
  }
  const token = await signToken(user.id, user.username, c.env.JWT_SECRET)
  return c.json({ ok: true, token, username: user.username })
})

/**
 * 鉴权中间件：校验 Authorization: Bearer <token>
 * 成功 → c.set('user', { id, username })
 */
async function requireAuth(c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void> {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: '未登录或 token 缺失' }, 401)
  }
  const payload = await verifyToken(header.slice('Bearer '.length), c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'token 无效或已过期' }, 401)
  }
  c.set('user', { id: payload.sub, username: payload.username })
  await next()
}

// ───────────────────────────────
// REST API（全部需要登录）
// ───────────────────────────────

/** GET /api/workbooks — 当前用户的工作簿列表 */
app.get('/api/workbooks', requireAuth, async (c) => {
  const user = c.get('user')!
  const workbooks = await listWorkbooks(c.env.DB, user.id)
  return c.json({ workbooks })
})

/** POST /api/workbooks — 新建（或覆盖保存）工作簿 */
app.post('/api/workbooks', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await readBody(c)
  if (!body || typeof body.id !== 'string' || typeof body.name !== 'string' || typeof body.data !== 'string') {
    return c.json({ error: 'body 需要 { id: string, name: string, data: string }' }, 400)
  }
  await upsertWorkbook(c.env.DB, body.id, user.id, body.name, body.data)
  return c.json({ ok: true, id: body.id }, 201)
})

/** GET /api/workbooks/:id — 加载单个工作簿（校验归属） */
app.get('/api/workbooks/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = param(c, 'id')
  const row = await getWorkbook(c.env.DB, id, user.id)
  if (!row) {
    return c.json({ error: 'workbook not found' }, 404)
  }
  return c.json({ id: row.id, name: row.name, data: row.data, updatedAt: row.updated_at })
})

/** PUT /api/workbooks/:id — 覆盖保存 */
app.put('/api/workbooks/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await readBody(c)
  if (!body || typeof body.name !== 'string' || typeof body.data !== 'string') {
    return c.json({ error: 'body 需要 { name: string, data: string }' }, 400)
  }
  const id = param(c, 'id')
  await upsertWorkbook(c.env.DB, id, user.id, body.name, body.data)
  return c.json({ ok: true, id })
})

/** PATCH /api/workbooks/:id — 仅重命名 */
app.patch('/api/workbooks/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await readBody(c)
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'body 需要 { name: string }（非空）' }, 400)
  }
  const id = param(c, 'id')
  const renamed = await renameWorkbook(c.env.DB, id, user.id, body.name.trim())
  if (!renamed) {
    return c.json({ error: 'workbook not found' }, 404)
  }
  return c.json({ ok: true, id, name: body.name.trim() })
})

/** DELETE /api/workbooks/:id — 删除 */
app.delete('/api/workbooks/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = param(c, 'id')
  const deleted = await deleteWorkbook(c.env.DB, id, user.id)
  if (!deleted) {
    return c.json({ error: 'workbook not found' }, 404)
  }
  return c.json({ ok: true })
})

// 兜底：404
app.notFound((c) => c.json({ error: 'not found' }, 404))

// 错误兜底
app.onError((err, c) => {
  console.error('[moffice-worker] error:', err)
  return c.json({ error: 'internal server error' }, 500)
})

export default app
