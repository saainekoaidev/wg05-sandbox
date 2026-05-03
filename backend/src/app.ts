import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { auth } from './auth.js'
import { prisma } from './db.js'

/**
 * Hono アプリケーション本体。serve() は index.ts に分離し、
 * テストからは app.fetch(Request) で副作用なく叩けるようにする。
 */
export const app = new Hono()

app.use(
  '*',
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }),
)

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.get('/api/health', (c) => c.json({ ok: true }))

// =====================================================================
// 経路登録 (US-003)
// =====================================================================

const KindSchema = z.enum(['train', 'subway', 'bus', 'other'])

const SegmentInput = z.object({
  kind: KindSchema,
  lineId: z.string().nullable().optional(),
  fromStation: z.string().min(1).max(50),
  toStation: z.string().min(1).max(50),
  fare: z.number().int().min(1).max(99999),
})

const RouteInput = z.object({
  name: z.string().max(50).nullable().optional(),
  segments: z.array(SegmentInput).min(1).max(10),
})

app.post('/api/routes', async (c) => {
  // 認証
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  // ボディ JSON パース
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  // zod バリデーション
  const parsed = RouteInput.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }
  const { name, segments } = parsed.data

  // ADR 0002 §3.2.1 に従い、Route の出発駅・到着駅は segments の端点から
  // サーバ側で派生算出する (クライアントから送信されても無視)。
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const fromStation = first.fromStation
  const toStation = last.toStation

  // 区間連結性は警告レベル (screen_design_route_register.md §6.1) のため、
  // ここでは強制エラーにせずそのまま保存する。

  const created = await prisma.route.create({
    data: {
      userId: session.user.id,
      name: name ?? null,
      fromStation,
      toStation,
      segments: {
        create: segments.map((s, i) => ({
          orderIndex: i + 1,
          kind: s.kind,
          lineId: s.lineId ?? null,
          fromStation: s.fromStation,
          toStation: s.toStation,
          fare: s.fare,
        })),
      },
    },
    include: { segments: { orderBy: { orderIndex: 'asc' } } },
  })

  return c.json(created, 201)
})

// =====================================================================
// 経路一覧 (US-004)
// screen_design_route_list.md に従い、ログイン中ユーザの経路のみ返す。
// 並び順は updatedAt DESC (運用観点で「直近の更新が上」)。
// segments を同梱して、合計運賃 / 種別タグ / 路線サマリ をクライアント側で派生表示する。
// =====================================================================

app.get('/api/routes', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const routes = await prisma.route.findMany({
    where: { userId: session.user.id },
    include: { segments: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  })

  return c.json({ routes })
})

// =====================================================================
// 経路詳細 / 削除 (US-005)
// screen_design_route_detail.md に従い、認証 + オーナーチェックを必須にする。
// 他人の経路へのアクセスは 403 (情報漏洩を許容: ID の存在自体は隠さない)。
// =====================================================================

app.get('/api/routes/:id', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const id = c.req.param('id')
  const route = await prisma.route.findUnique({
    where: { id },
    include: { segments: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!route) return c.json({ error: 'not_found' }, 404)
  if (route.userId !== session.user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }
  return c.json(route)
})

app.delete('/api/routes/:id', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const id = c.req.param('id')
  const route = await prisma.route.findUnique({ where: { id } })
  if (!route) return c.json({ error: 'not_found' }, 404)
  if (route.userId !== session.user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // RouteSegment は onDelete: Cascade で連鎖削除される (schema.prisma)。
  await prisma.route.delete({ where: { id } })
  return c.json({ ok: true })
})

// =====================================================================
// 経路編集 (US-006)
// PUT /api/routes/:id: 経路を上書き更新する。
// 楽観ロック: クライアントから送信された updatedAt が DB の値と一致しない場合 409。
// 区間は (deleteMany + create) で全置換する (design.md §7.2)。
// =====================================================================

const RouteUpdateInput = z.object({
  name: z.string().max(50).nullable().optional(),
  // クライアントが GET 時に受け取った Route.updatedAt をそのまま送り返す前提
  updatedAt: z.string().min(1),
  segments: z.array(SegmentInput).min(1).max(10),
})

app.put('/api/routes/:id', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const id = c.req.param('id')
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  const parsed = RouteUpdateInput.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }

  const existing = await prisma.route.findUnique({
    where: { id },
    include: { segments: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.userId !== session.user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // 楽観排他: クライアントの updatedAt と DB の updatedAt を ms 単位で比較。
  // 一致しなければ 409 を返し、最新値をクライアントに返して再ロードを促す。
  const clientTime = new Date(parsed.data.updatedAt).getTime()
  const serverTime = existing.updatedAt.getTime()
  if (Number.isNaN(clientTime) || clientTime !== serverTime) {
    return c.json(
      {
        error: 'conflict',
        message:
          '他の場所で更新されたため最新の状態を再読込しました。再度ご確認ください',
        current: existing,
      },
      409,
    )
  }

  const { name, segments } = parsed.data
  const fromStation = segments[0]!.fromStation
  const toStation = segments[segments.length - 1]!.toStation

  const updated = await prisma.route.update({
    where: { id },
    data: {
      name: name ?? null,
      fromStation,
      toStation,
      // 既存 RouteSegment を全削除して再作成する (区間構造の差分検知が複雑なため簡易戦略)。
      // Prisma のネスト書きで deleteMany → create の順に実行される。
      segments: {
        deleteMany: {},
        create: segments.map((s, i) => ({
          orderIndex: i + 1,
          kind: s.kind,
          lineId: s.lineId ?? null,
          fromStation: s.fromStation,
          toStation: s.toStation,
          fare: s.fare,
        })),
      },
    },
    include: { segments: { orderBy: { orderIndex: 'asc' } } },
  })

  return c.json(updated)
})

// =====================================================================
// プロフィール (US-008, ADR 0004)
// =====================================================================

const ProfileInput = z.object({
  // 表示名: 1〜50 文字 (User.name は NOT NULL)。空白のみは弾く。
  name: z
    .string()
    .min(1)
    .max(50)
    .refine((v) => v.trim().length > 0, { message: 'blank' }),
  // 郵便番号: 任意。指定するなら 7 桁数字 (ハイフン無し) のみ。
  postalCode: z
    .union([z.string().regex(/^\d{7}$/), z.literal(''), z.null()])
    .optional(),
})

app.get('/api/users/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, postalCode: true, role: true },
  })
  if (!user) return c.json({ error: 'not_found' }, 404)
  return c.json(user)
})

app.put('/api/users/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  const parsed = ProfileInput.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }

  // 空文字 / null / undefined は同じ扱い (= postalCode を NULL に倒す)
  const postalCode = parsed.data.postalCode
    ? parsed.data.postalCode
    : null

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name.trim(),
      postalCode,
      updatedAt: new Date(),
    },
    select: { id: true, email: true, name: true, postalCode: true },
  })

  return c.json(updated)
})

// =====================================================================
// 駅マスタ参照 (US-003 / US-006 サポート, screen_design_station_master.md)
// =====================================================================

app.get('/api/stations', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const q = c.req.query('q')?.trim() || undefined
  const kindRaw = c.req.query('kind')
  const lineId = c.req.query('line')?.trim() || undefined

  // kind は enum 検証 (空文字や未指定は許容)
  let kind: z.infer<typeof KindSchema> | undefined
  if (kindRaw && kindRaw !== '') {
    const parsed = KindSchema.safeParse(kindRaw)
    if (!parsed.success) return c.json({ error: 'invalid_kind' }, 400)
    kind = parsed.data
  }

  // 検索条件は 1つ以上必要 (UI 側でも警告を出す前提)
  if (!q && !kind && !lineId) {
    return c.json({ error: 'no_filter' }, 400)
  }

  const stations = await prisma.station.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { name: { contains: q } },
                { kana: { contains: q } },
              ],
            }
          : {},
        kind || lineId
          ? {
              lineLinks: {
                some: {
                  line: {
                    ...(kind ? { kind } : {}),
                    ...(lineId ? { id: lineId } : {}),
                  },
                },
              },
            }
          : {},
      ],
    },
    include: {
      lineLinks: { include: { line: true } },
    },
    orderBy: { name: 'asc' },
    take: 50,
  })

  return c.json({
    stations: stations.map((s) => ({
      id: s.id,
      name: s.name,
      kana: s.kana,
      // US-030: 駅番号 (例: "CA68"). 手動作成 / 番号未設定駅は空文字。
      code: s.code,
      lines: s.lineLinks.map((ll) => ({
        id: ll.line.id,
        name: ll.line.name,
        kind: ll.line.kind,
        operator: ll.line.operator,
      })),
    })),
  })
})

// =====================================================================
// 路線マスタ管理 (US-012, ADR 0006)
// =====================================================================

/**
 * 認証 + 管理者ロールを要求するヘルパ。
 * 未認証なら 401, role!=admin なら 403 を返し、それ以外なら null を返す。
 */
async function requireAdmin(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (!me || me.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  return null
}

const LineInput = z.object({
  // id は手動採番のスラッグ or Wikidata Q-ID。1〜80 文字, 半角英数+ハイフン+ドット+アンダースコア。
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/, 'id_format'),
  name: z.string().min(1).max(80),
  kind: KindSchema,
  operator: z
    .union([z.string().min(1).max(80), z.literal(''), z.null()])
    .optional(),
})

const LineUpdate = LineInput.omit({ id: true })

// 一覧取得は認証ユーザなら誰でも可 (将来 route 画面の dropdown が叩く)。
app.get('/api/lines', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const lines = await prisma.line.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { segments: true, stationLinks: true } },
    },
  })
  return c.json({
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      operator: l.operator,
      // 管理画面で削除可否判定に使う件数情報も同梱する。
      routeSegmentCount: l._count.segments,
      stationCount: l._count.stationLinks,
    })),
  })
})

app.post('/api/lines', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const parsed = LineInput.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }

  const operator = parsed.data.operator ? parsed.data.operator : null
  try {
    const created = await prisma.line.create({
      data: {
        id: parsed.data.id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        operator,
      },
    })
    return c.json(created, 201)
  } catch (e) {
    // P2002 は unique 制約違反 (id or name 重複)。
    if ((e as { code?: string }).code === 'P2002') {
      return c.json({ error: 'duplicate' }, 409)
    }
    throw e
  }
})

app.put('/api/lines/:id', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  const id = c.req.param('id')
  const existing = await prisma.line.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'not_found' }, 404)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const parsed = LineUpdate.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }

  const operator = parsed.data.operator ? parsed.data.operator : null
  try {
    const updated = await prisma.line.update({
      where: { id },
      data: {
        name: parsed.data.name,
        kind: parsed.data.kind,
        operator,
      },
    })
    return c.json(updated)
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return c.json({ error: 'duplicate' }, 409)
    }
    throw e
  }
})

app.delete('/api/lines/:id', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  const id = c.req.param('id')
  const existing = await prisma.line.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'not_found' }, 404)

  // ADR 0006 §2: 参照中の RouteSegment があれば 409 で削除拒否。
  const refs = await prisma.routeSegment.findMany({
    where: { lineId: id },
    select: { routeId: true },
    take: 5,
  })
  const refCount = await prisma.routeSegment.count({ where: { lineId: id } })
  if (refCount > 0) {
    return c.json(
      {
        error: 'in_use',
        referenceCount: refCount,
        sampleRouteIds: Array.from(new Set(refs.map((r) => r.routeId))).slice(
          0,
          5,
        ),
      },
      409,
    )
  }

  // StationLine は onDelete: Cascade で連鎖削除される。
  await prisma.line.delete({ where: { id } })
  return c.body(null, 204)
})

// =====================================================================
// 駅マスタ管理 (US-013, ADR 0006 §4-§6)
// =====================================================================

// id は任意 (省略時 cuid 自動採番)。指定する場合は path-safe な範囲に限定。
const StationCreateInput = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/, 'id_format')
    .optional(),
  name: z.string().min(1).max(50),
  kana: z.string().min(1).max(80),
  // 紐付ける Line の id 配列。空配列許容。
  lineIds: z.array(z.string()).max(50).default([]),
})

const StationUpdate = z.object({
  name: z.string().min(1).max(50),
  kana: z.string().min(1).max(80),
  lineIds: z.array(z.string()).max(50).default([]),
})

// 管理画面用: 全駅の一覧 (lineIds 込み)
app.get('/api/admin/stations', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  const stations = await prisma.station.findMany({
    orderBy: { kana: 'asc' },
    include: {
      lineLinks: { include: { line: true } },
    },
  })
  return c.json({
    stations: stations.map((s) => ({
      id: s.id,
      name: s.name,
      kana: s.kana,
      lineIds: s.lineLinks.map((ll) => ll.line.id),
      lines: s.lineLinks.map((ll) => ({
        id: ll.line.id,
        name: ll.line.name,
        kind: ll.line.kind,
      })),
    })),
  })
})

// lineIds 配列で渡された Line.id がすべて DB に存在するかをチェック。
// 存在しない id があれば最初の 1 件を返す。
async function findMissingLineId(lineIds: string[]): Promise<string | null> {
  if (lineIds.length === 0) return null
  const found = await prisma.line.findMany({
    where: { id: { in: lineIds } },
    select: { id: true },
  })
  const foundSet = new Set(found.map((l) => l.id))
  for (const id of lineIds) {
    if (!foundSet.has(id)) return id
  }
  return null
}

app.post('/api/admin/stations', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const parsed = StationCreateInput.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }
  const lineIds = Array.from(new Set(parsed.data.lineIds))
  const missing = await findMissingLineId(lineIds)
  if (missing) {
    return c.json({ error: 'unknown_line', lineId: missing }, 400)
  }

  try {
    const created = await prisma.station.create({
      data: {
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        name: parsed.data.name,
        kana: parsed.data.kana,
        lineLinks: {
          create: lineIds.map((lineId) => ({ lineId })),
        },
      },
      include: { lineLinks: { include: { line: true } } },
    })
    return c.json(
      {
        id: created.id,
        name: created.name,
        kana: created.kana,
        lineIds: created.lineLinks.map((ll) => ll.line.id),
      },
      201,
    )
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return c.json({ error: 'duplicate' }, 409)
    }
    throw e
  }
})

app.put('/api/admin/stations/:id', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  const id = c.req.param('id')
  const existing = await prisma.station.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'not_found' }, 404)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const parsed = StationUpdate.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      400,
    )
  }
  const lineIds = Array.from(new Set(parsed.data.lineIds))
  const missing = await findMissingLineId(lineIds)
  if (missing) {
    return c.json({ error: 'unknown_line', lineId: missing }, 400)
  }

  // ADR 0006 §5: 駅名変更でも既存 RouteSegment.fromStation/toStation は追従させない。
  // 名称変更は Station.name のみに反映する。StationLine は deleteMany + create で全置換。
  const updated = await prisma.station.update({
    where: { id },
    data: {
      name: parsed.data.name,
      kana: parsed.data.kana,
      lineLinks: {
        deleteMany: {},
        create: lineIds.map((lineId) => ({ lineId })),
      },
    },
    include: { lineLinks: { include: { line: true } } },
  })

  return c.json({
    id: updated.id,
    name: updated.name,
    kana: updated.kana,
    lineIds: updated.lineLinks.map((ll) => ll.line.id),
  })
})

app.delete('/api/admin/stations/:id', async (c) => {
  const adminGuard = await requireAdmin(c)
  if (adminGuard) return adminGuard

  const id = c.req.param('id')
  const existing = await prisma.station.findUnique({ where: { id } })
  if (!existing) return c.json({ error: 'not_found' }, 404)

  // ADR 0006 §4: 駅削除は無制約。RouteSegment.fromStation/toStation は文字列複製で
  // 外部キーが無いため壊れない。StationLine は onDelete: Cascade で連鎖削除される。
  await prisma.station.delete({ where: { id } })
  return c.body(null, 204)
})
