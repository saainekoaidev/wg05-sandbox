import { Hono } from 'hono'
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
      lines: s.lineLinks.map((ll) => ({
        id: ll.line.id,
        name: ll.line.name,
        kind: ll.line.kind,
        operator: ll.line.operator,
      })),
    })),
  })
})
