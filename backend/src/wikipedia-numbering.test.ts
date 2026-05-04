import { describe, it, expect } from 'vitest'
import {
  parseWikipediaNumbering,
  normalizeWikipediaStationName,
  planWikipediaFills,
  fetchWikipediaNumberingWikitext,
  _internal,
} from '../scripts/lib/wikipedia-numbering.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

describe('normalizeWikipediaStationName (US-047)', () => {
  it('末尾「駅」を除去', () => {
    expect(normalizeWikipediaStationName('名古屋駅')).toBe('名古屋')
    expect(normalizeWikipediaStationName('豊橋駅')).toBe('豊橋')
  })
  it('既に「駅」が無い場合はそのまま', () => {
    expect(normalizeWikipediaStationName('豊橋')).toBe('豊橋')
  })
  it('空白を trim', () => {
    expect(normalizeWikipediaStationName('  名古屋駅  ')).toBe('名古屋')
  })
})

describe('extractWikilinkDisplay (US-047)', () => {
  it('[[A|B]] → B', () => {
    expect(_internal.extractWikilinkDisplay('[[名古屋駅|名古屋]]')).toBe('名古屋')
  })
  it('[[A]] → A', () => {
    expect(_internal.extractWikilinkDisplay('[[名古屋駅]]')).toBe('名古屋駅')
  })
  it('普通文字列はそのまま', () => {
    expect(_internal.extractWikilinkDisplay('名古屋駅')).toBe('名古屋駅')
  })
})

describe('parseWikipediaNumbering (US-047)', () => {
  it('実際の駅ナンバリングページ形式: 箇条書き行から「駅 (CODE)」を全部抽出', () => {
    // 実際の Wikipedia 駅ナンバリングページに近い箇条書きパターン
    const wikitext = `
== 中部地方 ==

=== JR東海 ===
*[[File:JR Central Tokaido Line.svg|28px|CA]] 東海道線：[[熱海駅]] (CA00) - [[豊橋駅]] (CA42) - [[米原駅]] (CA83)

=== 名古屋市営地下鉄 ===
* [[File:Nagoya Subway Logo V2 (Higashiyama Line).svg|28px|H]] [[名古屋市営地下鉄東山線|東山線]]（'''H'''igashiyama）[[高畑駅]] (H01) - [[藤が丘駅 (愛知県)|藤が丘駅]] (H22)
** [[File:Nagoya Subway Logo V2 (Meiko Line).svg|28px|E]] 名港線（M'''E'''ikō）金山駅 (E01) - [[名古屋港駅 (名古屋市営地下鉄)|名古屋港駅]] (E07)

=== 名鉄 ===
* [[File:MT number-NH.svg|28px|NH]] [[名鉄名古屋本線|名古屋本線]]（'''N'''agoya）[[豊橋駅]] (NH01) - [[名鉄岐阜駅]] (NH60)
`
    const entries = parseWikipediaNumbering(wikitext)
    const byCode = new Map(entries.map((e) => [e.code, e]))

    // JR東海道線
    expect(byCode.get('CA00')?.stationName).toBe('熱海駅')
    expect(byCode.get('CA42')?.stationName).toBe('豊橋駅')
    expect(byCode.get('CA83')?.stationName).toBe('米原駅')
    // 東山線
    expect(byCode.get('H01')?.stationName).toBe('高畑駅')
    expect(byCode.get('H22')?.stationName).toBe('藤が丘駅') // wikilink label
    // 名港線 — wikilink, 平文名混在
    expect(byCode.get('E01')?.stationName).toBe('金山駅') // 平文 (リンク無し)
    expect(byCode.get('E07')?.stationName).toBe('名古屋港駅')
    // 名鉄名古屋本線
    expect(byCode.get('NH01')?.stationName).toBe('豊橋駅')
    expect(byCode.get('NH60')?.stationName).toBe('名鉄岐阜駅')
  })

  it('全角カッコでも CODE を抽出できる (Wikipedia は混在)', () => {
    const wikitext = '* [[豊橋駅]]（NH01） - [[岐阜]]（NH60）'
    const entries = parseWikipediaNumbering(wikitext)
    expect(entries.map((e) => e.code).sort()).toEqual(['NH01', 'NH60'])
  })

  it('prefix と数字の間にハイフン/空白があっても正規化', () => {
    const wikitext = '* [[名古屋駅]] (CA-68) - [[豊橋駅]] (CA 42)'
    const entries = parseWikipediaNumbering(wikitext)
    expect(entries.map((e) => e.code).sort()).toEqual(['CA42', 'CA68'])
  })

  it('重複は 1 件にまとまる', () => {
    const wikitext = '* [[名古屋駅]] (CA68) と [[名古屋駅]] (CA68) は同じ駅'
    const entries = parseWikipediaNumbering(wikitext)
    expect(entries).toHaveLength(1)
  })

  it('駅番号パターンを含まない行はスキップ', () => {
    const wikitext = `
== 概要 ==
駅ナンバリングは...

== 路線記号 ==
路線記号は...
`
    const entries = parseWikipediaNumbering(wikitext)
    expect(entries).toHaveLength(0)
  })

  it('wikilink label 優先 (label が無ければ target)', () => {
    const wikitext = '* [[名古屋駅|名古屋]] (CA68) - [[豊橋駅]] (CA42)'
    const entries = parseWikipediaNumbering(wikitext)
    expect(entries.find((e) => e.code === 'CA68')?.stationName).toBe('名古屋')
    expect(entries.find((e) => e.code === 'CA42')?.stationName).toBe('豊橋駅')
  })
})

describe('planWikipediaFills (US-047)', () => {
  const prefixesByLine = new Map<string, Set<string>>([
    ['Q11235139', new Set(['CA'])], // JR東海道線 (名古屋地区)
    ['Q1078110', new Set(['CF'])], // JR中央本線
    ['Q1132799', new Set(['H'])], // 東山線
  ])
  const stationsByName = new Map<
    string,
    Array<{ id: string; lineLinks: Array<{ lineId: string; code: string }> }>
  >([
    [
      '名古屋',
      [
        {
          id: 'Q-NAGOYA',
          lineLinks: [
            { lineId: 'Q11235139', code: '' }, // 空 → 補完候補
            { lineId: 'Q1078110', code: '' }, // 空
            { lineId: 'Q1132799', code: 'H08' }, // 既存値 → 上書きしない
          ],
        },
      ],
    ],
    [
      '千種',
      [
        {
          id: 'Q863068',
          lineLinks: [
            { lineId: 'Q1078110', code: 'CF03' }, // 既存
            { lineId: 'Q1132799', code: '' }, // 空
          ],
        },
      ],
    ],
  ])

  it('prefix と Line の対応で空 code を補完する計画を作る', () => {
    const entries = [
      { prefix: 'CA', code: 'CA68', stationName: '名古屋', sectionTitle: 't' },
      { prefix: 'H', code: 'H12', stationName: '千種', sectionTitle: 't' },
    ]
    const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
    const byKey = new Map(
      fills.map((f) => [`${f.stationId}|${f.lineId}`, f]),
    )
    expect(byKey.get('Q-NAGOYA|Q11235139')?.code).toBe('CA68')
    expect(byKey.get('Q863068|Q1132799')?.code).toBe('H12')
  })

  it('既存 code は上書きしない', () => {
    const entries = [
      { prefix: 'H', code: 'H99', stationName: '名古屋', sectionTitle: 't' },
    ]
    const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
    // 名古屋の Q1132799 は既に "H08" → fill 対象にしない
    expect(fills).toHaveLength(0)
  })

  it('該当駅が見つからない場合はスキップ', () => {
    const entries = [
      { prefix: 'CA', code: 'CA01', stationName: '存在しない駅', sectionTitle: 't' },
    ]
    const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
    expect(fills).toHaveLength(0)
  })

  it('prefix が学習済み Line のいずれにも一致しなければスキップ', () => {
    const entries = [
      { prefix: 'XY', code: 'XY01', stationName: '名古屋', sectionTitle: 't' },
    ]
    const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
    expect(fills).toHaveLength(0)
  })

  it('同一 (station, line) の重複は 1 件のみ', () => {
    const entries = [
      { prefix: 'CA', code: 'CA68', stationName: '名古屋', sectionTitle: 't' },
      { prefix: 'CA', code: 'CA68', stationName: '名古屋', sectionTitle: 't' },
    ]
    const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
    expect(fills).toHaveLength(1)
  })
})

describe('fetchWikipediaNumberingWikitext (US-047)', () => {
  it('キャッシュが新鮮なら fetch を呼ばずキャッシュ内容を返す', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-test-'))
    try {
      await fs.writeFile(
        path.join(tmp, 'numbering.wikitext'),
        '== cached content ==',
        'utf8',
      )
      let fetchCalled = false
      const fakeFetch = async () => {
        fetchCalled = true
        return new Response('fail', { status: 500 })
      }
      const got = await fetchWikipediaNumberingWikitext(
        tmp,
        fakeFetch as unknown as typeof fetch,
      )
      expect(got).toBe('== cached content ==')
      expect(fetchCalled).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('キャッシュ無し時は fetch を呼んで結果をキャッシュに書く', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-test-'))
    try {
      const fakeFetch = async (_url: unknown, _init?: unknown) => {
        return new Response(
          JSON.stringify({ parse: { wikitext: '== fresh ==' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      const got = await fetchWikipediaNumberingWikitext(
        tmp,
        fakeFetch as unknown as typeof fetch,
      )
      expect(got).toBe('== fresh ==')
      const cached = await fs.readFile(
        path.join(tmp, 'numbering.wikitext'),
        'utf8',
      )
      expect(cached).toBe('== fresh ==')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('API が wikitext を返さない場合はエラー', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-test-'))
    try {
      const fakeFetch = async () =>
        new Response(JSON.stringify({ error: 'unknown' }), { status: 200 })
      await expect(
        fetchWikipediaNumberingWikitext(
          tmp,
          fakeFetch as unknown as typeof fetch,
        ),
      ).rejects.toThrow(/no wikitext/)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
