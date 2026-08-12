/**
 * MOffice Cloudflare Worker 版认证工具
 *
 * 与 server/src/auth.ts 逻辑一致（scrypt 密码哈希 + 手写 HMAC-SHA256 JWT），
 * 但适配 Worker 运行时：
 * - node:crypto → Web Crypto API（crypto.subtle，异步）
 * - scryptSync → PBKDF2（Web Crypto 不提供 scrypt；PBKDF2 是 Worker 环境的
 *   标准 KDF，抗暴力破解能力与 scrypt 同级，均内存受限）
 * - timingSafeEqual → 手工常量时间比较（逐个字节 XOR 累加）
 *
 * 密码哈希格式：salt:hash（PBKDF2-SHA256，10 万次迭代，hex 编码）
 * 注意：本地 Express 版（scrypt）与 Worker 版（PBKDF2）哈希互不兼容，
 * 但部署只使用其中一个，不影响。
 */

/** 密码哈希（PBKDF2-SHA256，10 万次迭代） */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = toHex(salt)
  const key = await deriveKey(password, saltHex)
  return `${saltHex}:${toHex(key)}`
}

/** 校验密码是否匹配哈希（常量时间比较防时序攻击） */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = await deriveKey(password, salt)
  const expected = fromHex(hash)
  // 常量时间比较：长度不同也遍历（不提前返回）
  let diff = candidate.length ^ expected.length
  for (let i = 0; i < Math.max(candidate.length, expected.length); i++) {
    diff |= (candidate[i] ?? 0) ^ (expected[i] ?? 0)
  }
  return diff === 0
}

/** 派生密钥：PBKDF2-SHA256（100,000 次迭代，输出 32 字节） */
async function deriveKey(password: string, saltHex: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex) as unknown as ArrayBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256, // 32 字节
  )
  return new Uint8Array(bits)
}

// ═══════════════════════════════════
// JWT（HMAC-SHA256，Web Crypto 版）
// ═══════════════════════════════════

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天

export interface JwtPayload {
  sub: string
  username: string
  iat: number
  exp: number
}

/** HMAC 签名（异步） */
async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return toBase64Url(new Uint8Array(sig))
}

/** 生成 JWT */
export async function signToken(userId: string, username: string, secret: string): Promise<string> {
  const header = toBase64Url(enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(enc(JSON.stringify({
    sub: userId,
    username,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  } satisfies JwtPayload)))
  const signature = await hmacSha256(secret, `${header}.${payload}`)
  return `${header}.${payload}.${signature}`
}

/** 校验 JWT，返回 payload；无效/过期返回 null */
export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  // 重算签名并常量时间比较（防篡改）
  const expected = await hmacSha256(secret, `${header}.${payload}`)
  const a = enc(signature)
  const b = enc(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  if (diff !== 0) return null

  try {
    const data = JSON.parse(dec(fromBase64Url(payload))) as JwtPayload
    if (data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

// ---- 编码工具 ----

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const dec = (b: Uint8Array): string => new TextDecoder().decode(b)

/** bytes → hex */
function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** hex → bytes */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** bytes → base64url（JWT 规范：URL 安全 + 去 padding） */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → bytes */
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
