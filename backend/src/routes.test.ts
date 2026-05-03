import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { app } from './app.js'
import { auth } from './auth.js'
import { prisma } from './db.js'

// ---------------------------------------------------------------------------
// 共通ヘルパ
// ---------------------------------------------------------------------------

const SIGN_UP_URL = 'http://localhost:3000/api/auth/sign-up/email'

async function signUp(email: string, password: string, name = 'Test User') {
  return auth.handler(
    new Request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  )
}

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

async function signUpAndGetCookie(
  email: string,
  password: string,
  name?: string,
): Promise<string> {
  const res = await signUp(email, password, name)
  return buildCookieHeader(res)
}

async function postRoutes(cookie: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/routes', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function getRoutes(cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/routes', { method: 'GET', headers }),
  )
}

async function getRouteById(cookie: string | null, id: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/routes/${id}`, { method: 'GET', headers }),
  )
}

async function deleteRouteById(
  cookie: string | null,
  id: string,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/routes/${id}`, {
      method: 'DELETE',
      headers,
    }),
  )
}

async function putRouteById(
  cookie: string | null,
  id: string,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/routes/${id}`, {
      method: 'PUT',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function createOneRoute(cookie: string, name = 'Test Route'): Promise<string> {
  const res = await postRoutes(cookie, {
    name,
    segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
  })
  if (res.status !== 201) {
    throw new Error(`postRoutes failed: ${res.status}`)
  }
  const body = (await res.json()) as { id: string }
  return body.id
}

async function getStations(cookie: string | null, query: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  const url = `http://localhost/api/stations${query ? `?${query}` : ''}`
  return app.fetch(new Request(url, { method: 'GET', headers }))
}

/**
 * マスタが必要なテストでだけ呼ぶ最小限の路線/駅 fixture。
 * seed.ts は 2026-05-03 にいったん空化したため、各テストが必要な分だけ生成する。
 * docs/adr/0005-master-data-source.md / 0006-master-admin.md の方針に揃える。
 */
async function setupMasterFixture() {
  await prisma.line.createMany({
    data: [
      { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
      { id: 'metro-ginza', name: '東京メトロ銀座線', kind: 'subway', operator: '東京メトロ' },
      { id: 'toei-bus-01', name: '都営バス01系統', kind: 'bus', operator: '東京都交通局' },
    ],
  })
  await prisma.station.createMany({
    data: [
      { id: 'stn-shibuya', name: '渋谷', kana: 'しぶや' },
      { id: 'stn-kanda', name: '神田', kana: 'かんだ' },
      { id: 'bus-shibuya-ekimae', name: '都営バス 渋谷駅前', kana: 'しぶやえきまえ' },
    ],
  })
  await prisma.stationLine.createMany({
    data: [
      { stationId: 'stn-shibuya', lineId: 'jr-yamanote' },
      { stationId: 'stn-shibuya', lineId: 'metro-ginza' },
      { stationId: 'stn-kanda', lineId: 'jr-yamanote' },
      { stationId: 'stn-kanda', lineId: 'metro-ginza' },
      { stationId: 'bus-shibuya-ekimae', lineId: 'toei-bus-01' },
    ],
  })
}

beforeEach(async () => {
  // User 削除で Session/Account/Route/RouteSegment が CASCADE。
  // マスタ (Line/Station/StationLine) は seed を空に倒したため毎回ゼロから作り直す。
  // RouteSegment.lineId は onDelete: SetNull なので Route 側を先に消した後で Line を消す。
  await prisma.user.deleteMany()
  await prisma.verification.deleteMany()
  await prisma.stationLine.deleteMany()
  await prisma.station.deleteMany()
  await prisma.line.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// POST /api/routes
// ---------------------------------------------------------------------------

describe('POST /api/routes (US-003 経路登録)', () => {
  it('未認証では 401', async () => {
    const res = await postRoutes(null, {
      segments: [
        { kind: 'train', fromStation: '渋谷', toStation: '神田', fare: 200 },
      ],
    })
    expect(res.status).toBe(401)
  })

  it('JSON 不正なら 400 (invalid_json)', async () => {
    const cookie = await signUpAndGetCookie('user1@example.com', 'Test1234')
    const res = await postRoutes(cookie, 'not-json')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('zod 検証 NG (segments 空配列) で 400 (validation_failed)', async () => {
    const cookie = await signUpAndGetCookie('user2@example.com', 'Test1234')
    const res = await postRoutes(cookie, { name: 'X', segments: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation_failed')
  })

  it('zod 検証 NG (kind が enum 外) で 400', async () => {
    const cookie = await signUpAndGetCookie('user3@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      segments: [
        { kind: 'spaceship', fromStation: 'A', toStation: 'B', fare: 100 },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('zod 検証 NG (fare = 0) で 400', async () => {
    const cookie = await signUpAndGetCookie('user4@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 0 }],
    })
    expect(res.status).toBe(400)
  })

  it('正常 1 区間で 201, fromStation/toStation が segments 端点と一致 (派生算出)', async () => {
    await setupMasterFixture()
    const cookie = await signUpAndGetCookie('user5@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      name: '平日通勤',
      segments: [
        {
          kind: 'train',
          lineId: 'jr-yamanote',
          fromStation: '渋谷',
          toStation: '神田',
          fare: 200,
        },
      ],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('平日通勤')
    expect(body.fromStation).toBe('渋谷')
    expect(body.toStation).toBe('神田')
    expect(body.segments).toHaveLength(1)
    expect(body.segments[0]).toMatchObject({
      orderIndex: 1,
      kind: 'train',
      lineId: 'jr-yamanote',
      fromStation: '渋谷',
      toStation: '神田',
      fare: 200,
    })
  })

  it('複数区間で fromStation = 1区間目出発、toStation = 最終区間到着 (orderIndex 採番も)', async () => {
    await setupMasterFixture()
    const cookie = await signUpAndGetCookie('user6@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      segments: [
        {
          kind: 'train',
          lineId: 'jr-yamanote',
          fromStation: '渋谷',
          toStation: '表参道',
          fare: 160,
        },
        {
          kind: 'subway',
          lineId: 'metro-ginza',
          fromStation: '表参道',
          toStation: '神田',
          fare: 160,
        },
      ],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.fromStation).toBe('渋谷')
    expect(body.toStation).toBe('神田')
    expect(body.segments).toHaveLength(2)
    expect(body.segments[0].orderIndex).toBe(1)
    expect(body.segments[1].orderIndex).toBe(2)
  })

  it('クライアントが Route.fromStation/toStation を直接送ってもサーバ側で再計算され無視される', async () => {
    const cookie = await signUpAndGetCookie('user7@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      // 派生フィールドを偽装
      fromStation: 'INVALID',
      toStation: 'INVALID',
      segments: [
        { kind: 'train', fromStation: '池袋', toStation: '東京', fare: 200 },
      ],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.fromStation).toBe('池袋')
    expect(body.toStation).toBe('東京')
  })

  it('11 区間は zod max(10) で 400', async () => {
    const cookie = await signUpAndGetCookie('user8@example.com', 'Test1234')
    const segments = Array.from({ length: 11 }, (_, i) => ({
      kind: 'train',
      fromStation: `S${i}`,
      toStation: `S${i + 1}`,
      fare: 100,
    }))
    const res = await postRoutes(cookie, { segments })
    expect(res.status).toBe(400)
  })

  it('lineId に存在しない値を送ると FK 制約違反でエラーになる', async () => {
    const cookie = await signUpAndGetCookie('user9@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      segments: [
        {
          kind: 'train',
          lineId: 'nonexistent-line-id',
          fromStation: 'A',
          toStation: 'B',
          fare: 100,
        },
      ],
    })
    // Prisma FK 違反は 5xx もしくは 4xx (実装次第)。少なくとも成功 (201) ではないことを確認
    expect(res.status).not.toBe(201)
  })

  it('lineId なし (null) でも保存できる (「(未選択)」相当)', async () => {
    const cookie = await signUpAndGetCookie('user10@example.com', 'Test1234')
    const res = await postRoutes(cookie, {
      segments: [
        { kind: 'train', fromStation: '渋谷', toStation: '神田', fare: 200 },
      ],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.segments[0].lineId).toBeNull()
  })

  it('保存した経路は呼出元ユーザの userId に紐づく (オーナー分離)', async () => {
    const cookieA = await signUpAndGetCookie(
      'alice@example.com',
      'Test1234',
      'Alice',
    )
    const cookieB = await signUpAndGetCookie(
      'bob@example.com',
      'Test1234',
      'Bob',
    )

    await postRoutes(cookieA, {
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    await postRoutes(cookieB, {
      segments: [{ kind: 'train', fromStation: 'C', toStation: 'D', fare: 100 }],
    })

    const alice = await prisma.user.findUnique({
      where: { email: 'alice@example.com' },
    })
    const bob = await prisma.user.findUnique({
      where: { email: 'bob@example.com' },
    })
    const aliceRoutes = await prisma.route.findMany({
      where: { userId: alice!.id },
    })
    const bobRoutes = await prisma.route.findMany({
      where: { userId: bob!.id },
    })

    expect(aliceRoutes).toHaveLength(1)
    expect(aliceRoutes[0]!.fromStation).toBe('A')
    expect(bobRoutes).toHaveLength(1)
    expect(bobRoutes[0]!.fromStation).toBe('C')
  })
})

// ---------------------------------------------------------------------------
// GET /api/routes (US-004 経路一覧)
// ---------------------------------------------------------------------------

describe('GET /api/routes (US-004 経路一覧)', () => {
  it('未認証では 401', async () => {
    const res = await getRoutes(null)
    expect(res.status).toBe(401)
  })

  it('未登録ユーザは空配列を返す (200, routes=[])', async () => {
    const cookie = await signUpAndGetCookie('list1@example.com', 'Test1234')
    const res = await getRoutes(cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ routes: [] })
  })

  it('呼出元ユーザの経路のみ返り、他ユーザの経路は混入しない (オーナー分離)', async () => {
    const cookieA = await signUpAndGetCookie(
      'alice2@example.com',
      'Test1234',
      'Alice',
    )
    const cookieB = await signUpAndGetCookie(
      'bob2@example.com',
      'Test1234',
      'Bob',
    )

    await postRoutes(cookieA, {
      name: 'Alice 通勤',
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    await postRoutes(cookieB, {
      name: 'Bob 通勤',
      segments: [{ kind: 'train', fromStation: 'C', toStation: 'D', fare: 200 }],
    })

    const aliceRes = await getRoutes(cookieA)
    const aliceBody = await aliceRes.json()
    expect(aliceBody.routes).toHaveLength(1)
    expect(aliceBody.routes[0].name).toBe('Alice 通勤')

    const bobRes = await getRoutes(cookieB)
    const bobBody = await bobRes.json()
    expect(bobBody.routes).toHaveLength(1)
    expect(bobBody.routes[0].name).toBe('Bob 通勤')
  })

  it('updatedAt DESC で並ぶ (新しく作った経路が先頭)', async () => {
    const cookie = await signUpAndGetCookie('list2@example.com', 'Test1234')

    // 順次作成 (Prisma の @updatedAt は作成時にも入る)
    await postRoutes(cookie, {
      name: 'oldest',
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    // SQLite の DateTime 解像度が低いケースに備え僅かに待つ
    await new Promise((r) => setTimeout(r, 10))
    await postRoutes(cookie, {
      name: 'middle',
      segments: [{ kind: 'train', fromStation: 'C', toStation: 'D', fare: 200 }],
    })
    await new Promise((r) => setTimeout(r, 10))
    await postRoutes(cookie, {
      name: 'newest',
      segments: [{ kind: 'train', fromStation: 'E', toStation: 'F', fare: 300 }],
    })

    const res = await getRoutes(cookie)
    const body = await res.json()
    expect(body.routes.map((r: { name: string }) => r.name)).toEqual([
      'newest',
      'middle',
      'oldest',
    ])
  })

  it('各経路に segments が orderIndex 昇順で同梱される', async () => {
    await setupMasterFixture()
    const cookie = await signUpAndGetCookie('list3@example.com', 'Test1234')
    await postRoutes(cookie, {
      name: 'multi',
      segments: [
        { kind: 'train', fromStation: '渋谷', toStation: '表参道', fare: 160 },
        {
          kind: 'subway',
          lineId: 'metro-ginza',
          fromStation: '表参道',
          toStation: '神田',
          fare: 160,
        },
      ],
    })

    const res = await getRoutes(cookie)
    const body = await res.json()
    expect(body.routes).toHaveLength(1)
    const route = body.routes[0]
    expect(route.segments).toHaveLength(2)
    expect(route.segments[0].orderIndex).toBe(1)
    expect(route.segments[1].orderIndex).toBe(2)
    expect(route.segments[0].fromStation).toBe('渋谷')
    expect(route.segments[1].toStation).toBe('神田')
    expect(route.fromStation).toBe('渋谷')
    expect(route.toStation).toBe('神田')
  })

  it('期待されるフィールド (id / name / fromStation / toStation / createdAt / updatedAt / segments) が揃う', async () => {
    const cookie = await signUpAndGetCookie('list4@example.com', 'Test1234')
    await postRoutes(cookie, {
      name: 'shape-test',
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })

    const res = await getRoutes(cookie)
    const body = await res.json()
    const route = body.routes[0]
    expect(route).toHaveProperty('id')
    expect(route).toHaveProperty('name', 'shape-test')
    expect(route).toHaveProperty('fromStation', 'A')
    expect(route).toHaveProperty('toStation', 'B')
    expect(route).toHaveProperty('createdAt')
    expect(route).toHaveProperty('updatedAt')
    expect(Array.isArray(route.segments)).toBe(true)
    expect(route.segments[0]).toMatchObject({
      kind: 'train',
      lineId: null,
      fromStation: 'A',
      toStation: 'B',
      fare: 100,
      orderIndex: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// GET /api/routes/:id (US-005 経路詳細)
// ---------------------------------------------------------------------------

describe('GET /api/routes/:id (US-005 経路詳細)', () => {
  it('未認証では 401', async () => {
    const res = await getRouteById(null, 'any-id')
    expect(res.status).toBe(401)
  })

  it('存在しない id では 404 (not_found)', async () => {
    const cookie = await signUpAndGetCookie('detail1@example.com', 'Test1234')
    const res = await getRouteById(cookie, 'nonexistent-id-xyz')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('自分の経路は 200 で取得でき、segments を含む', async () => {
    const cookie = await signUpAndGetCookie('detail2@example.com', 'Test1234')
    const id = await createOneRoute(cookie, 'detail-target')

    const res = await getRouteById(cookie, id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.name).toBe('detail-target')
    expect(body.fromStation).toBe('A')
    expect(body.toStation).toBe('B')
    expect(Array.isArray(body.segments)).toBe(true)
    expect(body.segments).toHaveLength(1)
    expect(body.segments[0].orderIndex).toBe(1)
  })

  it('他人の経路は 403 (forbidden) で内容を返さない', async () => {
    const cookieA = await signUpAndGetCookie(
      'alice3@example.com',
      'Test1234',
      'Alice',
    )
    const cookieB = await signUpAndGetCookie('bob3@example.com', 'Test1234', 'Bob')
    const aliceRouteId = await createOneRoute(cookieA, 'alice-private')

    const res = await getRouteById(cookieB, aliceRouteId)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/routes/:id (US-005 経路削除)
// ---------------------------------------------------------------------------

describe('DELETE /api/routes/:id (US-005 経路削除)', () => {
  it('未認証では 401', async () => {
    const res = await deleteRouteById(null, 'any-id')
    expect(res.status).toBe(401)
  })

  it('存在しない id では 404 (not_found)', async () => {
    const cookie = await signUpAndGetCookie('del1@example.com', 'Test1234')
    const res = await deleteRouteById(cookie, 'nonexistent-id-xyz')
    expect(res.status).toBe(404)
  })

  it('自分の経路の削除は 200 で成功し、Route と RouteSegment が CASCADE で消える', async () => {
    const cookie = await signUpAndGetCookie('del2@example.com', 'Test1234')
    const id = await createOneRoute(cookie, 'to-be-deleted')

    const beforeRoutes = await prisma.route.count()
    const beforeSegs = await prisma.routeSegment.count()

    const res = await deleteRouteById(cookie, id)
    expect(res.status).toBe(200)

    const afterRoutes = await prisma.route.count()
    const afterSegs = await prisma.routeSegment.count()
    expect(afterRoutes).toBe(beforeRoutes - 1)
    expect(afterSegs).toBe(beforeSegs - 1)

    // 再取得は 404
    const get = await getRouteById(cookie, id)
    expect(get.status).toBe(404)
  })

  it('他人の経路の削除は 403 で阻止される (DB は変化しない)', async () => {
    const cookieA = await signUpAndGetCookie(
      'alice4@example.com',
      'Test1234',
      'Alice',
    )
    const cookieB = await signUpAndGetCookie('bob4@example.com', 'Test1234', 'Bob')
    const aliceRouteId = await createOneRoute(cookieA, 'alice-protected')

    const before = await prisma.route.count()
    const res = await deleteRouteById(cookieB, aliceRouteId)
    expect(res.status).toBe(403)
    const after = await prisma.route.count()
    expect(after).toBe(before)

    // alice 側からはまだ取得できる
    const get = await getRouteById(cookieA, aliceRouteId)
    expect(get.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/routes/:id (US-006 経路編集)
// ---------------------------------------------------------------------------

describe('PUT /api/routes/:id (US-006 経路編集)', () => {
  it('未認証では 401', async () => {
    const res = await putRouteById(null, 'any-id', {
      updatedAt: new Date().toISOString(),
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    expect(res.status).toBe(401)
  })

  it('JSON 不正なら 400 (invalid_json)', async () => {
    const cookie = await signUpAndGetCookie('edit1@example.com', 'Test1234')
    const id = await createOneRoute(cookie)
    const res = await putRouteById(cookie, id, 'not-json')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('zod 検証 NG (segments 空配列) で 400', async () => {
    const cookie = await signUpAndGetCookie('edit2@example.com', 'Test1234')
    const id = await createOneRoute(cookie)
    const res = await putRouteById(cookie, id, {
      updatedAt: new Date().toISOString(),
      segments: [],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation_failed')
  })

  it('存在しない id では 404', async () => {
    const cookie = await signUpAndGetCookie('edit3@example.com', 'Test1234')
    const res = await putRouteById(cookie, 'nonexistent-id', {
      updatedAt: new Date().toISOString(),
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    expect(res.status).toBe(404)
  })

  it('他人の経路の更新は 403 (DB は変化しない)', async () => {
    const cookieA = await signUpAndGetCookie(
      'alice5@example.com',
      'Test1234',
      'Alice',
    )
    const cookieB = await signUpAndGetCookie('bob5@example.com', 'Test1234', 'Bob')
    const aliceId = await createOneRoute(cookieA, 'protected')

    const aliceRoute = await prisma.route.findUnique({ where: { id: aliceId } })
    const res = await putRouteById(cookieB, aliceId, {
      name: 'hacked',
      updatedAt: aliceRoute!.updatedAt.toISOString(),
      segments: [{ kind: 'train', fromStation: 'X', toStation: 'Y', fare: 999 }],
    })
    expect(res.status).toBe(403)

    const after = await prisma.route.findUnique({ where: { id: aliceId } })
    expect(after?.name).toBe('protected')
  })

  it('updatedAt が DB と一致しない場合は 409 を返し、current に最新が同梱される', async () => {
    const cookie = await signUpAndGetCookie('edit4@example.com', 'Test1234')
    const id = await createOneRoute(cookie, 'original')

    const res = await putRouteById(cookie, id, {
      name: 'updated',
      updatedAt: '2000-01-01T00:00:00.000Z', // 古いタイムスタンプ
      segments: [{ kind: 'train', fromStation: 'X', toStation: 'Y', fare: 200 }],
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('conflict')
    expect(body.message).toMatch(/最新の状態を再読込/)
    expect(body.current).toBeTruthy()
    expect(body.current.id).toBe(id)
    expect(body.current.name).toBe('original') // 旧データのまま
  })

  it('正しい updatedAt で 200 で更新でき、segments も置換される (orderIndex 採番再)', async () => {
    await setupMasterFixture()
    const cookie = await signUpAndGetCookie('edit5@example.com', 'Test1234')
    const id = await createOneRoute(cookie, 'before')
    const before = await prisma.route.findUnique({
      where: { id },
      include: { segments: true },
    })
    const beforeSegIds = before!.segments.map((s) => s.id)

    const res = await putRouteById(cookie, id, {
      name: 'after',
      updatedAt: before!.updatedAt.toISOString(),
      segments: [
        {
          kind: 'train',
          lineId: 'jr-yamanote',
          fromStation: '渋谷',
          toStation: '表参道',
          fare: 160,
        },
        {
          kind: 'subway',
          lineId: 'metro-ginza',
          fromStation: '表参道',
          toStation: '神田',
          fare: 160,
        },
      ],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.name).toBe('after')
    expect(body.fromStation).toBe('渋谷') // 派生再算出
    expect(body.toStation).toBe('神田')
    expect(body.segments).toHaveLength(2)
    expect(body.segments[0].orderIndex).toBe(1)
    expect(body.segments[1].orderIndex).toBe(2)

    // 旧 RouteSegment の id は新 segment では使われない (置換)
    const newSegIds = body.segments.map((s: { id: string }) => s.id)
    for (const oldId of beforeSegIds) {
      expect(newSegIds).not.toContain(oldId)
    }
  })

  it('更新後は updatedAt が新しい値に進み、再度同じ updatedAt で更新すると 409', async () => {
    const cookie = await signUpAndGetCookie('edit6@example.com', 'Test1234')
    const id = await createOneRoute(cookie)
    const before = await prisma.route.findUnique({ where: { id } })

    // 1回目: 成功
    const res1 = await putRouteById(cookie, id, {
      name: 'v1',
      updatedAt: before!.updatedAt.toISOString(),
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    expect(res1.status).toBe(200)

    // 2回目: 古い updatedAt を使う → 409
    const res2 = await putRouteById(cookie, id, {
      name: 'v2',
      updatedAt: before!.updatedAt.toISOString(), // 同じ古い値
      segments: [{ kind: 'train', fromStation: 'C', toStation: 'D', fare: 200 }],
    })
    expect(res2.status).toBe(409)
  })

  it('updatedAt が不正な日時文字列でも 409 (型一致せず conflict 扱い)', async () => {
    const cookie = await signUpAndGetCookie('edit7@example.com', 'Test1234')
    const id = await createOneRoute(cookie)
    const res = await putRouteById(cookie, id, {
      name: 'x',
      updatedAt: 'not-a-date',
      segments: [{ kind: 'train', fromStation: 'A', toStation: 'B', fare: 100 }],
    })
    expect(res.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// GET /api/stations
// ---------------------------------------------------------------------------

describe('GET /api/stations (駅マスタ参照)', () => {
  // この describe 配下の検索系テストはマスタが存在することを前提とする。
  // beforeEach 後にマスタを再構築する。
  beforeEach(async () => {
    await setupMasterFixture()
  })

  it('未認証では 401', async () => {
    const res = await getStations(null, 'q=渋')
    expect(res.status).toBe(401)
  })

  it('検索条件未指定では 400 (no_filter)', async () => {
    const cookie = await signUpAndGetCookie('s1@example.com', 'Test1234')
    const res = await getStations(cookie, '')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_filter')
  })

  it('q (駅名漢字) で部分一致検索できる', async () => {
    const cookie = await signUpAndGetCookie('s2@example.com', 'Test1234')
    const res = await getStations(cookie, 'q=渋')
    expect(res.status).toBe(200)
    const body = await res.json()
    const names = body.stations.map((s: { name: string }) => s.name)
    expect(names).toContain('渋谷')
  })

  it('q (kana) で部分一致検索できる', async () => {
    const cookie = await signUpAndGetCookie('s3@example.com', 'Test1234')
    const res = await getStations(cookie, 'q=しぶ')
    expect(res.status).toBe(200)
    const body = await res.json()
    const names = body.stations.map((s: { name: string }) => s.name)
    expect(names).toContain('渋谷')
  })

  it('kind=bus フィルタでバス停留所のみ返る', async () => {
    const cookie = await signUpAndGetCookie('s4@example.com', 'Test1234')
    const res = await getStations(cookie, 'kind=bus')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stations.length).toBeGreaterThan(0)
    for (const station of body.stations) {
      const hasBus = station.lines.some(
        (l: { kind: string }) => l.kind === 'bus',
      )
      expect(hasBus).toBe(true)
    }
  })

  it('line=metro-ginza フィルタで銀座線接続駅のみ返る', async () => {
    const cookie = await signUpAndGetCookie('s5@example.com', 'Test1234')
    const res = await getStations(cookie, 'line=metro-ginza')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stations.length).toBeGreaterThan(0)
    for (const station of body.stations) {
      const hasGinza = station.lines.some(
        (l: { id: string }) => l.id === 'metro-ginza',
      )
      expect(hasGinza).toBe(true)
    }
  })

  it('結果オブジェクトに lines[] が含まれ kind/operator も得られる', async () => {
    const cookie = await signUpAndGetCookie('s6@example.com', 'Test1234')
    const res = await getStations(cookie, 'q=渋谷')
    const body = await res.json()
    const shibuya = body.stations.find(
      (s: { name: string }) => s.name === '渋谷',
    )
    expect(shibuya).toBeDefined()
    expect(Array.isArray(shibuya.lines)).toBe(true)
    expect(shibuya.lines.length).toBeGreaterThan(0)
    for (const l of shibuya.lines) {
      expect(l).toHaveProperty('id')
      expect(l).toHaveProperty('name')
      expect(l).toHaveProperty('kind')
    }
  })

  it('不正な kind 値では 400 (invalid_kind)', async () => {
    const cookie = await signUpAndGetCookie('s7@example.com', 'Test1234')
    const res = await getStations(cookie, 'kind=spaceship')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_kind')
  })
})
