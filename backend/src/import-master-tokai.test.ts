import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  fetchJRLines,
  fetchOtherLines,
  fetchStationsForLines,
  upsertLines,
  upsertStationsAndLinks,
  cleanImported,
  normalizeStationName,
  ensureJRPrefix,
  JR_LINE_QIDS,
  DENY_LINE_QIDS,
  OTHER_OPERATORS,
} from '../scripts/import-master-tokai.js'
import { prisma } from './db.js'

// テスト前後で Wikidata 由来分のみクリーン (手動 admin データには触らない)
beforeEach(async () => {
  await prisma.stationLine.deleteMany()
  await prisma.routeSegment.deleteMany()
  await prisma.route.deleteMany()
  await prisma.station.deleteMany()
  await prisma.line.deleteMany()
  await prisma.user.deleteMany()
  await prisma.verification.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeStationName (US-011)', () => {
  it('JR東海 prefix と 駅 suffix を除去', () => {
    expect(normalizeStationName('JR東海名古屋駅')).toBe('名古屋')
  })
  it('近鉄 prefix と 駅 suffix を除去', () => {
    expect(normalizeStationName('近鉄名古屋駅')).toBe('名古屋')
  })
  it('名古屋市営地下鉄 prefix を除去', () => {
    expect(normalizeStationName('名古屋市営地下鉄大曽根駅')).toBe('大曽根')
  })
  it('JR東海交通事業 prefix も除去対象', () => {
    expect(normalizeStationName('JR東海交通事業比良駅')).toBe('比良')
  })
  it('プレフィックスのない駅もそのまま (駅 suffix のみ除去)', () => {
    expect(normalizeStationName('豊橋駅')).toBe('豊橋')
  })
  it('「ヶ丘駅」のような駅 suffix も除去 (ヶ丘部分は残る)', () => {
    expect(normalizeStationName('星ヶ丘駅')).toBe('星ヶ丘')
  })
  it('全部消えそうなときは元の文字列を返す (安全側)', () => {
    expect(normalizeStationName('駅')).toBe('駅')
  })
  it('空白 trim も行う', () => {
    expect(normalizeStationName(' 浜松駅 ')).toBe('浜松')
  })
})

describe('ensureJRPrefix (US-018)', () => {
  it('JR 始まりでなければ "JR" を付ける', () => {
    expect(ensureJRPrefix('中央本線')).toBe('JR中央本線')
    expect(ensureJRPrefix('東海道線 (静岡地区)')).toBe('JR東海道線 (静岡地区)')
    expect(ensureJRPrefix('名松線')).toBe('JR名松線')
  })
  it('JR 始まりなら二重付与しない', () => {
    expect(ensureJRPrefix('JR東海交通事業城北線')).toBe('JR東海交通事業城北線')
    expect(ensureJRPrefix('JR中央本線')).toBe('JR中央本線')
  })
})

describe('fetchJRLines (US-011 JR ホワイトリスト + US-018 JR プレフィックス)', () => {
  it('14 路線分のレコードを Q-ID 直指定で返し operator=JR東海 で固定 + JR プレフィックス付与', async () => {
    const fakeFetcher = async () => [
      { line: { value: 'http://www.wikidata.org/entity/Q11527981' }, lineLabel: { value: '東海道線 (静岡地区)' } },
      { line: { value: 'http://www.wikidata.org/entity/Q1078110' }, lineLabel: { value: '中央本線' } },
      { line: { value: 'http://www.wikidata.org/entity/Q5359442' }, lineLabel: { value: '名松線' } },
      { line: { value: 'http://www.wikidata.org/entity/Q7862680' }, lineLabel: { value: 'JR東海交通事業城北線' } },
    ]
    const lines = await fetchJRLines(fakeFetcher as never)
    expect(lines).toHaveLength(4)
    for (const l of lines) {
      expect(l.operator).toBe('JR東海')
      expect(l.kind).toBe('train')
      expect(l.sourceUri).toContain('https://www.wikidata.org/wiki/')
      expect(l.id.startsWith('Q')).toBe(true)
      // US-018: 全 JR 路線が "JR" で始まる
      expect(l.name.startsWith('JR')).toBe(true)
    }
    // 元の name に "JR" が無ければ付与, あれば二重付与しない
    expect(lines[0]!.name).toBe('JR東海道線 (静岡地区)')
    expect(lines[1]!.name).toBe('JR中央本線')
    expect(lines[2]!.name).toBe('JR名松線')
    expect(lines[3]!.name).toBe('JR東海交通事業城北線')
  })

  it('JR_LINE_QIDS に 14 個含まれる', () => {
    expect(JR_LINE_QIDS).toHaveLength(14)
    expect(new Set(JR_LINE_QIDS).size).toBe(14) // 重複なし
  })
})

describe('fetchOtherLines (US-011 事業者ベース)', () => {
  it('複数事業者にマッチした路線は OTHER_OPERATORS 順で先頭優先', async () => {
    const sameLineUri = 'http://www.wikidata.org/entity/Q123'
    const fakeFetcher = async () => [
      // 同じ ?line に対して 2 つの operator がマッチ
      {
        line: { value: sameLineUri },
        lineLabel: { value: 'テスト路線' },
        operator: { value: `http://www.wikidata.org/entity/${OTHER_OPERATORS[2]!.qid}` }, // 名古屋市交通局 (idx=2)
        stationCount: { value: '5' },
      },
      {
        line: { value: sameLineUri },
        lineLabel: { value: 'テスト路線' },
        operator: { value: `http://www.wikidata.org/entity/${OTHER_OPERATORS[0]!.qid}` }, // 名鉄 (idx=0)
        stationCount: { value: '5' },
      },
    ]
    const lines = await fetchOtherLines(fakeFetcher as never)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.operator).toBe(OTHER_OPERATORS[0]!.name) // 名鉄が優先
    expect(lines[0]!.kind).toBe(OTHER_OPERATORS[0]!.kind)
  })

  it('denylist の路線 (廃線 Q7476121) は除外される', async () => {
    const denyQid = Array.from(DENY_LINE_QIDS)[0]!
    const fakeFetcher = async () => [
      {
        line: { value: `http://www.wikidata.org/entity/${denyQid}` },
        lineLabel: { value: '廃線テスト' },
        operator: { value: `http://www.wikidata.org/entity/${OTHER_OPERATORS[0]!.qid}` },
        stationCount: { value: '5' },
      },
      {
        line: { value: 'http://www.wikidata.org/entity/Q999' },
        lineLabel: { value: '生きている路線' },
        operator: { value: `http://www.wikidata.org/entity/${OTHER_OPERATORS[0]!.qid}` },
        stationCount: { value: '5' },
      },
    ]
    const lines = await fetchOtherLines(fakeFetcher as never)
    expect(lines.map((l) => l.id)).toEqual(['Q999'])
  })

  it('運営会社が名古屋市交通局なら kind=subway', async () => {
    const fakeFetcher = async () => [
      {
        line: { value: 'http://www.wikidata.org/entity/Q1' },
        lineLabel: { value: '東山線' },
        operator: { value: 'http://www.wikidata.org/entity/Q841951' },
        stationCount: { value: '22' },
      },
    ]
    const lines = await fetchOtherLines(fakeFetcher as never)
    expect(lines[0]!.kind).toBe('subway')
  })

  it('運営会社が他なら kind=train', async () => {
    const fakeFetcher = async () => [
      {
        line: { value: 'http://www.wikidata.org/entity/Q1' },
        lineLabel: { value: '名鉄' },
        operator: { value: 'http://www.wikidata.org/entity/Q30850' },
        stationCount: { value: '5' },
      },
    ]
    const lines = await fetchOtherLines(fakeFetcher as never)
    expect(lines[0]!.kind).toBe('train')
  })
})

describe('fetchStationsForLines', () => {
  it('同じ駅が複数回 (P81 で複数路線) 出現しても 1 件にまとめ lineIds を集約', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NAGOYA' },
        stationLabel: { value: 'JR東海名古屋駅' },
        line: { value: 'http://www.wikidata.org/entity/Q-LINE-A' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NAGOYA' },
        stationLabel: { value: 'JR東海名古屋駅' },
        line: { value: 'http://www.wikidata.org/entity/Q-LINE-B' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-LINE-A', 'Q-LINE-B'],
      fakeFetcher as never,
    )
    expect(stations).toHaveLength(1)
    expect(stations[0]!.id).toBe('Q-NAGOYA')
    // 名前は normalize されている
    expect(stations[0]!.name).toBe('名古屋')
    expect(stations[0]!.lineIds.sort()).toEqual(['Q-LINE-A', 'Q-LINE-B'])
  })

  it('lineIds の対象外路線へのリンクは取り込まれない (ADR 0007 §3.5)', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S1' },
        stationLabel: { value: 'テスト駅' },
        line: { value: 'http://www.wikidata.org/entity/Q-TARGET' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S1' },
        stationLabel: { value: 'テスト駅' },
        // 対象外路線
        line: { value: 'http://www.wikidata.org/entity/Q-OUTSCOPE' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-TARGET'], fakeFetcher as never)
    expect(stations[0]!.lineIds).toEqual(['Q-TARGET'])
  })

  it('lineIds が空なら早期 return で fetcher を呼ばない', async () => {
    let called = false
    const fakeFetcher = async () => {
      called = true
      return []
    }
    const stations = await fetchStationsForLines([], fakeFetcher as never)
    expect(stations).toEqual([])
    expect(called).toBe(false)
  })

  it('kana が無い場合は normalize 済み name でフォールバック', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S2' },
        stationLabel: { value: '近鉄名古屋駅' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.kana).toBe('名古屋')
  })
})

describe('upsertLines', () => {
  it('新規作成と更新を区別してカウントする', async () => {
    const lines = [
      {
        id: 'Q-NEW',
        name: '新規',
        kind: 'train' as const,
        operator: 'JR東海',
        sourceUri: 'https://example/Q-NEW',
      },
    ]
    const r1 = await upsertLines(lines)
    expect(r1).toEqual({ created: 1, updated: 0 })

    const r2 = await upsertLines(lines)
    expect(r2).toEqual({ created: 0, updated: 1 })

    const stored = await prisma.line.findUnique({ where: { id: 'Q-NEW' } })
    expect(stored?.sourceUri).toBe('https://example/Q-NEW')
    expect(stored?.importedAt).toBeTruthy()
  })

  it('subway kind が DB に保存される', async () => {
    await upsertLines([
      {
        id: 'Q-SUB',
        name: '東山線',
        kind: 'subway',
        operator: '名古屋市交通局',
        sourceUri: 'https://example/Q-SUB',
      },
    ])
    const stored = await prisma.line.findUnique({ where: { id: 'Q-SUB' } })
    expect(stored?.kind).toBe('subway')
  })
})

describe('upsertStationsAndLinks', () => {
  it('Wikidata 由来 Line とのリンクのみが StationLine に登録される', async () => {
    // 取り込み対象路線 (sourceUri NOT NULL)
    await upsertLines([
      {
        id: 'Q-IMP',
        name: '取り込み路線',
        kind: 'train',
        operator: 'JR東海',
        sourceUri: 'https://example/Q-IMP',
      },
    ])
    // 手動作成路線 (sourceUri NULL): admin 画面で作ったケースを模擬
    await prisma.line.create({
      data: {
        id: 'manual-line',
        name: '手動路線',
        kind: 'train',
        operator: '手動',
        // sourceUri / importedAt は NULL
      },
    })

    await upsertStationsAndLinks([
      {
        id: 'Q-S',
        name: 'テスト駅',
        kana: 'てすと',
        sourceUri: 'https://example/Q-S',
        // 取り込み対象 Q-IMP と 手動 manual-line の両方に紐付け
        lineIds: ['Q-IMP', 'manual-line'],
      },
    ])

    const links = await prisma.stationLine.findMany({
      where: { stationId: 'Q-S' },
    })
    // ADR 0007 §3.5: 取り込み対象路線への接続のみ含める
    expect(links.map((l) => l.lineId)).toEqual(['Q-IMP'])
  })

  it('再実行時は既存 StationLine を全置換する (deleteMany + create)', async () => {
    await upsertLines([
      { id: 'Q-A', name: 'A', kind: 'train', operator: 'X', sourceUri: 'https://x/A' },
      { id: 'Q-B', name: 'B', kind: 'train', operator: 'X', sourceUri: 'https://x/B' },
    ])
    // 1 回目: A のみリンク
    await upsertStationsAndLinks([
      {
        id: 'Q-S',
        name: 's',
        kana: 's',
        sourceUri: 'https://x/S',
        lineIds: ['Q-A'],
      },
    ])
    expect(
      (await prisma.stationLine.findMany({ where: { stationId: 'Q-S' } })).map(
        (l) => l.lineId,
      ),
    ).toEqual(['Q-A'])

    // 2 回目: B のみに変更
    await upsertStationsAndLinks([
      {
        id: 'Q-S',
        name: 's',
        kana: 's',
        sourceUri: 'https://x/S',
        lineIds: ['Q-B'],
      },
    ])
    expect(
      (await prisma.stationLine.findMany({ where: { stationId: 'Q-S' } })).map(
        (l) => l.lineId,
      ),
    ).toEqual(['Q-B'])
  })
})

describe('cleanImported', () => {
  it('sourceUri NOT NULL の Line/Station のみ削除し、手動分は残す', async () => {
    // Wikidata 由来
    await upsertLines([
      {
        id: 'Q-IMP',
        name: 'imp',
        kind: 'train',
        operator: 'X',
        sourceUri: 'https://x/IMP',
      },
    ])
    // 手動
    await prisma.line.create({
      data: {
        id: 'manual',
        name: 'manual',
        kind: 'train',
      },
    })
    await prisma.station.create({
      data: { id: 'manual-stn', name: 'M', kana: 'm' },
    })
    // Wikidata 由来 station
    await upsertStationsAndLinks([
      {
        id: 'Q-S',
        name: 's',
        kana: 's',
        sourceUri: 'https://x/S',
        lineIds: ['Q-IMP'],
      },
    ])

    const r = await cleanImported()
    expect(r.deletedLines).toBe(1)
    expect(r.deletedStations).toBe(1)

    expect(await prisma.line.findUnique({ where: { id: 'manual' } })).not.toBeNull()
    expect(
      await prisma.station.findUnique({ where: { id: 'manual-stn' } }),
    ).not.toBeNull()
    expect(await prisma.line.findUnique({ where: { id: 'Q-IMP' } })).toBeNull()
    expect(await prisma.station.findUnique({ where: { id: 'Q-S' } })).toBeNull()
  })
})
