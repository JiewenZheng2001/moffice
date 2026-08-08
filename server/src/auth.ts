/**
 * 认证工具 —— 密码哈希（scrypt）+ JWT（手写 HMAC-SHA256）
 *
 * 为什么手写 JWT 而非 jsonwebtoken 库：
 * 1. 项目原则：核心机制手写（这里 JWT 结构是经典面试题：header.payload.signature）
 * 2. 零依赖：Node 内置 crypto 足够实现
 * 3. 演示项目规模下安全性足够（HMAC-SHA256 + 过期校验）
 *
 * JWT 结构：
 *   base64url(header).base64url(payload).base64url(HMAC_SHA256(signature 输入))
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ═══════════════════════════════════
// 密码哈希（scrypt）
// ═══════════════════════════════════

/**
 * 生成密码哈希（格式：salt:hash，hex 编码）
 * scrypt 是内存密集型 KDF，抗 GPU 暴力破解，Node 内置无需额外依赖
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/** 校验密码是否匹配哈希（timingSafeEqual 防时序攻击） */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  // 长度不同时 timingSafeEqual 会抛错，先比较长度再比较内容
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

// ═══════════════════════════════════
// JWT（HMAC-SHA256）
// ═══════════════════════════════════

/**
 * JWT 密钥：优先环境变量，否则持久化到 data/jwt-secret 文件。
 * 注意：绝不能每次启动随机生成 —— dev 模式 tsx watch 重启后
 * 所有已签发 token 会立刻失效，用户必须重新登录。
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SECRET_PATH = join(__dirname, '..', 'data', 'jwt-secret')

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (existsSync(SECRET_PATH)) {
    return readFileSync(SECRET_PATH, 'utf8').trim()
  }
  // 首次运行：生成并持久化
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dirname(SECRET_PATH), { recursive: true })
  writeFileSync(SECRET_PATH, secret, { mode: 0o600 })
  return secret
}

const JWT_SECRET = loadSecret()
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天

interface JwtPayload {
  sub: string        // 用户 id
  username: string
  iat: number        // 签发时间（秒）
  exp: number        // 过期时间（秒）
}

/** base64url 编码（JWT 规范：URL 安全 + 去 padding） */
function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/** 生成 JWT */
export function signToken(userId: string, username: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({
    sub: userId,
    username,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  } satisfies JwtPayload))
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

/** 校验 JWT，返回 payload；无效/过期返回 null */
export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  // 重算签名并安全比较（防篡改）
  const expected = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtPayload
    // 过期校验
    if (data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}
