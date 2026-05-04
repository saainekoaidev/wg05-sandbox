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
  katakanaToHiragana,
  stripEkiSuffix,
  isLikelyStationNumber,
  codePrefix,
  parseWktPoint,
  haversineMeters,
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

describe('katakanaToHiragana (US-027)', () => {
  it('カタカナ全種をひらがなに変換', () => {
    expect(katakanaToHiragana('ナゴヤドーム')).toBe('なごやどーむ')
    expect(katakanaToHiragana('リニモ')).toBe('りにも')
  })
  it('ひらがな・漢字・英数字はそのまま', () => {
    expect(katakanaToHiragana('なごや')).toBe('なごや')
    expect(katakanaToHiragana('名古屋')).toBe('名古屋')
    expect(katakanaToHiragana('JR1')).toBe('JR1')
  })
  it('混在もカタカナ部のみ変換', () => {
    expect(katakanaToHiragana('ナゴヤ駅')).toBe('なごや駅')
  })
})

describe('inferKana early-return (US-027)', () => {
  // pure ひらがな or ひらがな+カタカナ は kuroshiro 初期化を回避できる早期 return パス。
  // kuroshiro 本体の動作は import スクリプト実行時に検証する (重いので unit には含めない)。
  it('pure ひらがな name はそのまま採用 (えき除去)', async () => {
    const { inferKana } = await import('../scripts/import-master-tokai.js')
    expect(await inferKana('いりなか')).toBe('いりなか')
    expect(await inferKana('かなやまえき')).toBe('かなやま')
  })
  it('ひらがな+カタカナのみは katakana→hiragana 変換', async () => {
    const { inferKana } = await import('../scripts/import-master-tokai.js')
    expect(await inferKana('ナゴヤ')).toBe('なごや')
  })
  it('空文字は空文字を返す', async () => {
    const { inferKana } = await import('../scripts/import-master-tokai.js')
    expect(await inferKana('')).toBe('')
  })
})

describe('parseWktPoint / haversineMeters (US-041 / ADR 0012)', () => {
  it('Wikidata の Point(lon lat) リテラルを解析', () => {
    expect(parseWktPoint('Point(136.937 35.19)')).toEqual({
      lon: 136.937,
      lat: 35.19,
    })
    expect(parseWktPoint('Point(-122.4 37.77)')).toEqual({
      lon: -122.4,
      lat: 37.77,
    })
  })
  it('不正値 / undefined は null', () => {
    expect(parseWktPoint(undefined)).toBeNull()
    expect(parseWktPoint('not a point')).toBeNull()
    expect(parseWktPoint('')).toBeNull()
  })
  it('haversine 距離 (大曽根の 2 エンティティは 0m)', () => {
    const a = { lon: 136.937, lat: 35.19 }
    expect(haversineMeters(a, a)).toBe(0)
  })
  it('haversine 距離 (名古屋駅の半径 ≒ 数百m)', () => {
    // Q110799384 (JR東海) と Q56611989 (地下鉄) の座標差
    const jrtokai = { lon: 136.8809575, lat: 35.17075 }
    const subway = { lon: 136.883889, lat: 35.171111 }
    const d = haversineMeters(jrtokai, subway)
    expect(d).toBeGreaterThan(100) // > 100m
    expect(d).toBeLessThan(500) // < 500m
  })
})

describe('codePrefix (US-040 / ADR 0011)', () => {
  it('英字 + 数字 → 英字部分を大文字で返す', () => {
    expect(codePrefix('CF03')).toBe('CF')
    expect(codePrefix('NH34')).toBe('NH')
    expect(codePrefix('h12')).toBe('H')
  })
  it('純数字は空文字 (prefix 判定対象外)', () => {
    expect(codePrefix('23')).toBe('')
    expect(codePrefix('')).toBe('')
  })
  it('英字のみは prefix そのもの', () => {
    expect(codePrefix('AAA')).toBe('AAA')
  })
})

describe('isLikelyStationNumber (US-037 / ADR 0009)', () => {
  it('現代の駅番号 (英数 + 記号) は採用', () => {
    expect(isLikelyStationNumber('CA68')).toBe(true)
    expect(isLikelyStationNumber('JY01')).toBe(true)
    expect(isLikelyStationNumber('CA66/CC00')).toBe(true)
    expect(isLikelyStationNumber('L-31')).toBe(true)
    expect(isLikelyStationNumber('A.1')).toBe(true)
  })
  it('電報略号 (カタカナ) は除外', () => {
    expect(isLikelyStationNumber('カカ')).toBe(false)
    expect(isLikelyStationNumber('オキ')).toBe(false)
    expect(isLikelyStationNumber('ヲキ')).toBe(false)
    expect(isLikelyStationNumber('ナヤ')).toBe(false)
  })
  it('英数 + カタカナ混在も除外 (filter は AND ではなく英数のみ)', () => {
    expect(isLikelyStationNumber('CA13カカ')).toBe(false)
  })
  it('ひらがな / 漢字 / 全角 を含む値は除外', () => {
    expect(isLikelyStationNumber('かなやま')).toBe(false)
    expect(isLikelyStationNumber('名古屋')).toBe(false)
    expect(isLikelyStationNumber('ABC１')).toBe(false)
  })
  it('空文字は false (採用しない)', () => {
    expect(isLikelyStationNumber('')).toBe(false)
  })
})

describe('stripEkiSuffix (US-027)', () => {
  it('末尾えきを除去', () => {
    expect(stripEkiSuffix('かなやまえき')).toBe('かなやま')
    expect(stripEkiSuffix('なごやえき')).toBe('なごや')
  })
  it('末尾でなければ残す', () => {
    expect(stripEkiSuffix('えきまえ')).toBe('えきまえ')
    expect(stripEkiSuffix('なごや')).toBe('なごや')
  })
  it('空文字は空のまま', () => {
    expect(stripEkiSuffix('')).toBe('')
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
  it('同じ駅が複数回 (P81 で複数路線) 出現しても 1 件にまとめ links を集約', async () => {
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
    const lineIds = stations[0]!.links.map((l) => l.lineId).sort()
    expect(lineIds).toEqual(['Q-LINE-A', 'Q-LINE-B'])
    // code は SPARQL に stationCode が無いので全て空文字
    for (const link of stations[0]!.links) expect(link.code).toBe('')
  })

  it('対象外路線へのリンクは links に含めない (ADR 0007 §3.5)', async () => {
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
    expect(stations[0]!.links.map((l) => l.lineId)).toEqual(['Q-TARGET'])
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

  it('US-023: kana が無い場合は空文字 (漢字フォールバックは廃止)', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S2' },
        stationLabel: { value: '近鉄名古屋駅' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.kana).toBe('')
  })

  it('US-023: kana が Wikidata から取れた場合はそれを保持', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S3' },
        stationLabel: { value: '名古屋駅' },
        stationKana: { value: 'なごや' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.kana).toBe('なごや')
  })

  it('US-027: Wikidata の kana が「〜えき」で終わる場合はえき除去', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-K' },
        stationLabel: { value: '金山駅' },
        stationKana: { value: 'かなやまえき' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.kana).toBe('かなやま')
  })

  it('US-033: stationCode が無い駅は links 全件 code 空文字', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NOCODE' },
        stationLabel: { value: '駅A' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.links).toEqual([{ lineId: 'Q-T', code: '' }])
  })

  it('US-033: qualifier P81 付き stationCode は対応路線の link.code に格納', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NAGOYA' },
        stationLabel: { value: '名古屋駅' },
        stationCode: { value: 'CA68' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NAGOYA' },
        stationLabel: { value: '名古屋駅' },
        stationCode: { value: 'CC00' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T2' },
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    expect(stations).toHaveLength(1)
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-T1')).toBe('CA68')
    expect(linkMap.get('Q-T2')).toBe('CC00')
  })

  it('US-039: qualifier P518 付き stationCode も対応路線の link.code に格納 (千種パターン)', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-CHIKUSA' },
        stationLabel: { value: '千種駅' },
        stationCode: { value: 'H12' },
        qLineByP518: { value: 'http://www.wikidata.org/entity/Q-HIGASHIYAMA' },
        line: { value: 'http://www.wikidata.org/entity/Q-HIGASHIYAMA' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-CHIKUSA' },
        stationLabel: { value: '千種駅' },
        stationCode: { value: 'CF03' }, // qualifier 無し
        line: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-CHUO', 'Q-HIGASHIYAMA'],
      fakeFetcher as never,
    )
    expect(stations).toHaveLength(1)
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    // H12 は qualifier 付きで東山線、CF03 は unattached だが「未埋め lineLink が 1 (中央線)」なので
    // ADR 0010 §2 により残り 1 lineLink へ自動割当
    expect(linkMap.get('Q-HIGASHIYAMA')).toBe('H12')
    expect(linkMap.get('Q-CHUO')).toBe('CF03')
  })

  it('US-039 / ADR 0010 §1: 単独路線駅 + qualifier 無し → 採用', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-KAMBARA' },
        stationLabel: { value: '蒲原駅' },
        stationCode: { value: 'CA11' }, // qualifier 無し
        line: { value: 'http://www.wikidata.org/entity/Q-TOKAIDO' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-TOKAIDO'],
      fakeFetcher as never,
    )
    expect(stations[0]!.links).toEqual([{ lineId: 'Q-TOKAIDO', code: 'CA11' }])
  })

  it('US-039 / ADR 0010 §3: 複数路線 + 全 unattached + 2 件以上 → ambiguous でスキップ', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-AMBIG' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'AA01' }, // qualifier 無し
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-AMBIG' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'BB02' }, // qualifier 無し (もう1件)
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    // どっちが T1 か T2 か断定できないので両方空文字
    expect(linkMap.get('Q-T1')).toBe('')
    expect(linkMap.get('Q-T2')).toBe('')
  })

  it('US-040 / ADR 0011: prefix 学習で「両 unattached + 両 unfilled」が自動割当される (大曽根パターン)', async () => {
    // 第 1 パスで他駅から学習: Q-OTHER-CHUO (中央線) で CF09, Q-OTHER-SETO (瀬戸線) で ST04
    // → prefixesByLine[Q-CHUO] = {"CF"}, prefixesByLine[Q-SETO] = {"ST"}
    // 第 2 パスで Q-OZONE (両 unattached: CF04, ST06) を prefix で振り分け
    const fakeFetcher = async () => [
      // 学習データ: CF09 を中央線 (qualifier 付き)
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OTHER-CHUO' },
        stationLabel: { value: '高蔵寺' },
        stationCode: { value: 'CF09' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
        line: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
      },
      // 学習データ: ST04 を瀬戸線 (qualifier 付き)
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OTHER-SETO' },
        stationLabel: { value: '尾張瀬戸' },
        stationCode: { value: 'ST04' },
        qLineByP518: { value: 'http://www.wikidata.org/entity/Q-SETO' },
        line: { value: 'http://www.wikidata.org/entity/Q-SETO' },
      },
      // 大曽根: 両 unattached
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OZONE' },
        stationLabel: { value: '大曽根' },
        stationCode: { value: 'CF04' },
        line: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OZONE' },
        stationLabel: { value: '大曽根' },
        stationCode: { value: 'ST06' },
        line: { value: 'http://www.wikidata.org/entity/Q-SETO' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-CHUO', 'Q-SETO'],
      fakeFetcher as never,
    )
    const ozone = stations.find((s) => s.id === 'Q-OZONE')!
    const linkMap = new Map(ozone.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-CHUO')).toBe('CF04')
    expect(linkMap.get('Q-SETO')).toBe('ST06')
  })

  it('US-040: 学習データが無い prefix は ADR 0010 §3 にフォールバック (空)', async () => {
    const fakeFetcher = async () => [
      // 学習データなし
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NEW' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'XX01' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NEW' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'YY02' },
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    // prefix XX/YY のどちらも学習データに無いので fallback (両 unfilled + 両 unattached → 空)
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-T1')).toBe('')
    expect(linkMap.get('Q-T2')).toBe('')
  })

  it('US-040: prefix が複数 lineLink にマッチする場合は (a) でなく fallback', async () => {
    // CF prefix を 2 路線に学習させ、ambiguous を作る
    const fakeFetcher = async () => [
      // Q-T1 で "CF99" を学習
      {
        station: { value: 'http://www.wikidata.org/entity/Q-LEARN1' },
        stationLabel: { value: '学1' },
        stationCode: { value: 'CF99' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      // Q-T2 でも "CF98" を学習 (同じ prefix CF を共有する仮想ケース)
      {
        station: { value: 'http://www.wikidata.org/entity/Q-LEARN2' },
        stationLabel: { value: '学2' },
        stationCode: { value: 'CF98' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T2' },
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
      // 対象駅: 両 unattached + prefix CF
      {
        station: { value: 'http://www.wikidata.org/entity/Q-AMBIG2' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'CF01' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-AMBIG2' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'CF02' },
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    const ambig = stations.find((s) => s.id === 'Q-AMBIG2')!
    const linkMap = new Map(ambig.links.map((l) => [l.lineId, l.code]))
    // prefix CF が両 lineLink にマッチするので (a) はスキップ → fallback (空)
    expect(linkMap.get('Q-T1')).toBe('')
    expect(linkMap.get('Q-T2')).toBe('')
  })

  it('US-041 / ADR 0012: P138 (named after) リンクで 2 Q-ID が 1 駅にマージされる (大曽根パターン)', async () => {
    // Q110831202 (名城線) が P138 で Q872075 (JR/名鉄) を参照 → 同一物理駅としてマージ。
    // 大曽根の CF04/ST06 を正しい lineLink に割り当てるため、他駅の qualifier 付き code で
    // CF/ST prefix を学習させる (US-040 prefix routing 連動).
    const fakeFetcher = async () => [
      // 学習データ: 他駅の qualifier 付き CF / ST
      {
        station: { value: 'http://www.wikidata.org/entity/Q-LEARN-CHUO' },
        stationLabel: { value: '高蔵寺' },
        stationCode: { value: 'CF09' },
        coord: { value: 'Point(137.0 35.25)' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
        line: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-LEARN-SETO' },
        stationLabel: { value: '尾張瀬戸' },
        stationCode: { value: 'ST20' },
        coord: { value: 'Point(137.1 35.25)' },
        qLineByP518: { value: 'http://www.wikidata.org/entity/Q-SETO' },
        line: { value: 'http://www.wikidata.org/entity/Q-SETO' },
      },
      // Q872075 (canonical 候補): JR + 名鉄、両 unattached
      {
        station: { value: 'http://www.wikidata.org/entity/Q872075' },
        stationLabel: { value: '大曽根駅' },
        stationCode: { value: 'CF04' },
        coord: { value: 'Point(136.937 35.19)' },
        line: { value: 'http://www.wikidata.org/entity/Q-CHUO' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q872075' },
        stationLabel: { value: '大曽根駅' },
        stationCode: { value: 'ST06' },
        coord: { value: 'Point(136.937 35.19)' },
        line: { value: 'http://www.wikidata.org/entity/Q-SETO' },
      },
      // Q110831202 (名城線): P138 で Q872075 を参照
      {
        station: { value: 'http://www.wikidata.org/entity/Q110831202' },
        stationLabel: { value: '名古屋市営地下鉄大曽根駅' },
        stationCode: { value: 'M12' },
        coord: { value: 'Point(136.937 35.19)' },
        namedAfter: { value: 'http://www.wikidata.org/entity/Q872075' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-MEIJO' },
        line: { value: 'http://www.wikidata.org/entity/Q-MEIJO' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-CHUO', 'Q-SETO', 'Q-MEIJO'],
      fakeFetcher as never,
    )
    // canonical = Q872075 (P138 で参照されているため)。Q110831202 は merged.
    expect(stations).toHaveLength(3) // 大曽根 + 2 学習データ駅
    const ozone = stations.find((s) => s.id === 'Q872075')!
    expect(ozone).toBeDefined()
    const linkMap = new Map(ozone.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-MEIJO')).toBe('M12')
    expect(linkMap.get('Q-CHUO')).toBe('CF04')
    expect(linkMap.get('Q-SETO')).toBe('ST06')
    // Q110831202 が単独 station として残っていないこと
    expect(stations.find((s) => s.id === 'Q110831202')).toBeUndefined()
  })

  it('US-041: 同名 + 座標距離 < 500m のエンティティもマージ (名古屋駅パターン)', async () => {
    // 5 エンティティが半径 約 300m 以内に存在 → 1 駅にマージ
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-A' },
        stationLabel: { value: '名古屋駅' },
        stationCode: { value: 'NH36' },
        coord: { value: 'Point(136.8838763 35.1695461)' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-MEITETSU' },
        line: { value: 'http://www.wikidata.org/entity/Q-MEITETSU' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-B' },
        stationLabel: { value: 'JR東海名古屋駅' },
        stationCode: { value: 'CA68' },
        coord: { value: 'Point(136.8809575 35.17075)' },
        line: { value: 'http://www.wikidata.org/entity/Q-TOKAIDO' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-C' },
        stationLabel: { value: '名古屋市営地下鉄名古屋駅' },
        stationCode: { value: 'H08' },
        coord: { value: 'Point(136.883889 35.171111)' },
        qLineByP518: { value: 'http://www.wikidata.org/entity/Q-HIGASHIYAMA' },
        line: { value: 'http://www.wikidata.org/entity/Q-HIGASHIYAMA' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-MEITETSU', 'Q-TOKAIDO', 'Q-HIGASHIYAMA'],
      fakeFetcher as never,
    )
    // 全 3 エンティティが正規化後 "名古屋" + 座標 < 500m → 1 駅にマージ
    expect(stations).toHaveLength(1)
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-MEITETSU')).toBe('NH36')
    expect(linkMap.get('Q-TOKAIDO')).toBe('CA68')
    expect(linkMap.get('Q-HIGASHIYAMA')).toBe('H08')
  })

  it('US-041: 同名でも座標距離が遠ければマージしない', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-NAGOYA-A' },
        stationLabel: { value: '中央駅' }, // 全く別の都市の同名駅を想定
        stationCode: { value: 'A1' },
        coord: { value: 'Point(136.88 35.17)' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OTHER' },
        stationLabel: { value: '中央駅' },
        stationCode: { value: 'B1' },
        // 約 100km 離れた座標
        coord: { value: 'Point(138.0 35.0)' },
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    expect(stations).toHaveLength(2)
  })

  it('US-041: 座標欠落エンティティは (b) でマージしない (P138 リンクのみ有効)', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-A' },
        stationLabel: { value: '同名駅' },
        // coord 欠落
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-B' },
        stationLabel: { value: '同名駅' },
        // こちらも coord 欠落
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    // 同名でも座標が無いので merge しない
    expect(stations).toHaveLength(2)
  })

  it('US-039: 完全 unattached 複数路線駅 (qualifier 一切無し + 2 路線) は安全側で空のまま', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-FULL' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'XY99' }, // qualifier 無し
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-FULL' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'XY99' }, // 同じ値が別 line 行で再出現 (Wikidata 特性)
        line: { value: 'http://www.wikidata.org/entity/Q-T2' },
      },
    ]
    const stations = await fetchStationsForLines(
      ['Q-T1', 'Q-T2'],
      fakeFetcher as never,
    )
    // 未埋め lineLink == 2 件 + unattached == 1 件 → ADR 0010 §3 ambiguous → 両方空。
    // (どちらの路線の駅番号か断定できないため、安全側で空文字。
    //  人が編集しないと埋まらないが、これは Wikidata 側の qualifier 整備が追いつくまでの過渡的状態。)
    const linkMap = new Map(stations[0]!.links.map((l) => [l.lineId, l.code]))
    expect(linkMap.get('Q-T1')).toBe('')
    expect(linkMap.get('Q-T2')).toBe('')
  })

  it('US-037: 電報略号 (カタカナ) は code から除外される', async () => {
    const fakeFetcher = async () => [
      // 同じ駅×路線で 駅番号 (CA13) と 電報略号 (オキ, ヲキ) が混在するパターン
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OKITSU' },
        stationLabel: { value: '興津駅' },
        stationCode: { value: 'CA13' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OKITSU' },
        stationLabel: { value: '興津駅' },
        stationCode: { value: 'オキ' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-OKITSU' },
        stationLabel: { value: '興津駅' },
        stationCode: { value: 'ヲキ' },
        line: { value: 'http://www.wikidata.org/entity/Q-T' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T'], fakeFetcher as never)
    expect(stations[0]!.links).toEqual([{ lineId: 'Q-T', code: 'CA13' }])
  })

  it('US-037: qualifier 付き code でも電報略号は除外', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-S' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'CC01' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        // 同じ路線への qualifier 付きカタカナ値
        station: { value: 'http://www.wikidata.org/entity/Q-S' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'カカ' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T1'], fakeFetcher as never)
    expect(stations[0]!.links).toEqual([{ lineId: 'Q-T1', code: 'CC01' }])
  })

  it('US-033: 同一 (station, line) ペアに複数 qualifier 付き code は "/" sort 連結', async () => {
    const fakeFetcher = async () => [
      {
        station: { value: 'http://www.wikidata.org/entity/Q-MULTI' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'CC00' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
      {
        station: { value: 'http://www.wikidata.org/entity/Q-MULTI' },
        stationLabel: { value: '駅' },
        stationCode: { value: 'CA68' },
        qLineByP81: { value: 'http://www.wikidata.org/entity/Q-T1' },
        line: { value: 'http://www.wikidata.org/entity/Q-T1' },
      },
    ]
    const stations = await fetchStationsForLines(['Q-T1'], fakeFetcher as never)
    expect(stations[0]!.links).toEqual([{ lineId: 'Q-T1', code: 'CA68/CC00' }])
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
        links: [
          { lineId: 'Q-IMP', code: 'CA68' },
          { lineId: 'manual-line', code: '' },
        ],
      },
    ])

    const links = await prisma.stationLine.findMany({
      where: { stationId: 'Q-S' },
    })
    // ADR 0007 §3.5: 取り込み対象路線への接続のみ含める
    expect(links.map((l) => l.lineId)).toEqual(['Q-IMP'])
    expect(links[0]!.code).toBe('CA68')
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
        links: [{ lineId: 'Q-A', code: '' }],
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
        links: [{ lineId: 'Q-B', code: '' }],
      },
    ])
    expect(
      (await prisma.stationLine.findMany({ where: { stationId: 'Q-S' } })).map(
        (l) => l.lineId,
      ),
    ).toEqual(['Q-B'])
  })

  it('US-033: 路線ごとの code が StationLine.code に保存される (新規/更新の両方)', async () => {
    await upsertLines([
      { id: 'Q-L1', name: 'L1', kind: 'train', operator: 'X', sourceUri: 'https://x/L1' },
      { id: 'Q-L2', name: 'L2', kind: 'train', operator: 'X', sourceUri: 'https://x/L2' },
    ])
    // 新規時: 路線ごとに異なる code
    await upsertStationsAndLinks([
      {
        id: 'Q-NAG',
        name: '名古屋',
        kana: 'なごや',
        sourceUri: 'https://x/NAG',
        links: [
          { lineId: 'Q-L1', code: 'CA68' },
          { lineId: 'Q-L2', code: 'CC00' },
        ],
      },
    ])
    const after1 = await prisma.stationLine.findMany({
      where: { stationId: 'Q-NAG' },
      orderBy: { lineId: 'asc' },
    })
    expect(after1.map((l) => [l.lineId, l.code])).toEqual([
      ['Q-L1', 'CA68'],
      ['Q-L2', 'CC00'],
    ])

    // 更新時: code を変更 + 1 路線削除
    await upsertStationsAndLinks([
      {
        id: 'Q-NAG',
        name: '名古屋',
        kana: 'なごや',
        sourceUri: 'https://x/NAG',
        links: [{ lineId: 'Q-L1', code: 'CA68/CC00' }],
      },
    ])
    const after2 = await prisma.stationLine.findMany({
      where: { stationId: 'Q-NAG' },
    })
    expect(after2.map((l) => [l.lineId, l.code])).toEqual([['Q-L1', 'CA68/CC00']])
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
        links: [{ lineId: 'Q-IMP', code: '' }],
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
