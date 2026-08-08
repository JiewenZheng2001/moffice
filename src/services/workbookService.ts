import type { Workbook } from '@/model/types'
import { deserializeWorkbook, serializeWorkbook } from '@/model/serialization'
import { getToken } from './authService'

/**
 * 工作簿持久化服务 —— 与后端 REST API 通信
 *
 * 设计：整个 Workbook 序列化为一个 JSON 字符串存储（后端按快照保存）
 * - saveWorkbook(): 全量保存（新建或覆盖）
 * - loadWorkbook(): 按 id 加载
 * - listWorkbooks(): 获取元信息列表（不含数据）
 * - deleteWorkbook(): 删除
 */

/** 后端返回的工作簿元信息 */
export interface WorkbookMeta {
  id: string
  name: string
  updated_at: string
}

/** 后端返回的完整工作簿 */
export interface WorkbookDTO {
  id: string
  name: string
  data: string
  updatedAt: string
}

/** 统一错误：包含 HTTP 状态码 */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 请求封装：自动附加 token，统一处理错误与 JSON 解析 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      headers: {
        'Content-Type': 'application/json',
        // 已登录则附加 JWT（后端 requireAuth 校验）
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      ...init,
    })
  } catch {
    // 后端未启动 / 网络错误
    throw new ApiError(0, '无法连接服务器，请确认后端已启动 (cd server && pnpm dev)')
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) msg = body.error
    } catch { /* 非 JSON 响应，保留默认消息 */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

/** 获取工作簿列表（元信息） */
export function listWorkbooks(): Promise<{ workbooks: WorkbookMeta[] }> {
  return request('/workbooks')
}

/** 按 id 加载工作簿 */
export async function loadWorkbook(id: string): Promise<Workbook> {
  const dto = await request<WorkbookDTO>(`/workbooks/${id}`)
  try {
    // 反序列化：还原 cells/columnWidths/rowHeights 等 Map 字段
    return deserializeWorkbook(dto.data)
  } catch {
    throw new ApiError(0, '工作簿数据损坏，无法解析')
  }
}

/** 保存工作簿（新建或覆盖，整体快照） */
export function saveWorkbook(workbook: Workbook): Promise<{ ok: boolean }> {
  return request('/workbooks', {
    method: 'POST',
    body: JSON.stringify({
      id: workbook.id,
      name: workbook.name,
      // 序列化时把 Map 字段转为普通对象（JSON 无法直接存 Map）
      data: serializeWorkbook(workbook),
    }),
  })
}

/** 删除工作簿 */
export function deleteWorkbook(id: string): Promise<{ ok: boolean }> {
  return request(`/workbooks/${id}`, { method: 'DELETE' })
}

/** 重命名工作簿（仅改名字，不动数据） */
export function renameWorkbook(id: string, name: string): Promise<{ ok: boolean }> {
  return request(`/workbooks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}
