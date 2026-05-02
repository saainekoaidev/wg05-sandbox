import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { auth } from './auth.js'
import { prisma } from './db.js'

const BASE = 'http://localhost:3000'
const SIGN_UP_URL = `${BASE}/api/auth/sign-up/email`
const SIGN_IN_URL = `${BASE}/api/auth/sign-in/email`
const SESSION_URL = `${BASE}/api/auth/get-session`

async function signUp(email: string, password: string, name = 'Test User') {
  return auth.handler(
    new Request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  )
}

async function signIn(email: string, password: string) {
  return auth.handler(
    new Request(SIGN_IN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  )
}

async function getSession(cookieHeader?: string) {
  const headers: Record<string, string> = {}
  if (cookieHeader) headers.cookie = cookieHeader
  return auth.handler(
    new Request(SESSION_URL, { method: 'GET', headers }),
  )
}

/**
 * Set-Cookie ヘッダから Cookie ヘッダ向けの "name=value; ..." 文字列を組み立てる。
 * 複数 Cookie に対応するため getSetCookie() を優先利用する。
 */
function buildCookieHeader(res: Response): string {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/)
  return list
    .filter(Boolean)
    .map((sc) => sc.split(';')[0])
    .join('; ')
}

beforeEach(async () => {
  // User 削除で Session / Account / Route / RouteSegment が CASCADE で消える。
  // それ以外のマスタ系も明示削除して状態をリセットする。
  await prisma.user.deleteMany()
  await prisma.verification.deleteMany()
  await prisma.stationLine.deleteMany()
  await prisma.station.deleteMany()
  await prisma.line.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/auth/sign-in/email (US-002 ログインAPI)', () => {
  it('正しい認証情報でログインに成功し 200 + user/token + Set-Cookie を返す', async () => {
    await signUp('test@example.com', 'Test1234')

    const res = await signIn('test@example.com', 'Test1234')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('token')
    expect(body.user).toMatchObject({ email: 'test@example.com' })

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie?.toLowerCase()).toMatch(/session/)
    expect(setCookie?.toLowerCase()).toContain('httponly')
  })

  it('パスワード不一致では 401 / INVALID_EMAIL_OR_PASSWORD を返す', async () => {
    await signUp('test@example.com', 'Test1234')

    const res = await signIn('test@example.com', 'WrongPwd')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('未登録メールアドレスでも 401 / INVALID_EMAIL_OR_PASSWORD を返す (情報漏洩防止)', async () => {
    const res = await signIn('unknown@example.com', 'AnyPass')

    expect(res.status).toBe(401)
    const body = await res.json()
    // 「ユーザ未登録」と「パスワード不一致」を区別しない
    expect(body.code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('メールアドレス未入力では 4xx を返し、認証は試みない', async () => {
    const res = await signIn('', 'Test1234')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('パスワード未入力では 4xx を返し、認証は試みない', async () => {
    const res = await signIn('test@example.com', '')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('JSON 以外のリクエストボディでは 4xx を返す', async () => {
    const res = await auth.handler(
      new Request(SIGN_IN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not-json',
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('ログイン成功で Session レコードが追加で作成される (有効期限 > 現在時刻)', async () => {
    // better-auth は sign-up 時にも自動で Session を発行するため、
    // sign-in 単体での増分を検証する。
    await signUp('test@example.com', 'Test1234')
    const before = await prisma.session.count()

    const signInRes = await signIn('test@example.com', 'Test1234')
    const body = await signInRes.json()
    const after = await prisma.session.count()

    expect(after).toBe(before + 1)

    const session = await prisma.session.findFirst({
      where: { token: body.token },
      include: { user: true },
    })
    expect(session).not.toBeNull()
    expect(session!.user.email).toBe('test@example.com')
    expect(session!.expiresAt).toBeInstanceOf(Date)
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(session!.token).toBeTruthy()
  })

  it('Account.password はハッシュ化されており平文が漏れない', async () => {
    await signUp('test@example.com', 'Test1234')

    const account = await prisma.account.findFirst()
    expect(account?.providerId).toBe('credential')
    expect(account?.password).toBeTruthy()
    expect(account?.password).not.toBe('Test1234')
    expect(account?.password).not.toContain('Test1234')
    // ハッシュは十分な長さを持つ (bcrypt等を想定)
    expect(account!.password!.length).toBeGreaterThan(20)
  })

  it('連続ログインのたびに新しい Session が増える', async () => {
    await signUp('test@example.com', 'Test1234')
    const before = await prisma.session.count()

    await signIn('test@example.com', 'Test1234')
    await signIn('test@example.com', 'Test1234')
    await signIn('test@example.com', 'Test1234')

    const after = await prisma.session.count()
    expect(after).toBe(before + 3)
  })
})

describe('GET /api/auth/get-session (ログイン後のセッション復元)', () => {
  it('ログインで得た Cookie をそのまま渡すと自分の user/session を返す', async () => {
    await signUp('test@example.com', 'Test1234')
    const signInRes = await signIn('test@example.com', 'Test1234')
    const cookie = buildCookieHeader(signInRes)
    expect(cookie).toBeTruthy()

    const res = await getSession(cookie)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toMatchObject({ email: 'test@example.com' })
    expect(body.session).toHaveProperty('token')
  })

  it('Cookie なしの GET /get-session は未認証 (null) を返す', async () => {
    const res = await getSession()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBeNull()
  })

  it('無効な Cookie 値での GET /get-session も未認証 (null) を返す', async () => {
    const res = await getSession('better-auth.session_token=this-is-not-valid')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBeNull()
  })
})
