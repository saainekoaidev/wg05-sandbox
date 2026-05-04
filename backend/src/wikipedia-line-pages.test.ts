import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  parseStationCodesFromLineArticle,
  fetchLineArticle,
  getJaWikipediaTitle,
  fetchPageWikitext,
} from '../scripts/lib/wikipedia-line-pages.js'

describe('parseStationCodesFromLineArticle (US-048)', () => {
  it('!CA68 / |[[駅名]] 形式 (JR東海道線スタイル) を抽出', () => {
    const wikitext = `
== 駅一覧 ==
{| class="wikitable"
|-
!駅番号
!駅名
!営業キロ
|-
!CA68
|[[名古屋駅]] {{JR特定都区市内|名}}
|261.4
|-
!CA67
|[[尾頭橋駅]]
|259.0
|-
!CA66
|[[金山駅 (愛知県)|金山]]駅
|258.4
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    const byCode = new Map(entries.map((e) => [e.code, e]))
    expect(byCode.get('CA68')?.stationName).toBe('名古屋駅')
    expect(byCode.get('CA67')?.stationName).toBe('尾頭橋駅')
    expect(byCode.get('CA66')?.stationName).toBe('金山駅') // wikilink label
  })

  it('|セル に駅番号 / 駅名 が並ぶ形式 (名鉄スタイル)', () => {
    const wikitext = `
== 駅一覧 ==
{| class="wikitable"
|-
! 駅番号 !! 駅名
|-
| NH24
| [[中京競馬場前駅]]
|-
| NH36
| [[名鉄名古屋駅|名鉄名古屋]]
|-
| NH01
| [[豊橋駅]]
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    const byCode = new Map(entries.map((e) => [e.code, e]))
    expect(byCode.get('NH24')?.stationName).toBe('中京競馬場前駅')
    expect(byCode.get('NH36')?.stationName).toBe('名鉄名古屋')
    expect(byCode.get('NH01')?.stationName).toBe('豊橋駅')
  })

  it('テンプレート {{JR特定都区市内|名}} を駅名から除去', () => {
    const wikitext = `
{| class="wikitable"
|-
!CA68
|[[名古屋駅]] {{JR特定都区市内|名}}
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    expect(entries[0]?.stationName).toBe('名古屋駅')
    expect(entries[0]?.stationName).not.toMatch(/特定/)
  })

  it('属性付きセル (style="..."|値) を正しく剥がす', () => {
    const wikitext = `
{| class="wikitable"
|-
!style="background:#ff8c00;"|CA68
|[[名古屋駅]]
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    expect(entries[0]?.code).toBe('CA68')
  })

  it('数値のみセル / 単位付セルは駅名候補から除外', () => {
    const wikitext = `
{| class="wikitable"
|-
!CA68
|261.4
|2.4
|[[名古屋駅]]
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    expect(entries[0]?.stationName).toBe('名古屋駅')
  })

  it('CODE が無い行はスキップ', () => {
    const wikitext = `
{| class="wikitable"
|-
| 数値ヘッダ
| データ
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    expect(entries).toEqual([])
  })

  it('複数 prefix が混在する場合 (例: 中央本線記事に JC + CF が並ぶ) も全部取れる', () => {
    const wikitext = `
{| class="wikitable"
|-
!JC24
|[[高尾駅]]
|-
!CF03
|[[千種駅]]
|-
!CF04
|[[大曽根駅]]
|}
`
    const entries = parseStationCodesFromLineArticle(wikitext)
    const codes = entries.map((e) => e.code).sort()
    expect(codes).toEqual(['CF03', 'CF04', 'JC24'])
  })
})

describe('fetch helpers (US-048)', () => {
  it('getJaWikipediaTitle は Wikidata sitelink から ja タイトルを返す', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          entities: {
            Q11235139: {
              sitelinks: { jawiki: { title: '東海道線 (名古屋地区)' } },
            },
          },
        }),
        { status: 200 },
      )
    const t = await getJaWikipediaTitle(
      'Q11235139',
      fakeFetch as unknown as typeof fetch,
    )
    expect(t).toBe('東海道線 (名古屋地区)')
  })

  it('getJaWikipediaTitle は sitelink が無いと null', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({ entities: { Q1: { sitelinks: {} } } }),
        { status: 200 },
      )
    const t = await getJaWikipediaTitle(
      'Q1',
      fakeFetch as unknown as typeof fetch,
    )
    expect(t).toBeNull()
  })

  it('fetchPageWikitext は parse.wikitext を返す', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({ parse: { wikitext: '== 駅一覧 ==' } }),
        { status: 200 },
      )
    const t = await fetchPageWikitext(
      '東海道線',
      fakeFetch as unknown as typeof fetch,
    )
    expect(t).toBe('== 駅一覧 ==')
  })

  it('fetchLineArticle はキャッシュ優先', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-line-'))
    try {
      const cached = { title: 'Cached Article', wikitext: 'cached body' }
      await fs.writeFile(
        path.join(tmp, 'Q11235139.json'),
        JSON.stringify(cached),
        'utf8',
      )
      let fetchCalled = false
      const fakeFetch = async () => {
        fetchCalled = true
        return new Response('fail', { status: 500 })
      }
      const got = await fetchLineArticle(
        'Q11235139',
        tmp,
        fakeFetch as unknown as typeof fetch,
      )
      expect(got).toEqual(cached)
      expect(fetchCalled).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('fetchLineArticle はキャッシュ無し時に Wikidata + Wikipedia 両方 fetch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-line-'))
    try {
      let fetchSeq = 0
      const fakeFetch = async (url: string | URL) => {
        const u = url.toString()
        fetchSeq++
        if (u.includes('wikidata.org')) {
          return new Response(
            JSON.stringify({
              entities: {
                Q1: { sitelinks: { jawiki: { title: 'TestTitle' } } },
              },
            }),
            { status: 200 },
          )
        }
        if (u.includes('ja.wikipedia.org')) {
          return new Response(
            JSON.stringify({ parse: { wikitext: '== 駅一覧 ==' } }),
            { status: 200 },
          )
        }
        return new Response('?', { status: 404 })
      }
      const got = await fetchLineArticle(
        'Q1',
        tmp,
        fakeFetch as unknown as typeof fetch,
      )
      expect(got).toEqual({ title: 'TestTitle', wikitext: '== 駅一覧 ==' })
      expect(fetchSeq).toBe(2)
      // キャッシュにも書かれているか
      const cached = JSON.parse(
        await fs.readFile(path.join(tmp, 'Q1.json'), 'utf8'),
      )
      expect(cached.title).toBe('TestTitle')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
