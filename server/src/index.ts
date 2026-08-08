/**
 * MOffice 后端服务
 *
 * 职责：工作簿的保存 / 加载 / 列表 / 删除（REST API）
 * 技术栈：Express + node:sqlite（内置，零原生依赖）
 *
 * 运行：cd server && pnpm dev（默认 3000 端口）
 * 前端通过 Vite proxy 访问 /api → localhost:3000
 */
import express from 'express'
import cors from 'cors'
import {
  listWorkbooks,
  getWorkbook,
  upsertWorkbook,
  renameWorkbook,
  deleteWorkbook,
} from './db.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3000)

app.use(cors())
app.use(express.json({ limit: '10mb' })) // 工作簿 JSON 可能较大，放宽限制

// 请求体校验：非对象直接拒绝
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ───────────────────────────────
// REST API
// ───────────────────────────────

/** GET /api/workbooks — 工作簿列表（元信息，不含数据） */
app.get('/api/workbooks', (_req, res) => {
  res.json({ workbooks: listWorkbooks() })
})

/** POST /api/workbooks — 新建（或覆盖保存）工作簿 */
app.post('/api/workbooks', (req, res) => {
  const body = req.body
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.name !== 'string' || typeof body.data !== 'string') {
    res.status(400).json({ error: 'body 需要 { id: string, name: string, data: string }' })
    return
  }
  upsertWorkbook(body.id, body.name, body.data)
  res.status(201).json({ ok: true, id: body.id })
})

/** GET /api/workbooks/:id — 加载单个工作簿 */
app.get('/api/workbooks/:id', (req, res) => {
  const row = getWorkbook(req.params.id)
  if (!row) {
    res.status(404).json({ error: 'workbook not found' })
    return
  }
  res.json({ id: row.id, name: row.name, data: row.data, updatedAt: row.updated_at })
})

/** PUT /api/workbooks/:id — 覆盖保存 */
app.put('/api/workbooks/:id', (req, res) => {
  const body = req.body
  if (!isRecord(body) || typeof body.name !== 'string' || typeof body.data !== 'string') {
    res.status(400).json({ error: 'body 需要 { name: string, data: string }' })
    return
  }
  upsertWorkbook(req.params.id, body.name, body.data)
  res.json({ ok: true, id: req.params.id })
})

/** PATCH /api/workbooks/:id — 仅重命名（不动数据） */
app.patch('/api/workbooks/:id', (req, res) => {
  const body = req.body
  if (!isRecord(body) || typeof body.name !== 'string' || body.name.trim() === '') {
    res.status(400).json({ error: 'body 需要 { name: string }（非空）' })
    return
  }
  const renamed = renameWorkbook(req.params.id, body.name.trim())
  if (!renamed) {
    res.status(404).json({ error: 'workbook not found' })
    return
  }
  res.json({ ok: true, id: req.params.id, name: body.name.trim() })
})

/** DELETE /api/workbooks/:id — 删除 */
app.delete('/api/workbooks/:id', (req, res) => {
  const deleted = deleteWorkbook(req.params.id)
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
