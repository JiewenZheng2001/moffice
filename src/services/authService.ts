/**
 * 认证服务 —— 注册 / 登录 / token 管理
 *
 * token 存储：localStorage（演示项目；生产可用 httpOnly cookie）
 * 所有需要鉴权的请求由 workbookService 自动附加 Authorization 头
 */

const TOKEN_KEY = 'moffice_token'
const USERNAME_KEY = 'moffice_username'

export interface AuthResult {
  ok: boolean
  token: string
  username: string
}

export class AuthError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/** API 基地址（与 workbookService 一致）：开发走 proxy，生产由 VITE_API_BASE 注入 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/** 发起认证请求（register / login 共用） */
async function authRequest(path: string, username: string, password: string): Promise<AuthResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new AuthError(0, '无法连接服务器，请确认后端已启动 (cd server && pnpm dev)')
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) msg = body.error
    } catch { /* ignore */ }
    throw new AuthError(res.status, msg)
  }
  return res.json() as Promise<AuthResult>
}

// ---- 登录态管理 ----

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

/** 登录成功后保存 token + 用户名 */
function persistAuth(result: AuthResult): void {
  localStorage.setItem(TOKEN_KEY, result.token)
  localStorage.setItem(USERNAME_KEY, result.username)
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

/** 注册（成功后自动登录） */
export async function register(username: string, password: string): Promise<AuthResult> {
  const result = await authRequest('/register', username, password)
  persistAuth(result)
  return result
}

/** 登录 */
export async function login(username: string, password: string): Promise<AuthResult> {
  const result = await authRequest('/login', username, password)
  persistAuth(result)
  return result
}
