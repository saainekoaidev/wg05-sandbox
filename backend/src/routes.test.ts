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

// ---------------------------------------------------------------------------
// GET / PUT /api/users/me (US-008 プロフィール)
// ---------------------------------------------------------------------------

async function getMe(cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/users/me', { method: 'GET', headers }),
  )
}

async function putMe(cookie: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/users/me', {
      method: 'PUT',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

describe('GET /api/users/me (US-008 プロフィール参照)', () => {
  it('未認証では 401', async () => {
    const res = await getMe(null)
    expect(res.status).toBe(401)
  })

  it('認証済みなら id/email/name/postalCode を返す (postalCode は新規ユーザでは null)', async () => {
    const cookie = await signUpAndGetCookie('me1@example.com', 'Test1234', 'Me One')
    const res = await getMe(cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      email: 'me1@example.com',
      name: 'Me One',
      postalCode: null,
    })
    expect(body.id).toBeTruthy()
  })
})

describe('PUT /api/users/me (US-008 プロフィール更新)', () => {
  it('未認証では 401', async () => {
    const res = await putMe(null, { name: 'X' })
    expect(res.status).toBe(401)
  })

  it('JSON 不正なら 400 (invalid_json)', async () => {
    const cookie = await signUpAndGetCookie('me2@example.com', 'Test1234')
    const res = await putMe(cookie, 'not-json')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('name 空白のみは 400', async () => {
    const cookie = await signUpAndGetCookie('me3@example.com', 'Test1234')
    const res = await putMe(cookie, { name: '   ' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation_failed')
  })

  it('name 51文字は 400', async () => {
    const cookie = await signUpAndGetCookie('me4@example.com', 'Test1234')
    const res = await putMe(cookie, { name: 'あ'.repeat(51) })
    expect(res.status).toBe(400)
  })

  it('postalCode に 6桁数字を送ると 400', async () => {
    const cookie = await signUpAndGetCookie('me5@example.com', 'Test1234')
    const res = await putMe(cookie, { name: 'X', postalCode: '123456' })
    expect(res.status).toBe(400)
  })

  it('postalCode に英数字混在を送ると 400', async () => {
    const cookie = await signUpAndGetCookie('me6@example.com', 'Test1234')
    const res = await putMe(cookie, { name: 'X', postalCode: '123abcd' })
    expect(res.status).toBe(400)
  })

  it('正常: name のみで更新できる (postalCode は明示しなくても保たれる…ではなく null になる)', async () => {
    const cookie = await signUpAndGetCookie('me7@example.com', 'Test1234', 'Old Name')
    const res = await putMe(cookie, { name: 'New Name' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: 'New Name', postalCode: null })
  })

  it('正常: postalCode 7桁数字を保存し、再取得で同じ値が読める', async () => {
    const cookie = await signUpAndGetCookie('me8@example.com', 'Test1234', 'A')
    const res = await putMe(cookie, { name: 'A', postalCode: '1500001' })
    expect(res.status).toBe(200)
    expect((await res.json()).postalCode).toBe('1500001')
    const get = await getMe(cookie)
    expect((await get.json()).postalCode).toBe('1500001')
  })

  it('正常: postalCode 空文字を送ると null として保存される', async () => {
    const cookie = await signUpAndGetCookie('me9@example.com', 'Test1234', 'A')
    // 一度値を入れる
    await putMe(cookie, { name: 'A', postalCode: '1500001' })
    // 空文字でクリア
    const res = await putMe(cookie, { name: 'A', postalCode: '' })
    expect(res.status).toBe(200)
    expect((await res.json()).postalCode).toBe(null)
  })

  it('name 前後の空白は trim されて保存される', async () => {
    const cookie = await signUpAndGetCookie('me10@example.com', 'Test1234', 'A')
    const res = await putMe(cookie, { name: '  Bob  ' })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Bob')
  })

  it('email は更新対象外 (送っても無視され値は変わらない)', async () => {
    const cookie = await signUpAndGetCookie('me11@example.com', 'Test1234', 'A')
    const res = await putMe(cookie, {
      name: 'A',
      // email を勝手に書き換えようとする
      email: 'attacker@example.com',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('me11@example.com')
  })

  it('GET /api/users/me は role を含む (新規ユーザは "user")', async () => {
    const cookie = await signUpAndGetCookie('me12@example.com', 'Test1234', 'A')
    const res = await getMe(cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('user')
  })
})

// ---------------------------------------------------------------------------
// /api/lines (US-012 路線マスタ管理)
// ---------------------------------------------------------------------------

async function getLines(cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/lines', { method: 'GET', headers }),
  )
}

async function postLine(cookie: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/lines', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function putLineById(
  cookie: string | null,
  id: string,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/lines/${id}`, {
      method: 'PUT',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function deleteLineById(
  cookie: string | null,
  id: string,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/lines/${id}`, {
      method: 'DELETE',
      headers,
    }),
  )
}

async function makeAdmin(email: string): Promise<void> {
  await prisma.user.update({ where: { email }, data: { role: 'admin' } })
}

describe('GET /api/lines (一覧)', () => {
  it('未認証では 401', async () => {
    const res = await getLines(null)
    expect(res.status).toBe(401)
  })

  it('認証済みなら一般ユーザでも一覧を取得できる (空配列含む)', async () => {
    const cookie = await signUpAndGetCookie('lg1@example.com', 'Test1234')
    const res = await getLines(cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ lines: [] })
  })

  it('複数レコードは kind 昇順, name 昇順で並び _count を含む', async () => {
    const cookie = await signUpAndGetCookie('lg2@example.com', 'Test1234')
    await prisma.line.createMany({
      data: [
        { id: 'jr-tokaido', name: 'JR東海道線', kind: 'train', operator: 'JR東海' },
        { id: 'metro-meijo', name: '名古屋市営地下鉄名城線', kind: 'subway' },
        { id: 'meitetsu-honsen', name: '名鉄名古屋本線', kind: 'train' },
      ],
    })
    const res = await getLines(cookie)
    const body = await res.json()
    const ids = body.lines.map((l: { id: string }) => l.id)
    // kind ASC: subway < train なので metro-meijo が先頭
    expect(ids[0]).toBe('metro-meijo')
    // train 内 name ASC で JR < 名鉄
    expect(ids[1]).toBe('jr-tokaido')
    expect(ids[2]).toBe('meitetsu-honsen')
    expect(body.lines[0]).toMatchObject({
      routeSegmentCount: 0,
      stationCount: 0,
    })
  })
})

describe('POST /api/lines (admin 路線作成)', () => {
  it('未認証では 401', async () => {
    const res = await postLine(null, {
      id: 'x',
      name: 'X',
      kind: 'train',
    })
    expect(res.status).toBe(401)
  })

  it('一般ユーザでは 403', async () => {
    const cookie = await signUpAndGetCookie('la1@example.com', 'Test1234')
    const res = await postLine(cookie, {
      id: 'x',
      name: 'X',
      kind: 'train',
    })
    expect(res.status).toBe(403)
  })

  it('管理者なら 201 で作成できる', async () => {
    const email = 'la2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postLine(cookie, {
      id: 'jr-tokaido',
      name: 'JR東海道線',
      kind: 'train',
      operator: 'JR東海',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      id: 'jr-tokaido',
      name: 'JR東海道線',
      kind: 'train',
      operator: 'JR東海',
    })
  })

  it('JSON 不正で 400 (invalid_json)', async () => {
    const email = 'la3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postLine(cookie, 'not-json')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('id 形式違反 (空白含み) で 400', async () => {
    const email = 'la4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postLine(cookie, {
      id: 'has space',
      name: 'X',
      kind: 'train',
    })
    expect(res.status).toBe(400)
  })

  it('kind が enum 外で 400', async () => {
    const email = 'la5@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postLine(cookie, {
      id: 'x',
      name: 'X',
      kind: 'spaceship',
    })
    expect(res.status).toBe(400)
  })

  it('id 重複は 409 (duplicate)', async () => {
    const email = 'la6@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'dup', name: 'D1', kind: 'train' },
    })
    const res = await postLine(cookie, {
      id: 'dup',
      name: 'D2',
      kind: 'subway',
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('duplicate')
  })

  it('name 重複も 409', async () => {
    const email = 'la7@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'name-a', name: '同名線', kind: 'train' },
    })
    const res = await postLine(cookie, {
      id: 'name-b',
      name: '同名線',
      kind: 'train',
    })
    expect(res.status).toBe(409)
  })

  it('operator は空文字なら null として保存される', async () => {
    const email = 'la8@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postLine(cookie, {
      id: 'no-op',
      name: 'NoOp',
      kind: 'other',
      operator: '',
    })
    expect(res.status).toBe(201)
    expect((await res.json()).operator).toBeNull()
  })
})

describe('PUT /api/lines/:id (admin 更新)', () => {
  it('未認証では 401', async () => {
    const res = await putLineById(null, 'x', { name: 'X', kind: 'train' })
    expect(res.status).toBe(401)
  })

  it('一般ユーザでは 403', async () => {
    const cookie = await signUpAndGetCookie('lp1@example.com', 'Test1234')
    const res = await putLineById(cookie, 'x', { name: 'X', kind: 'train' })
    expect(res.status).toBe(403)
  })

  it('存在しない id で 404', async () => {
    const email = 'lp2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await putLineById(cookie, 'nonexistent', {
      name: 'X',
      kind: 'train',
    })
    expect(res.status).toBe(404)
  })

  it('管理者なら 200 で name/kind/operator を更新できる', async () => {
    const email = 'lp3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'edit-me', name: 'Old', kind: 'train', operator: 'A社' },
    })
    const res = await putLineById(cookie, 'edit-me', {
      name: 'New',
      kind: 'subway',
      operator: 'B社',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: 'edit-me',
      name: 'New',
      kind: 'subway',
      operator: 'B社',
    })
  })

  it('name 重複は 409', async () => {
    const email = 'lp4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.createMany({
      data: [
        { id: 'a', name: 'A', kind: 'train' },
        { id: 'b', name: 'B', kind: 'train' },
      ],
    })
    const res = await putLineById(cookie, 'b', { name: 'A', kind: 'train' })
    expect(res.status).toBe(409)
  })

  it('id を変更しようとする送信値は無視される (URL の id 優先)', async () => {
    const email = 'lp5@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({ data: { id: 'fixed', name: 'X', kind: 'train' } })
    const res = await putLineById(cookie, 'fixed', {
      id: 'hacked',
      name: 'Y',
      kind: 'train',
    })
    // LineUpdate は omit({ id: true }) なので id 送信は無視され, 検証は通る
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('fixed')
  })
})

describe('DELETE /api/lines/:id (admin 削除)', () => {
  it('未認証では 401', async () => {
    const res = await deleteLineById(null, 'x')
    expect(res.status).toBe(401)
  })

  it('一般ユーザでは 403', async () => {
    const cookie = await signUpAndGetCookie('ld1@example.com', 'Test1234')
    const res = await deleteLineById(cookie, 'x')
    expect(res.status).toBe(403)
  })

  it('存在しない id で 404', async () => {
    const email = 'ld2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await deleteLineById(cookie, 'nonexistent')
    expect(res.status).toBe(404)
  })

  it('参照のない路線は 204 で削除される', async () => {
    const email = 'ld3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({ data: { id: 'unused', name: 'U', kind: 'train' } })
    const res = await deleteLineById(cookie, 'unused')
    expect(res.status).toBe(204)
    const after = await prisma.line.findUnique({ where: { id: 'unused' } })
    expect(after).toBeNull()
  })

  it('RouteSegment が参照中なら 409 + referenceCount + sampleRouteIds で拒否', async () => {
    const email = 'ld4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'used', name: 'Used', kind: 'train' },
    })
    // 経路を 1 件作って segments で lineId を参照させる
    const userId = (await prisma.user.findUnique({ where: { email } }))!.id
    const route = await prisma.route.create({
      data: {
        userId,
        fromStation: 'A',
        toStation: 'B',
        segments: {
          create: [
            {
              orderIndex: 1,
              kind: 'train',
              lineId: 'used',
              fromStation: 'A',
              toStation: 'B',
              fare: 100,
            },
          ],
        },
      },
    })

    const res = await deleteLineById(cookie, 'used')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('in_use')
    expect(body.referenceCount).toBe(1)
    expect(body.sampleRouteIds).toContain(route.id)
    // 削除されていないことを確認
    expect(await prisma.line.findUnique({ where: { id: 'used' } })).not.toBeNull()
  })

  it('StationLine しか持たない路線 (RouteSegment 参照なし) は削除でき、StationLink は cascade される', async () => {
    const email = 'ld5@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'station-only', name: 'SO', kind: 'train' },
    })
    await prisma.station.create({
      data: { id: 'st-1', name: 'S1', kana: 'S1' },
    })
    await prisma.stationLine.create({
      data: { stationId: 'st-1', lineId: 'station-only' },
    })

    const res = await deleteLineById(cookie, 'station-only')
    expect(res.status).toBe(204)
    expect(
      await prisma.stationLine.findFirst({ where: { lineId: 'station-only' } }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// /api/admin/stations (US-013 駅マスタ管理)
// ---------------------------------------------------------------------------

async function getAdminStations(cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/admin/stations', {
      method: 'GET',
      headers,
    }),
  )
}

async function postAdminStation(
  cookie: string | null,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request('http://localhost/api/admin/stations', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function putAdminStation(
  cookie: string | null,
  id: string,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/admin/stations/${id}`, {
      method: 'PUT',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function deleteAdminStation(
  cookie: string | null,
  id: string,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return app.fetch(
    new Request(`http://localhost/api/admin/stations/${id}`, {
      method: 'DELETE',
      headers,
    }),
  )
}

describe('GET /api/admin/stations (admin 一覧)', () => {
  it('未認証では 401', async () => {
    const res = await getAdminStations(null)
    expect(res.status).toBe(401)
  })

  it('一般ユーザでは 403', async () => {
    const cookie = await signUpAndGetCookie('sg1@example.com', 'Test1234')
    const res = await getAdminStations(cookie)
    expect(res.status).toBe(403)
  })

  it('admin: 0件なら空配列', async () => {
    const email = 'sg2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await getAdminStations(cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ stations: [] })
  })

  it('admin: kana 昇順でソートされ lineIds + lines を含む', async () => {
    const email = 'sg3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.createMany({
      data: [
        { id: 'jr-tokaido', name: 'JR東海道線', kind: 'train' },
        { id: 'meitetsu', name: '名鉄', kind: 'train' },
      ],
    })
    await prisma.station.createMany({
      data: [
        { id: 'stn-nagoya', name: '名古屋', kana: 'なごや' },
        { id: 'stn-gifu', name: '岐阜', kana: 'ぎふ' },
      ],
    })
    await prisma.stationLine.createMany({
      data: [
        { stationId: 'stn-nagoya', lineId: 'jr-tokaido' },
        { stationId: 'stn-nagoya', lineId: 'meitetsu' },
        { stationId: 'stn-gifu', lineId: 'jr-tokaido' },
      ],
    })

    const res = await getAdminStations(cookie)
    const body = await res.json()
    expect(body.stations.map((s: { id: string }) => s.id)).toEqual([
      'stn-gifu',
      'stn-nagoya',
    ])
    const nagoya = body.stations.find((s: { id: string }) => s.id === 'stn-nagoya')
    expect(nagoya.lineIds).toEqual(
      expect.arrayContaining(['jr-tokaido', 'meitetsu']),
    )
    expect(nagoya.lines.length).toBe(2)
  })
})

describe('POST /api/admin/stations (admin 作成)', () => {
  it('未認証は 401, 一般ユーザは 403', async () => {
    expect((await postAdminStation(null, { name: 'X', kana: 'x' })).status).toBe(
      401,
    )
    const cookie = await signUpAndGetCookie('sp1@example.com', 'Test1234')
    expect(
      (await postAdminStation(cookie, { name: 'X', kana: 'x' })).status,
    ).toBe(403)
  })

  it('admin: id を省略すると cuid が割り当てられて 201', async () => {
    const email = 'sp2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postAdminStation(cookie, {
      name: '名古屋',
      kana: 'なごや',
      lineIds: [],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('名古屋')
    expect(body.lineIds).toEqual([])
  })

  it('admin: id を指定すると指定 id で作成される', async () => {
    const email = 'sp3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postAdminStation(cookie, {
      id: 'stn-nagoya',
      name: '名古屋',
      kana: 'なごや',
    })
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('stn-nagoya')
  })

  it('admin: lineIds に存在しない id を含むと 400 (unknown_line)', async () => {
    const email = 'sp4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postAdminStation(cookie, {
      name: 'X',
      kana: 'x',
      lineIds: ['nonexistent-line'],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unknown_line')
  })

  it('admin: lineIds 重複は 1 回だけ紐付けられる', async () => {
    const email = 'sp5@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'jr-tokaido', name: 'JR東海道線', kind: 'train' },
    })
    const res = await postAdminStation(cookie, {
      id: 'stn-x',
      name: 'X',
      kana: 'x',
      lineIds: ['jr-tokaido', 'jr-tokaido'],
    })
    expect(res.status).toBe(201)
    expect((await res.json()).lineIds).toEqual(['jr-tokaido'])
  })

  it('admin: id 重複は 409', async () => {
    const email = 'sp6@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.station.create({
      data: { id: 'dup', name: 'D', kana: 'd' },
    })
    const res = await postAdminStation(cookie, {
      id: 'dup',
      name: 'D2',
      kana: 'd',
    })
    expect(res.status).toBe(409)
  })

  it('admin: id 形式違反 (空白) は 400', async () => {
    const email = 'sp7@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await postAdminStation(cookie, {
      id: 'has space',
      name: 'X',
      kana: 'x',
    })
    expect(res.status).toBe(400)
  })

  it('admin: name または kana 未入力で 400', async () => {
    const email = 'sp8@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    expect(
      (await postAdminStation(cookie, { name: '', kana: 'x' })).status,
    ).toBe(400)
    expect(
      (await postAdminStation(cookie, { name: 'X', kana: '' })).status,
    ).toBe(400)
  })
})

describe('PUT /api/admin/stations/:id (admin 更新)', () => {
  it('未認証は 401, 一般ユーザは 403', async () => {
    expect(
      (await putAdminStation(null, 'x', { name: 'X', kana: 'x' })).status,
    ).toBe(401)
    const cookie = await signUpAndGetCookie('su1@example.com', 'Test1234')
    expect(
      (await putAdminStation(cookie, 'x', { name: 'X', kana: 'x' })).status,
    ).toBe(403)
  })

  it('admin: 存在しない id で 404', async () => {
    const email = 'su2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    const res = await putAdminStation(cookie, 'nonexistent', {
      name: 'X',
      kana: 'x',
    })
    expect(res.status).toBe(404)
  })

  it('admin: name/kana を更新できる', async () => {
    const email = 'su3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.station.create({
      data: { id: 'stn-edit', name: '旧名', kana: 'きゅうめい' },
    })
    const res = await putAdminStation(cookie, 'stn-edit', {
      name: '新名',
      kana: 'しんめい',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: 'stn-edit',
      name: '新名',
      kana: 'しんめい',
    })
  })

  it('admin: lineIds の add/remove を一括反映 (差分は deleteMany + create で全置換)', async () => {
    const email = 'su4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.createMany({
      data: [
        { id: 'l-a', name: 'A', kind: 'train' },
        { id: 'l-b', name: 'B', kind: 'train' },
        { id: 'l-c', name: 'C', kind: 'train' },
      ],
    })
    await prisma.station.create({
      data: {
        id: 'stn-multi',
        name: 'M',
        kana: 'm',
        lineLinks: { create: [{ lineId: 'l-a' }, { lineId: 'l-b' }] },
      },
    })
    // 初期: a, b → 更新で b, c に
    const res = await putAdminStation(cookie, 'stn-multi', {
      name: 'M',
      kana: 'm',
      lineIds: ['l-b', 'l-c'],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lineIds.sort()).toEqual(['l-b', 'l-c'])
    // DB 直で確認
    const links = await prisma.stationLine.findMany({
      where: { stationId: 'stn-multi' },
    })
    expect(links.map((l) => l.lineId).sort()).toEqual(['l-b', 'l-c'])
  })

  it('admin: 駅名を変更しても既存 RouteSegment.fromStation 文字列は追従しない (ADR 0006 §5)', async () => {
    const email = 'su5@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.station.create({
      data: { id: 'stn-old', name: '旧駅名', kana: 'きゅう' },
    })
    // 経路を作成 (RouteSegment.fromStation = "旧駅名" の文字列)
    const userId = (await prisma.user.findUnique({ where: { email } }))!.id
    const route = await prisma.route.create({
      data: {
        userId,
        fromStation: '旧駅名',
        toStation: '別の駅',
        segments: {
          create: [
            {
              orderIndex: 1,
              kind: 'train',
              fromStation: '旧駅名',
              toStation: '別の駅',
              fare: 100,
            },
          ],
        },
      },
    })

    // 駅名を変更
    await putAdminStation(cookie, 'stn-old', {
      name: '新駅名',
      kana: 'しん',
    })

    // 既存 RouteSegment は追従していない
    const seg = await prisma.routeSegment.findFirst({
      where: { routeId: route.id },
    })
    expect(seg!.fromStation).toBe('旧駅名')
  })
})

describe('DELETE /api/admin/stations/:id (admin 削除)', () => {
  it('未認証は 401, 一般ユーザは 403', async () => {
    expect((await deleteAdminStation(null, 'x')).status).toBe(401)
    const cookie = await signUpAndGetCookie('sd1@example.com', 'Test1234')
    expect((await deleteAdminStation(cookie, 'x')).status).toBe(403)
  })

  it('admin: 存在しない id で 404', async () => {
    const email = 'sd2@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    expect((await deleteAdminStation(cookie, 'nonexistent')).status).toBe(404)
  })

  it('admin: 駅削除は無制約 (RouteSegment は文字列複製のため壊れない)', async () => {
    const email = 'sd3@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.station.create({
      data: { id: 'stn-keep', name: 'K', kana: 'k' },
    })
    // RouteSegment が同名の駅を文字列で参照している状態
    const userId = (await prisma.user.findUnique({ where: { email } }))!.id
    const route = await prisma.route.create({
      data: {
        userId,
        fromStation: 'K',
        toStation: 'L',
        segments: {
          create: [
            {
              orderIndex: 1,
              kind: 'train',
              fromStation: 'K',
              toStation: 'L',
              fare: 100,
            },
          ],
        },
      },
    })

    const res = await deleteAdminStation(cookie, 'stn-keep')
    expect(res.status).toBe(204)
    expect(await prisma.station.findUnique({ where: { id: 'stn-keep' } })).toBeNull()
    // RouteSegment は壊れていない
    const seg = await prisma.routeSegment.findFirst({
      where: { routeId: route.id },
    })
    expect(seg!.fromStation).toBe('K')
  })

  it('admin: StationLine は cascade で連鎖削除される', async () => {
    const email = 'sd4@example.com'
    const cookie = await signUpAndGetCookie(email, 'Test1234')
    await makeAdmin(email)
    await prisma.line.create({
      data: { id: 'lll', name: 'LLL', kind: 'train' },
    })
    await prisma.station.create({
      data: {
        id: 'stn-cascade',
        name: 'C',
        kana: 'c',
        lineLinks: { create: [{ lineId: 'lll' }] },
      },
    })
    expect(
      await prisma.stationLine.count({
        where: { stationId: 'stn-cascade' },
      }),
    ).toBe(1)
    expect((await deleteAdminStation(cookie, 'stn-cascade')).status).toBe(204)
    expect(
      await prisma.stationLine.count({
        where: { stationId: 'stn-cascade' },
      }),
    ).toBe(0)
  })
})
