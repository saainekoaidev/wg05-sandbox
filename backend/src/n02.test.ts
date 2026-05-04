import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  N02_BBOX,
  N02_MATCH_THRESHOLD_M,
  loadN02Stations,
  normalizeLineName,
  lineNamesMatch,
  normalizeN02StationName,
  planN02Merge,
} from '../scripts/lib/n02.js'

describe('normalizeLineName (US-045 / ADR 0016)', () => {
  it('JR プレフィックスを除去', () => {
    expect(normalizeLineName('JR東海道線')).toBe('東海道線')
    expect(normalizeLineName('JR中央本線')).toBe('中央本線')
  })
  it('末尾の (XX地区) を除去', () => {
    expect(normalizeLineName('JR東海道線 (名古屋地区)')).toBe('東海道線')
    expect(normalizeLineName('JR東海道線 (静岡地区)')).toBe('東海道線')
  })
  it('JR でも括弧でもない名前はそのまま', () => {
    expect(normalizeLineName('東海道本線')).toBe('東海道本線')
    expect(normalizeLineName('名鉄名古屋本線')).toBe('名鉄名古屋本線')
  })
})

describe('lineNamesMatch (US-045)', () => {
  it('完全一致は true', () => {
    expect(lineNamesMatch('東海道本線', '東海道本線')).toBe(true)
  })
  it('Wikidata "JR東海道線 (名古屋地区)" と N02 "東海道本線" を本線/線揺らぎとして同定', () => {
    expect(lineNamesMatch('JR東海道線 (名古屋地区)', '東海道本線')).toBe(true)
    expect(lineNamesMatch('JR東海道線 (静岡地区)', '東海道本線')).toBe(true)
  })
  it('JR + 本線/線 揺らぎ', () => {
    expect(lineNamesMatch('JR中央本線', '中央線')).toBe(true)
  })
  it('まったく違う路線は false', () => {
    expect(lineNamesMatch('JR中央本線', '名鉄名古屋本線')).toBe(false)
    expect(lineNamesMatch('東海道本線', '紀勢本線')).toBe(false)
  })
  it('空文字は false', () => {
    expect(lineNamesMatch('', '東海道本線')).toBe(false)
    expect(lineNamesMatch('東海道本線', '')).toBe(false)
  })
})

describe('normalizeN02StationName (US-045)', () => {
  it('事業者プレフィックスと末尾「駅」を除去', () => {
    expect(normalizeN02StationName('JR東海名古屋駅')).toBe('名古屋')
    expect(normalizeN02StationName('近鉄名古屋駅')).toBe('名古屋')
    expect(normalizeN02StationName('名古屋市営地下鉄大曽根駅')).toBe('大曽根')
  })
  it('プレフィックスのない名前はそのまま (駅 suffix のみ除去)', () => {
    expect(normalizeN02StationName('豊橋駅')).toBe('豊橋')
    expect(normalizeN02StationName('豊橋')).toBe('豊橋')
  })
  it('全部消える時は元の値', () => {
    expect(normalizeN02StationName('駅')).toBe('駅')
  })
})

describe('loadN02Stations (US-045)', () => {
  it('存在しないディレクトリでは空配列', async () => {
    const stations = await loadN02Stations('/non/existent/path')
    expect(stations).toEqual([])
  })

  it('GeoJSON Point feature を 4 県 bbox 内のみ取り込む', async () => {
    // 一時ディレクトリに mock GeoJSON を書く
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'n02-test-'))
    try {
      const fc = {
        type: 'FeatureCollection',
        features: [
          // 名古屋駅 (愛知, bbox 内)
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [136.881, 35.171] },
            properties: {
              N02_001: '12',
              N02_003: '東海旅客鉄道',
              N02_004: '東海道本線',
              N02_005: '名古屋',
            },
          },
          // 東京駅 (bbox 外, 経度 139.77 > N02_BBOX.lonMax=139.5)
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [139.7672, 35.6812] },
            properties: {
              N02_001: '12',
              N02_003: '東日本旅客鉄道',
              N02_004: '東海道本線',
              N02_005: '東京',
            },
          },
          // 路線セクション (LineString) は無視される
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [136.88, 35.17],
                [136.89, 35.18],
              ],
            },
            properties: {
              N02_001: '12',
              N02_003: '東海旅客鉄道',
              N02_004: '東海道本線',
            },
          },
          // properties 不完全 (路線名なし) は無視
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [136.9, 35.18] },
            properties: { N02_005: '駅名のみ' },
          },
        ],
      }
      await fs.writeFile(
        path.join(tmp, 'mock.geojson'),
        JSON.stringify(fc),
        'utf8',
      )
      const stations = await loadN02Stations(tmp)
      expect(stations).toHaveLength(1)
      expect(stations[0]!.name).toBe('名古屋')
      expect(stations[0]!.lineName).toBe('東海道本線')
      expect(stations[0]!.operator).toBe('東海旅客鉄道')
      expect(stations[0]!.lon).toBeCloseTo(136.881)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('破損 JSON はスキップして他のファイルを読み続ける', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'n02-test-'))
    try {
      await fs.writeFile(path.join(tmp, 'broken.geojson'), 'not json{{{')
      const fc = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [136.881, 35.171] },
            properties: {
              N02_003: '東海旅客鉄道',
              N02_004: '中央本線',
              N02_005: '名古屋',
            },
          },
        ],
      }
      await fs.writeFile(path.join(tmp, 'good.geojson'), JSON.stringify(fc))
      const stations = await loadN02Stations(tmp)
      expect(stations).toHaveLength(1)
      expect(stations[0]!.lineName).toBe('中央本線')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('planN02Merge (US-045)', () => {
  const lines = [
    { id: 'Q11235139', name: 'JR東海道線 (名古屋地区)', operator: 'JR東海' },
    { id: 'Q1078110', name: 'JR中央本線', operator: 'JR東海' },
    { id: 'Q-MEITETSU', name: '名鉄名古屋本線', operator: '名古屋鉄道' },
  ]

  it('座標 + 名称一致で attach-line アクションを生成', () => {
    const wd = [
      // 名古屋駅 (Wikidata) at (136.881, 35.171), 座標あり
      {
        id: 'Q-NAGOYA-WD',
        name: '名古屋',
        lon: 136.881,
        lat: 35.171,
      },
    ]
    const n02 = [
      {
        name: '名古屋',
        lineName: '東海道本線', // → JR東海道線 (名古屋地区) と lineNamesMatch
        operator: '東海旅客鉄道',
        lon: 136.882, // 100m 程度離れた位置
        lat: 35.171,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'attach-line',
      stationId: 'Q-NAGOYA-WD',
      lineId: 'Q11235139',
    })
  })

  it('座標距離が threshold (200m) を超えると attach せず create-station にフォールバック', () => {
    const wd = [
      { id: 'Q-A', name: '同名駅', lon: 136.0, lat: 35.0 },
    ]
    const n02 = [
      {
        name: '同名駅',
        lineName: 'JR中央本線',
        operator: 'JR東海',
        // 約 30km 離れた位置
        lon: 136.3,
        lat: 35.0,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.type).toBe('create-station')
  })

  it('Line がスコープ外 (Wikidata Line にマッチしない) なら何もしない', () => {
    const wd = [{ id: 'Q-A', name: '某駅', lon: 136.0, lat: 35.0 }]
    const n02 = [
      {
        name: '某駅',
        lineName: '長良川鉄道越美南線', // ホワイトリスト外
        operator: '長良川鉄道',
        lon: 136.0,
        lat: 35.0,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions).toEqual([])
  })

  it('Wikidata に無い駅 + 既知 Line → create-station アクション (駅 suffix は normalizer で除去される)', () => {
    const wd: { id: string; name: string; lon: number | null; lat: number | null }[] = []
    const n02 = [
      {
        name: '新規駅',
        lineName: '東海道本線',
        operator: '東海旅客鉄道',
        lon: 136.5,
        lat: 35.0,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'create-station',
      // normalizeN02StationName で 末尾「駅」が除去される
      name: '新規',
      lineId: 'Q11235139',
    })
  })

  it('Wikidata 駅の座標が null なら attach できないので create-station 扱い', () => {
    const wd = [
      // 座標なし
      { id: 'Q-NOCOORD', name: '名古屋', lon: null, lat: null },
    ]
    const n02 = [
      {
        name: '名古屋',
        lineName: '東海道本線',
        operator: '東海旅客鉄道',
        lon: 136.881,
        lat: 35.171,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions[0]?.type).toBe('create-station')
  })

  it('同じ (station, line) ペアの重複 attach は 1 件のみ', () => {
    const wd = [{ id: 'Q-X', name: '駅', lon: 136.0, lat: 35.0 }]
    const n02 = [
      {
        name: '駅',
        lineName: '東海道本線',
        operator: 'op',
        lon: 136.0,
        lat: 35.0,
      },
      {
        name: '駅',
        lineName: '東海道本線', // 同じ路線の重複 row
        operator: 'op',
        lon: 136.0,
        lat: 35.0,
      },
    ]
    const actions = planN02Merge(n02, wd, lines)
    expect(actions).toHaveLength(1)
  })
})

describe('N02_BBOX / N02_MATCH_THRESHOLD_M 定数', () => {
  it('bbox は 4 県を覆う妥当な範囲', () => {
    expect(N02_BBOX.lonMin).toBeLessThan(135.6) // 三重県西端
    expect(N02_BBOX.lonMax).toBeGreaterThan(139.0) // 静岡県東端
    expect(N02_BBOX.latMin).toBeLessThan(33.8) // 三重県南端
    expect(N02_BBOX.latMax).toBeGreaterThan(36.6) // 岐阜県北端
  })
  it('突合距離は 200m', () => {
    expect(N02_MATCH_THRESHOLD_M).toBe(200)
  })
})
