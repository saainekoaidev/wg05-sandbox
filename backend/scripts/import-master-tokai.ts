/**
 * 東海4県マスタ取り込みスクリプト (US-011 / US-027)。
 *
 * docs/adr/0007-tokai-import-spec.md に従い、Wikidata SPARQL から
 * 名古屋圏の路線・駅マスタを取り込む。
 *
 * US-027: Wikidata 由来の P1814 (kana) が無い駅は kuroshiro による
 * 漢字→ひらがな変換で kana を自動補完する。
 *
 * 使い方:
 *   pnpm --filter backend exec tsx scripts/import-master-tokai.ts          # 通常実行 (upsert)
 *   pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean  # Wikidata 由来分のみ全削除して再投入
 *
 * 終了コード:
 *   0: 成功
 *   1: SPARQL エラー / DB エラー
 */
import { PrismaClient } from '@prisma/client'
import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// 取り込み対象スコープ (ADR 0007 §1)
// ---------------------------------------------------------------------------

/** JR (路線単位 Q-ID ホワイトリスト, ADR 0007 §1.1)。operator は JR東海 で固定。 */
export const JR_LINE_QIDS: ReadonlyArray<string> = [
  'Q11527981', // 東海道線 (静岡地区) 熱海〜豊橋
  'Q11235139', // 東海道線 (名古屋地区) 豊橋〜米原
  'Q1078110', // 中央本線 (塩尻〜名古屋)
  'Q1199703', // 関西本線
  'Q582803', // 紀勢本線
  'Q1188357', // 高山本線
  'Q871587', // 武豊線
  'Q771305', // 飯田線
  'Q870995', // 太多線
  'Q667927', // 御殿場線
  'Q162747', // 身延線
  'Q872023', // 参宮線
  'Q5359442', // 名松線
  'Q7862680', // JR東海交通事業城北線
]

/** 路線単位 Q-ID denylist (ADR 0007 §1.3) — Wikidata に廃止日 (P576) 無しで自動除外できない廃線。 */
export const DENY_LINE_QIDS: ReadonlySet<string> = new Set([
  'Q7476121', // 名鉄モンキーパークモノレール線 (2008 廃止)
  'Q11415803', // 名鉄鏡島線 (1964 廃止)
])

/**
 * US-042 / ADR 0013: 路線階層エイリアス。
 * Wikidata 上の「親エンティティ Q-ID」(例: Q1190152 = 東海道本線 全国) を
 * 我々の canonical 路線 (Q11235139 = 名古屋地区, Q11527981 = 静岡地区) にマップする。
 * 駅エンティティが地区版ではなく親エンティティにのみ紐付いているケース (例: 金山駅) を救う。
 *
 * 1 つのエイリアス Q-ID が複数 canonical にマップされる場合は disambiguation 条件
 * (lonMax / lonMin の経度範囲) で 1 つに絞る。
 */
export type LineAliasRule = {
  /** Wikidata の P81 値で matching する Q-ID (親エンティティ等) */
  qid: string
  /** 駅座標経度がこの値以下のときだけマップ (= 西側の地区) */
  lonMax?: number
  /** 駅座標経度がこの値以上のときだけマップ (= 東側の地区) */
  lonMin?: number
}

export const LINE_ALIASES: Readonly<Record<string, ReadonlyArray<LineAliasRule>>> =
  {
    // 東海道線 名古屋地区: 親 (Q1190152 = 東海道本線) のうち豊橋以西分を取り込む
    Q11235139: [{ qid: 'Q1190152', lonMax: 137.4 }],
    // 東海道線 静岡地区: 親のうち豊橋以東分を取り込む
    Q11527981: [{ qid: 'Q1190152', lonMin: 137.4 }],
  }

/** その他事業者 (運営者ベース, ADR 0007 §1.2)。順序が同一路線複数事業者時の優先順 (§3.4)。 */
export const OTHER_OPERATORS: ReadonlyArray<{
  qid: string
  name: string
  kind: 'train' | 'subway'
}> = [
  { qid: 'Q30850', name: '名古屋鉄道', kind: 'train' },
  { qid: 'Q1531085', name: '近畿日本鉄道', kind: 'train' },
  { qid: 'Q841951', name: '名古屋市交通局', kind: 'subway' },
  { qid: 'Q10855964', name: '名古屋臨海高速鉄道', kind: 'train' },
  { qid: 'Q11073857', name: '愛知高速交通', kind: 'train' },
]

/** 4 県の Q-ID (ADR 0007 §2)。 */
export const PREF_QIDS: ReadonlyArray<string> = [
  'Q80434', // 愛知県
  'Q131277', // 岐阜県
  'Q128196', // 三重県
  'Q131320', // 静岡県
]

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT =
  'WG05Sandbox/1.0 (https://github.com/saainekoaidev/wg05-sandbox; education sandbox)'

// ---------------------------------------------------------------------------
// SPARQL ヘルパ
// ---------------------------------------------------------------------------

type SparqlBinding = Record<string, { value: string }>

/**
 * SPARQL クエリを実行して bindings を返す。テスト時にモック差し替え可能なよう
 * default 関数として export する。
 */
export async function fetchSparql(query: string): Promise<SparqlBinding[]> {
  const url = new URL(SPARQL_ENDPOINT)
  url.searchParams.set('query', query)
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
  })
  if (!res.ok) {
    throw new Error(
      `SPARQL request failed: HTTP ${res.status} ${await res.text()}`,
    )
  }
  const data = (await res.json()) as { results: { bindings: SparqlBinding[] } }
  return data.results.bindings
}

const qidFromUri = (uri: string) =>
  uri.replace('http://www.wikidata.org/entity/', '')

/**
 * Wikidata の駅名は同名駅区別のため事業者プレフィックスを含むことが多い
 * (例: "JR東海名古屋駅", "近鉄名古屋駅", "名古屋市営地下鉄大曽根駅")。
 * 利用者検索の体感を良くするため、よく使われる事業者プレフィックスと末尾「駅」を除去する。
 *
 * 同名駅が複数事業者で存在するケースは Station レコードを別個に残し、
 * /admin/stations や駅マスタ参照画面で共通名 + 路線で識別する設計とする。
 */
const NAME_PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
  /^JR東海(交通事業)?/,
  /^JR西日本/,
  /^名古屋鉄道/,
  /^名鉄/,
  /^名古屋市営地下鉄/,
  /^名古屋市/,
  /^近畿日本鉄道/,
  /^近鉄/,
  /^あおなみ線/,
  /^名古屋臨海高速鉄道/,
  /^東部丘陵線/,
  /^愛知高速交通/,
]

// US-027: kuroshiro lazy singleton。初期化は kuromoji の辞書ロード (数十 MB) を伴うため重い。
// 取り込み 1 回あたり 1 度だけ初期化する。
let _kuroshiro: { convert: (s: string, opts: { to: string }) => Promise<string> } | null = null
async function getKuroshiro() {
  if (_kuroshiro) return _kuroshiro
  // kuroshiro は CJS export default を持つため `as any` で取得 (ESM/CJS 互換)
  const KuroshiroCtor: new () => {
    init: (a: unknown) => Promise<void>
    convert: (s: string, opts: { to: string }) => Promise<string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = (Kuroshiro as any).default ?? (Kuroshiro as any)
  const k = new KuroshiroCtor()
  await k.init(new KuromojiAnalyzer())
  _kuroshiro = k
  return k
}

/** カタカナをひらがなに変換するシンプルなユーティリティ。 */
export function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}

/**
 * US-027: kana 末尾の「えき」を除去。
 * Wikidata の P1814 が「かなやまえき」と入っているケースや、
 * kuroshiro が「駅」を含んだ name に対して「〜えき」を返すケースに対応。
 */
export function stripEkiSuffix(kana: string): string {
  return kana.replace(/えき$/, '')
}

/**
 * US-037 / ADR 0009: Wikidata P296 の値が「駅番号」(現代の路線記号 + 数字) かを判定する。
 * 半角英数 + ハイフン + スラッシュ + ドット + アンダースコアのみで構成される値を採用。
 * カタカナ/ひらがな/漢字を含む値 (旧国鉄の電報略号: 「カカ」「オキ」「ヲキ」等) は除外する。
 */
export function isLikelyStationNumber(code: string): boolean {
  if (!code) return false
  return /^[A-Za-z0-9._/-]+$/.test(code)
}

/**
 * US-040 / ADR 0011: 駅番号 code の英字 prefix (= 数字以前の部分) を取り出す。
 * 大文字統一。純数字 code (例: "23") では空文字を返し、prefix 判定の対象から外す。
 */
export function codePrefix(code: string): string {
  const m = code.match(/^([A-Za-z]+)/)
  return m ? m[1].toUpperCase() : ''
}

/**
 * US-042 / ADR 0013: 駅の P81 値 (lineQid) を取り込み対象 canonical 路線に正規化する。
 * - lineQid が canonical 集合 (canonicalSet) に直接含まれていればそのまま返す。
 * - 含まれていなければ LINE_ALIASES から候補を引き、disambiguation して 1 つに絞る。
 * - 解決できない場合は null。
 */
export function resolveCanonicalLine(
  lineQid: string,
  canonicalSet: ReadonlySet<string>,
  stationCoord: { lon: number; lat: number } | null,
): string | null {
  if (canonicalSet.has(lineQid)) return lineQid
  const candidates: { canonical: string; rule: LineAliasRule }[] = []
  for (const [canonical, rules] of Object.entries(LINE_ALIASES)) {
    if (!canonicalSet.has(canonical)) continue
    for (const r of rules) {
      if (r.qid === lineQid) candidates.push({ canonical, rule: r })
    }
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!.canonical
  // 複数候補: 座標 disambiguation
  if (stationCoord) {
    for (const c of candidates) {
      if (c.rule.lonMax !== undefined && stationCoord.lon > c.rule.lonMax) continue
      if (c.rule.lonMin !== undefined && stationCoord.lon < c.rule.lonMin) continue
      return c.canonical
    }
  }
  return null
}

/**
 * US-041 / ADR 0012: Wikidata の P625 wkt-literal "Point(lon lat)" を解析。
 * 解析失敗時は null を返す。
 */
export function parseWktPoint(
  wkt: string | undefined | null,
): { lon: number; lat: number } | null {
  if (!wkt) return null
  const m = wkt.match(/^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i)
  if (!m) return null
  const lon = parseFloat(m[1]!)
  const lat = parseFloat(m[2]!)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return { lon, lat }
}

/**
 * US-041 / ADR 0012: 2 点間の球面距離 (m) を Haversine で概算。
 */
export function haversineMeters(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const R = 6371000 // m
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** US-041 / ADR 0012: 同一物理駅とみなす座標距離の閾値 (m)。 */
export const MERGE_COORD_THRESHOLD_M = 500

/**
 * 簡易 Union-Find (driver 同一性のグループ判定用)。
 */
class UnionFind {
  private parent = new Map<string, string>()
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    while (p !== this.parent.get(p)) {
      const gp = this.parent.get(p)!
      this.parent.set(p, this.parent.get(gp)!)
      p = this.parent.get(p)!
    }
    return p
  }
  union(a: string, b: string): void {
    this.add(a)
    this.add(b)
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  /** すべての要素を root ごとにグループ化して返す */
  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const x of this.parent.keys()) {
      const r = this.find(x)
      const arr = out.get(r) ?? []
      arr.push(x)
      out.set(r, arr)
    }
    return out
  }
}

/**
 * US-027: 駅名 (漢字) からひらがな読みを推測する。失敗時は空文字を返す。
 * - 残ったカタカナはひらがなに変換
 * - 結果に漢字が残っていれば変換失敗とみなして空文字
 * - 結果が入力と同じなら変換失敗とみなして空文字
 * - 末尾「えき」は除去
 */
export async function inferKana(name: string): Promise<string> {
  if (!name) return ''
  // name 自体がひらがなのみ (例: 「いりなか」) なら kuroshiro を呼ばずそのまま採用
  if (/^[ぁ-んー]+$/.test(name)) return stripEkiSuffix(name)
  // name がひらがな + カタカナのみ (記号除く) なら katakana → hiragana で kana 化
  if (/^[ぁ-んァ-ヶー]+$/.test(name)) return stripEkiSuffix(katakanaToHiragana(name))
  try {
    const k = await getKuroshiro()
    const raw = await k.convert(name, { to: 'hiragana' })
    if (typeof raw !== 'string' || !raw) return ''
    // 残ったカタカナをひらがなに
    let h = katakanaToHiragana(raw)
    // 入力と同じ (変換が起きなかった) → 失敗とみなす
    if (h === name) return ''
    // 結果に漢字が残っている (変換できなかった部分がある) → 失敗扱い
    if (/[一-鿿]/.test(h)) return ''
    // 末尾「えき」除去
    h = stripEkiSuffix(h)
    return h
  } catch {
    return ''
  }
}

export function normalizeStationName(rawName: string): string {
  let name = rawName.trim()
  for (const re of NAME_PREFIX_PATTERNS) {
    name = name.replace(re, '')
  }
  // 末尾「駅」も除去 (例: "名古屋駅" → "名古屋")
  name = name.replace(/駅$/, '')
  // 残った名前が空文字になった場合は元の値に戻す (安全策)
  return name.trim() || rawName
}

// ---------------------------------------------------------------------------
// 路線取得 (JR ホワイトリスト + その他事業者)
// ---------------------------------------------------------------------------

type FetchedLine = {
  id: string
  name: string
  kind: 'train' | 'subway'
  operator: string
  sourceUri: string
}

/**
 * US-018: JR 路線名に "JR" プレフィックスを付与する。
 * 既に "JR" で始まる name は二重付与しない。
 */
export function ensureJRPrefix(name: string): string {
  return name.startsWith('JR') ? name : `JR${name}`
}

/** ADR 0007 §3.1 JR ホワイトリスト 14 路線を取得。operator は JR東海 で固定。 */
export async function fetchJRLines(
  fetcher: typeof fetchSparql = fetchSparql,
): Promise<FetchedLine[]> {
  const vals = JR_LINE_QIDS.map((q) => `wd:${q}`).join(' ')
  const query = `
SELECT DISTINCT ?line ?lineLabel WHERE {
  VALUES ?line { ${vals} }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
`
  const rows = await fetcher(query)
  return rows.map((r) => {
    const id = qidFromUri(r.line!.value)
    const rawName = r.lineLabel?.value ?? id
    return {
      id,
      // US-018: JR ホワイトリスト分は "JR" プレフィックスを付与
      name: ensureJRPrefix(rawName),
      kind: 'train' as const,
      operator: 'JR東海',
      sourceUri: `https://www.wikidata.org/wiki/${id}`,
    }
  })
}

/** ADR 0007 §3.1 その他事業者 (P127|P137 OR + 4県内駅 ≥ 2 + 廃線除外)。 */
export async function fetchOtherLines(
  fetcher: typeof fetchSparql = fetchSparql,
): Promise<FetchedLine[]> {
  const opVals = OTHER_OPERATORS.map((o) => `wd:${o.qid}`).join(' ')
  const prefVals = PREF_QIDS.map((q) => `wd:${q}`).join(' ')
  const query = `
SELECT DISTINCT ?line ?lineLabel ?operator
       (COUNT(DISTINCT ?station) AS ?stationCount)
WHERE {
  VALUES ?operator { ${opVals} }
  VALUES ?pref { ${prefVals} }
  ?line (wdt:P127|wdt:P137) ?operator ;
        wdt:P31/wdt:P279* wd:Q728937 .
  FILTER NOT EXISTS { ?line wdt:P576 ?dissolved }
  ?station wdt:P81 ?line ;
           wdt:P31/wdt:P279* wd:Q55488 ;
           wdt:P131* ?pref .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
GROUP BY ?line ?lineLabel ?operator
HAVING (COUNT(DISTINCT ?station) >= 2)
`
  const rows = await fetcher(query)
  // 同一路線が複数事業者にマッチした場合は OTHER_OPERATORS 順で先頭優先 (§3.4)
  const opIndex = new Map(OTHER_OPERATORS.map((o, i) => [o.qid, i]))
  const lineMap = new Map<string, { idx: number; raw: SparqlBinding }>()
  for (const r of rows) {
    const lineQid = qidFromUri(r.line!.value)
    if (DENY_LINE_QIDS.has(lineQid)) continue
    const opQid = qidFromUri(r.operator!.value)
    const idx = opIndex.get(opQid) ?? Number.MAX_SAFE_INTEGER
    const existing = lineMap.get(lineQid)
    if (!existing || existing.idx > idx) {
      lineMap.set(lineQid, { idx, raw: r })
    }
  }
  return Array.from(lineMap.entries()).map(([id, { idx, raw }]) => {
    const op = OTHER_OPERATORS[idx]!
    return {
      id,
      name: raw.lineLabel?.value ?? id,
      kind: op.kind,
      operator: op.name,
      sourceUri: `https://www.wikidata.org/wiki/${id}`,
    }
  })
}

// ---------------------------------------------------------------------------
// 駅取得 (取り込み対象路線に紐づく 4 県内駅)
// ---------------------------------------------------------------------------

type FetchedStation = {
  id: string
  name: string
  kana: string
  sourceUri: string
  /**
   * P81 で接続する Line.id のうち, 取り込み対象路線に含まれるもの。
   * US-033 / ADR 0008: 路線ごとに駅番号を持たせるため { lineId, code } のペア配列に変更。
   * code が空文字なら駅番号未設定。
   */
  links: Array<{ lineId: string; code: string }>
}

export async function fetchStationsForLines(
  lineIds: string[],
  fetcher: typeof fetchSparql = fetchSparql,
): Promise<FetchedStation[]> {
  if (lineIds.length === 0) return []
  // US-042 / ADR 0013: alias QID も VALUES に含めて SPARQL で取得対象にする。
  // (駅が canonical Q-ID に直接紐付いていないケースを救うため。)
  const canonicalSet = new Set(lineIds)
  const aliasQids = new Set<string>()
  for (const canonical of lineIds) {
    const rules = LINE_ALIASES[canonical] ?? []
    for (const r of rules) aliasQids.add(r.qid)
  }
  const allLineQids = [...lineIds, ...aliasQids]
  const lineVals = allLineQids.map((q) => `wd:${q}`).join(' ')
  const prefVals = PREF_QIDS.map((q) => `wd:${q}`).join(' ')
  // 駅情報は重複しがち (P81 が複数あり, 4県内駅で複数県マッチ等)。SELECT 後にアプリ層で集約する。
  // US-033 / ADR 0008: P296 は statement node + qualifier (路線対応) で取得し, 駅×路線粒度の
  // 駅番号 (StationLine.code) として割り当てる。
  // US-039 / ADR 0010: 路線対応 qualifier は Wikidata 上で P81 と P518 の両方が使われる
  // (例: 千種駅 H12 は pq:P518 = 東山線)。両方 OPTIONAL で取得し、どちらかでも該当すれば採用する。
  // US-041 / ADR 0012: マージ判定用に P625 (座標) と P138 (名前の由来) も取得する。
  const query = `
SELECT DISTINCT ?station ?stationLabel ?stationKana ?stationCode ?qLineByP81 ?qLineByP518 ?coord ?namedAfter ?line WHERE {
  VALUES ?targetLine { ${lineVals} }
  VALUES ?pref { ${prefVals} }
  ?station wdt:P81 ?targetLine ;
           wdt:P31/wdt:P279* wd:Q55488 ;
           wdt:P131* ?pref ;
           wdt:P81 ?line .
  OPTIONAL { ?station wdt:P1814 ?stationKana }
  OPTIONAL { ?station wdt:P625 ?coord }
  OPTIONAL { ?station wdt:P138 ?namedAfter }
  OPTIONAL {
    ?station p:P296 ?codeStmt .
    ?codeStmt ps:P296 ?stationCode .
    OPTIONAL { ?codeStmt pq:P81  ?qLineByP81  . }
    OPTIONAL { ?codeStmt pq:P518 ?qLineByP518 . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
`
  const rows = await fetcher(query)
  // canonicalSet は上で構築済 (取り込み対象 = 直接 lineIds)
  const targetSet = canonicalSet

  type Acc = {
    name: string
    kana: string
    sourceUri: string
    /** 駅単位の lineId 集合 (取り込み対象に絞った後) */
    lineIds: Set<string>
    /** (station, line) ペア → code 候補集合。"/" 結合前の状態。 */
    codesByLine: Map<string, Set<string>>
    /** qualifier 無し or qualifier が対象外路線の code 集合 */
    unattachedCodes: Set<string>
    /** US-041 / ADR 0012: マージ判定用の座標 (1 駅で複数値があれば後勝ち) */
    coord: { lon: number; lat: number } | null
    /** US-041 / ADR 0012: P138 (名前の由来) リンク先の Q-ID 集合 */
    namedAfter: Set<string>
  }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    const stationQid = qidFromUri(r.station!.value)
    const lineQid = qidFromUri(r.line!.value)
    let a = acc.get(stationQid)
    if (!a) {
      const rawName = r.stationLabel?.value ?? stationQid
      const normalized = normalizeStationName(rawName)
      const kana = stripEkiSuffix(r.stationKana?.value ?? '')
      a = {
        name: normalized,
        kana,
        sourceUri: `https://www.wikidata.org/wiki/${stationQid}`,
        lineIds: new Set(),
        codesByLine: new Map(),
        unattachedCodes: new Set(),
        coord: parseWktPoint(r.coord?.value),
        namedAfter: new Set(),
      }
      acc.set(stationQid, a)
    } else if (a.coord === null) {
      // 初回 row で coord が無くても後の row で取れた場合は補完
      a.coord = parseWktPoint(r.coord?.value)
    }
    if (r.namedAfter?.value) {
      a.namedAfter.add(qidFromUri(r.namedAfter.value))
    }
    // US-042 / ADR 0013: lineQid を canonical 路線に正規化 (alias 経由なら disambiguation)
    const resolvedLine = resolveCanonicalLine(lineQid, canonicalSet, a.coord)
    if (resolvedLine) a.lineIds.add(resolvedLine)
    const codeVal = r.stationCode?.value
    // US-037 / ADR 0009: 電報略号 (カタカナ表記の旧国鉄識別子) は駅番号と区別して除外する
    if (codeVal && isLikelyStationNumber(codeVal)) {
      // US-039 / ADR 0010 / US-042 ADR 0013:
      //   P81 / P518 qualifier も canonical 路線に正規化したうえで採用判定する
      const qP81 = r.qLineByP81?.value ? qidFromUri(r.qLineByP81.value) : null
      const qP518 = r.qLineByP518?.value
        ? qidFromUri(r.qLineByP518.value)
        : null
      const qLineP81 = qP81
        ? resolveCanonicalLine(qP81, canonicalSet, a.coord)
        : null
      const qLineP518 = qP518
        ? resolveCanonicalLine(qP518, canonicalSet, a.coord)
        : null
      const qLine = qLineP81 ?? qLineP518
      if (qLine) {
        const set = a.codesByLine.get(qLine) ?? new Set<string>()
        set.add(codeVal)
        a.codesByLine.set(qLine, set)
      } else {
        // qualifier 無し or qualifier が対象外路線
        a.unattachedCodes.add(codeVal)
      }
    }
  }

  // US-044 / ADR 0015 §B: マージ前に「単独路線 Q-ID + unattached code」を確定。
  // ADR 0010 §1 (lineLink が 1 件のみなら unattached を全部採用) を, ADR 0012 のマージ前に
  // 各 Q-ID 単位で先取り適用する。これにより, あおなみ線名古屋駅 (Q124417968 = lineLink
  // {あおなみ線} のみ + unattached {AN01}) のような単独路線 Q-ID がマージで複数 lineLink
  // に統合された後 ADR 0010 §3 の ambiguous でスキップされる問題を解消する。
  for (const a of acc.values()) {
    if (a.lineIds.size === 1 && a.unattachedCodes.size > 0) {
      const onlyLineId = a.lineIds.values().next().value as string
      const set = a.codesByLine.get(onlyLineId) ?? new Set<string>()
      for (const c of a.unattachedCodes) set.add(c)
      a.codesByLine.set(onlyLineId, set)
      a.unattachedCodes.clear()
    }
  }

  // US-041 / ADR 0012: 同一物理駅とみなせる Q-ID をマージする。
  //   (a) P138 (named after) リンク → 強い signal
  //   (b) 同名 + 座標距離 < MERGE_COORD_THRESHOLD_M → 弱い signal
  // Union-Find で連結成分を作り、各成分を 1 つの canonical Q-ID にまとめる。
  const allQids = Array.from(acc.keys())
  const uf = new UnionFind()
  for (const q of allQids) uf.add(q)
  // (a) P138 リンク
  for (const q of allQids) {
    for (const target of acc.get(q)!.namedAfter) {
      if (acc.has(target)) uf.union(q, target)
    }
  }
  // (b) 同名 + 座標近接 (O(N^2) だが N ~ 800 程度なので問題なし)
  for (let i = 0; i < allQids.length; i++) {
    const qa = allQids[i]!
    const aa = acc.get(qa)!
    if (!aa.coord) continue
    for (let j = i + 1; j < allQids.length; j++) {
      const qb = allQids[j]!
      const ab = acc.get(qb)!
      if (!ab.coord) continue
      if (aa.name !== ab.name) continue
      if (uf.find(qa) === uf.find(qb)) continue // 既に union 済み
      const d = haversineMeters(aa.coord, ab.coord)
      if (d < MERGE_COORD_THRESHOLD_M) uf.union(qa, qb)
    }
  }

  // 各グループから canonical Q-ID を選び、メンバーをマージする。
  const merged = new Map<string, Acc>()
  for (const [, members] of uf.groups()) {
    if (members.length === 1) {
      const q = members[0]!
      merged.set(q, acc.get(q)!)
      continue
    }
    // canonical 選定: 1) 他メンバーから P138 で参照されているものを優先
    //                  2) lineLink 数が最大のもの
    //                  3) Q-ID lex 昇順で先頭
    const memberSet = new Set(members)
    const referenced = members.filter((q) =>
      members.some(
        (other) => other !== q && acc.get(other)!.namedAfter.has(q),
      ),
    )
    let canonical: string
    if (referenced.length > 0) {
      canonical = referenced.sort()[0]!
    } else {
      const sorted = [...members].sort((x, y) => {
        const lx = acc.get(x)!.lineIds.size
        const ly = acc.get(y)!.lineIds.size
        if (lx !== ly) return ly - lx
        return x.localeCompare(y)
      })
      canonical = sorted[0]!
    }
    // マージ: canonical の Acc に他メンバーを取り込む
    const base = acc.get(canonical)!
    const mergedAcc: Acc = {
      name: base.name,
      kana: base.kana,
      sourceUri: base.sourceUri,
      lineIds: new Set(base.lineIds),
      codesByLine: new Map(
        Array.from(base.codesByLine, ([k, v]) => [k, new Set(v)]),
      ),
      unattachedCodes: new Set(base.unattachedCodes),
      coord: base.coord,
      namedAfter: new Set(base.namedAfter),
    }
    for (const q of members) {
      if (q === canonical) continue
      const other = acc.get(q)!
      if (!mergedAcc.kana && other.kana) mergedAcc.kana = other.kana
      for (const id of other.lineIds) mergedAcc.lineIds.add(id)
      for (const [lineId, codes] of other.codesByLine) {
        const set = mergedAcc.codesByLine.get(lineId) ?? new Set<string>()
        for (const c of codes) set.add(c)
        mergedAcc.codesByLine.set(lineId, set)
      }
      for (const c of other.unattachedCodes) mergedAcc.unattachedCodes.add(c)
    }
    merged.set(canonical, mergedAcc)
    void memberSet // (lint: 使わない変数の警告抑止)
  }

  // US-040 / ADR 0011: 第 1 パス完了後, qualifier 付き code から「路線 → prefix 集合」を学習する。
  // この学習データは第 2 パスで unattached code を prefix で割り当てるのに使う。
  // US-041 / ADR 0012: マージ済 (merged) の集約データから学習する。
  const prefixesByLine = new Map<string, Set<string>>()
  for (const a of merged.values()) {
    for (const [lineId, codes] of a.codesByLine) {
      let prefSet = prefixesByLine.get(lineId)
      if (!prefSet) {
        prefSet = new Set<string>()
        prefixesByLine.set(lineId, prefSet)
      }
      for (const c of codes) {
        const p = codePrefix(c)
        if (p) prefSet.add(p)
      }
    }
  }

  return Array.from(merged.entries()).map(([stationQid, a]) => {
    const lineIds = Array.from(a.lineIds)
    const filledLineIds = new Set<string>()
    for (const [lineId, codes] of a.codesByLine) {
      if (codes.size > 0) filledLineIds.add(lineId)
    }
    const unfilledLineIds = lineIds.filter((id) => !filledLineIds.has(id))
    const unattached = Array.from(a.unattachedCodes)

    const baseCode = (lineId: string): Set<string> =>
      new Set<string>(a.codesByLine.get(lineId) ?? [])

    // Disposition: lineId → これから追加すべき code 集合
    const disposition = new Map<string, Set<string>>()
    const remainingUnattached = new Set(unattached)

    // US-040 / ADR 0011 (a): prefix で一意に決まる unattached code を該当 lineLink に振り分け。
    // 「該当駅の未埋め lineLink のうち prefix 集合に含むものが 1 件だけ」のときだけ採用。
    // 0 件なら fallback、2 件以上の場合は曖昧なので fallback。
    if (remainingUnattached.size > 0 && unfilledLineIds.length >= 2) {
      for (const code of Array.from(remainingUnattached)) {
        const p = codePrefix(code)
        if (!p) continue
        const matches = unfilledLineIds.filter((id) =>
          prefixesByLine.get(id)?.has(p),
        )
        if (matches.length === 1) {
          const target = matches[0]!
          let set = disposition.get(target)
          if (!set) {
            set = new Set<string>()
            disposition.set(target, set)
          }
          set.add(code)
          remainingUnattached.delete(code)
        }
      }
    }

    // 残った unattached の処理は ADR 0010 のフォールバック
    if (remainingUnattached.size > 0) {
      // 「(a) で振り分け済の lineLink」を埋まったとみなして再計算する。
      const stillUnfilled = unfilledLineIds.filter(
        (id) => !disposition.has(id),
      )
      if (lineIds.length === 1) {
        // ADR 0010 §1: 単独路線駅
        const target = lineIds[0]!
        let set = disposition.get(target)
        if (!set) {
          set = new Set<string>()
          disposition.set(target, set)
        }
        for (const c of remainingUnattached) set.add(c)
      } else if (stillUnfilled.length === 1) {
        // ADR 0010 §2: 残り未埋め 1 件 → そこへ集約
        const target = stillUnfilled[0]!
        let set = disposition.get(target)
        if (!set) {
          set = new Set<string>()
          disposition.set(target, set)
        }
        for (const c of remainingUnattached) set.add(c)
      }
      // ADR 0010 §3: それ以外は ambiguous でスキップ (何もしない)
    }

    const links = lineIds.map((lineId) => {
      const set = baseCode(lineId)
      const extra = disposition.get(lineId)
      if (extra) for (const c of extra) set.add(c)
      const sorted = Array.from(set).sort()
      return { lineId, code: sorted.join('/') }
    })
    return {
      id: stationQid,
      name: a.name,
      kana: a.kana,
      sourceUri: a.sourceUri,
      links,
    }
  })
}

// ---------------------------------------------------------------------------
// DB 書き込み (upsert)
// ---------------------------------------------------------------------------

export async function upsertLines(lines: FetchedLine[]): Promise<{
  created: number
  updated: number
}> {
  const now = new Date()
  let created = 0
  let updated = 0
  for (const l of lines) {
    const existing = await prisma.line.findUnique({ where: { id: l.id } })
    await prisma.line.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        name: l.name,
        kind: l.kind,
        operator: l.operator,
        sourceUri: l.sourceUri,
        importedAt: now,
      },
      update: {
        name: l.name,
        kind: l.kind,
        operator: l.operator,
        sourceUri: l.sourceUri,
        importedAt: now,
      },
    })
    if (existing) updated++
    else created++
  }
  return { created, updated }
}

export async function upsertStationsAndLinks(
  stations: FetchedStation[],
): Promise<{ created: number; updated: number; links: number }> {
  const now = new Date()
  let created = 0
  let updated = 0
  let links = 0
  // ループの度に prisma.line.findMany を走らせるのは非効率なので 1 度だけ取得する。
  const importedLineIds = (
    await prisma.line.findMany({
      where: { sourceUri: { not: null } },
      select: { id: true },
    })
  ).map((l) => l.id)
  const importedLineSet = new Set(importedLineIds)

  for (const s of stations) {
    const existing = await prisma.station.findUnique({ where: { id: s.id } })
    await prisma.station.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        name: s.name,
        kana: s.kana,
        sourceUri: s.sourceUri,
        importedAt: now,
      },
      update: {
        name: s.name,
        kana: s.kana,
        sourceUri: s.sourceUri,
        importedAt: now,
      },
    })
    if (existing) updated++
    else created++

    // StationLine: 取り込み対象路線への接続を全置換 (sourceUri NOT NULL の Line のみが対象路線)
    await prisma.stationLine.deleteMany({
      where: {
        stationId: s.id,
        lineId: { in: Array.from(importedLineSet) },
      },
    })
    const newLinks = s.links.filter((l) => importedLineSet.has(l.lineId))
    if (newLinks.length > 0) {
      await prisma.stationLine.createMany({
        data: newLinks.map((l) => ({
          stationId: s.id,
          lineId: l.lineId,
          code: l.code,
        })),
      })
      links += newLinks.length
    }
  }
  return { created, updated, links }
}

/**
 * `sourceUri NOT NULL` の Line/Station を全削除する (--clean モード)。
 * StationLine は cascade で連鎖削除される。
 */
export async function cleanImported(): Promise<{
  deletedLines: number
  deletedStations: number
}> {
  const lineRes = await prisma.line.deleteMany({
    where: { sourceUri: { not: null } },
  })
  const stationRes = await prisma.station.deleteMany({
    where: { sourceUri: { not: null } },
  })
  return { deletedLines: lineRes.count, deletedStations: stationRes.count }
}

// ---------------------------------------------------------------------------
// メインエントリ
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const clean = args.includes('--clean')
  // US-047: N02 取り込み (US-045) は US-046 用先行基盤としてデフォルト無効。
  // --with-n02 で明示的に有効化する。
  const withN02 = args.includes('--with-n02')
  // US-047: 既存 N02 由来駅を削除する独立フラグ。--clean とは別に動作可能。
  const cleanN02 = args.includes('--clean-n02')
  // US-047: Wikipedia 駅ナンバリング取り込みはデフォルト ON。--no-wikipedia-numbering で無効化。
  const noWikipediaNumbering = args.includes('--no-wikipedia-numbering')

  const startedAt = Date.now()
  // eslint-disable-next-line no-console
  console.log('== Tokai master import (Wikidata) ==')
  // eslint-disable-next-line no-console
  console.log(
    `Operators: JR東海 (whitelist 14) + ${OTHER_OPERATORS.length} 社 (operator-based)`,
  )
  // eslint-disable-next-line no-console
  console.log(`Prefectures: 4 (愛知, 岐阜, 三重, 静岡)`)
  // eslint-disable-next-line no-console
  console.log(
    `Flags: ${[
      clean && '--clean',
      cleanN02 && '--clean-n02',
      withN02 && '--with-n02',
      noWikipediaNumbering && '--no-wikipedia-numbering',
    ]
      .filter(Boolean)
      .join(' ') || '(none)'}`,
  )

  if (clean) {
    const cleaned = await cleanImported()
    // eslint-disable-next-line no-console
    console.log(
      `\n[--clean] Wikidata 由来分を削除: Line ${cleaned.deletedLines} / Station ${cleaned.deletedStations}`,
    )
  }

  if (cleanN02) {
    const cleanedN02 = await cleanN02Imported()
    // eslint-disable-next-line no-console
    console.log(
      `\n[--clean-n02] N02 由来駅を削除: Station ${cleanedN02.deletedStations}`,
    )
  }

  // eslint-disable-next-line no-console
  console.log('\nFetching JR whitelist (14 lines)...')
  const jr = await fetchJRLines()
  // eslint-disable-next-line no-console
  console.log('Fetching other operator lines...')
  const others = await fetchOtherLines()
  const allLines = [...jr, ...others]
  // eslint-disable-next-line no-console
  console.log(`  Lines fetched: JR=${jr.length} + others=${others.length} = ${allLines.length}`)

  const lineRes = await upsertLines(allLines)
  // eslint-disable-next-line no-console
  console.log(`  Lines: created ${lineRes.created} / updated ${lineRes.updated}`)

  // eslint-disable-next-line no-console
  console.log('\nFetching stations for all imported lines...')
  const stations = await fetchStationsForLines(allLines.map((l) => l.id))
  // eslint-disable-next-line no-console
  console.log(`  Stations fetched: ${stations.length}`)

  // US-027: kana が空の駅は kuroshiro でひらがな自動補完
  const missingKanaCount = stations.filter((s) => !s.kana).length
  if (missingKanaCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `  Inferring kana for ${missingKanaCount} stations (kuroshiro)...`,
    )
    let filled = 0
    for (const s of stations) {
      if (s.kana) continue
      s.kana = await inferKana(s.name)
      if (s.kana) filled++
    }
    // eslint-disable-next-line no-console
    console.log(`  Kana filled: ${filled} / ${missingKanaCount}`)
  }

  const stationRes = await upsertStationsAndLinks(stations)
  // eslint-disable-next-line no-console
  console.log(
    `  Stations: created ${stationRes.created} / updated ${stationRes.updated} / StationLine ${stationRes.links}`,
  )

  if (withN02) {
    // US-045 / ADR 0016: 国土数値情報 N02 で補完取り込み (US-046 経路機能用先行基盤)
    // eslint-disable-next-line no-console
    console.log('\nSupplementing with 国土数値情報 N02 (US-045 / --with-n02)...')
    await supplementWithN02()
  }

  if (!noWikipediaNumbering) {
    // US-047 / ADR 0017: Wikipedia 駅ナンバリングページから駅番号を本格補完
    // eslint-disable-next-line no-console
    console.log('\nSupplementing 駅番号 from Wikipedia ナンバリング (US-047)...')
    await supplementFromWikipediaNumbering()
  }

  // US-044 / ADR 0015 §C: 駅番号未付番の lineLink を audit レポートとして出力する。
  // eslint-disable-next-line no-console
  console.log('\nWriting audit report (US-044/047)...')
  await writeAuditReport()

  // eslint-disable-next-line no-console
  console.log(
    `\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
  )
}

/**
 * US-047 / ADR 0017: N02 由来駅 (sourceUri に nlftp.mlit.go.jp を含む Station) を全削除。
 * --clean-n02 フラグで明示的に呼び出される。
 */
async function cleanN02Imported(): Promise<{ deletedStations: number }> {
  const res = await prisma.station.deleteMany({
    where: { sourceUri: { contains: 'nlftp.mlit.go.jp' } },
  })
  return { deletedStations: res.count }
}

/**
 * US-047 / ADR 0017: Wikipedia 駅ナンバリングページから駅番号を取得して
 * 既存 lineLink の空 code を埋める。
 */
async function supplementFromWikipediaNumbering(): Promise<void> {
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const cacheDir = path.join(here, 'data', 'wikipedia')

  const {
    fetchWikipediaNumberingWikitext,
    parseWikipediaNumbering,
    planWikipediaFills,
    normalizeWikipediaStationName,
  } = await import('./lib/wikipedia-numbering.js')

  let wikitext: string
  try {
    wikitext = await fetchWikipediaNumberingWikitext(cacheDir)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('  [Wikipedia] fetch failed, skipping:', (e as Error).message)
    return
  }
  // eslint-disable-next-line no-console
  console.log(`  Wikipedia wikitext loaded: ${wikitext.length.toLocaleString()} chars`)

  const entries = parseWikipediaNumbering(wikitext)
  // eslint-disable-next-line no-console
  console.log(`  Parsed numbering entries: ${entries.length}`)

  if (entries.length === 0) return

  // ADR 0011 の prefix 学習を取り込み済 DB から復元する
  const lines = await prisma.line.findMany({
    where: { sourceUri: { not: null } },
    include: { stationLinks: { select: { code: true } } },
  })
  const prefixesByLine = new Map<string, Set<string>>()
  for (const l of lines) {
    const set = new Set<string>()
    for (const sl of l.stationLinks) {
      if (!sl.code) continue
      // code から英字 prefix
      const m = sl.code.match(/^([A-Za-z]+)/)
      if (m && m[1]) set.add(m[1].toUpperCase())
    }
    if (set.size > 0) prefixesByLine.set(l.id, set)
  }

  // 既存 station + lineLinks を取得
  const stations = await prisma.station.findMany({
    where: { sourceUri: { not: null } },
    include: {
      lineLinks: { select: { lineId: true, code: true } },
    },
  })
  const stationsByName = new Map<
    string,
    Array<{
      id: string
      lineLinks: Array<{ lineId: string; code: string }>
    }>
  >()
  for (const s of stations) {
    const key = normalizeWikipediaStationName(s.name)
    const arr = stationsByName.get(key) ?? []
    arr.push({ id: s.id, lineLinks: s.lineLinks })
    stationsByName.set(key, arr)
  }

  const fills = planWikipediaFills(entries, prefixesByLine, stationsByName)
  // eslint-disable-next-line no-console
  console.log(`  Wikipedia fill plans: ${fills.length}`)

  let applied = 0
  for (const f of fills) {
    try {
      await prisma.stationLine.update({
        where: {
          stationId_lineId: { stationId: f.stationId, lineId: f.lineId },
        },
        data: { code: f.code },
      })
      applied++
    } catch {
      // 同時に削除された等のケースは無視
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  Wikipedia codes filled: ${applied}`)
}

/**
 * US-045 / ADR 0016: 国土数値情報 N02 GeoJSON キャッシュを読み, Wikidata 取り込み済の
 * Station と突合して補完する。キャッシュが空なら警告を出してスキップ (Wikidata 取り込み
 * 自体は既に完了している前提)。
 */
async function supplementWithN02(): Promise<void> {
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const cacheDir = path.join(here, 'data', 'n02')

  const { loadN02Stations, planN02Merge } = await import('./lib/n02.js')
  const n02Stations = await loadN02Stations(cacheDir)
  if (n02Stations.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      '  N02 GeoJSON cache is empty. Skipping (see backend/scripts/data/n02/README.md for download steps).',
    )
    return
  }
  // eslint-disable-next-line no-console
  console.log(`  N02 stations loaded: ${n02Stations.length}`)

  // Wikidata 取り込み済 Station + Line を取得 (sourceUri NOT NULL のもののみ)
  const stations = await prisma.station.findMany({
    where: { sourceUri: { not: null } },
  })
  const lines = await prisma.line.findMany({
    where: { sourceUri: { not: null } },
  })

  // ADR 0016 §C 突合: Wikidata Station の座標は schema に持っていないため, sourceUri から
  // Q-ID を抽出して Wikidata 由来の coord を再取得する… のは重いので, ここでは「N02 駅と
  // 名前一致 → 位置近接」を緩和して名前のみで判定する。座標は新規駅追加時に N02 側を採用。
  // (Wikidata 駅の座標は import 時に acc.coord で持っていたが Station model には保存していない)
  const stationsLite = stations.map((s) => ({
    id: s.id,
    name: s.name,
    lon: null as number | null,
    lat: null as number | null,
  }))
  const linesLite = lines.map((l) => ({
    id: l.id,
    name: l.name,
    operator: l.operator ?? null,
  }))

  const actions = planN02Merge(n02Stations, stationsLite, linesLite)

  // 注: Wikidata Station に座標が無いため, planN02Merge は座標突合をスキップして
  // 全件 create-station アクションを返してしまう。これでは既存駅と二重登録になる。
  // 仕様: 既存 Station と name 完全一致するものは attach-line に振り直す。
  const stationByName = new Map<string, string>() // name -> id (重複は最初を採用)
  for (const s of stationsLite) {
    if (!stationByName.has(s.name)) stationByName.set(s.name, s.id)
  }
  const refined: typeof actions = []
  const seenAttach = new Set<string>()
  for (const a of actions) {
    if (a.type === 'create-station') {
      const existingId = stationByName.get(a.name)
      if (existingId) {
        const key = `${existingId}|${a.lineId}`
        if (!seenAttach.has(key)) {
          seenAttach.add(key)
          refined.push({
            type: 'attach-line',
            stationId: existingId,
            lineId: a.lineId,
          })
        }
      } else {
        refined.push(a)
      }
    } else {
      const key = `${a.stationId}|${a.lineId}`
      if (!seenAttach.has(key)) {
        seenAttach.add(key)
        refined.push(a)
      }
    }
  }

  // DB 反映
  let attached = 0
  let createdStations = 0
  let createdLinks = 0
  const importedAt = new Date()
  for (const a of refined) {
    if (a.type === 'attach-line') {
      const existing = await prisma.stationLine.findUnique({
        where: {
          stationId_lineId: { stationId: a.stationId, lineId: a.lineId },
        },
      })
      if (!existing) {
        await prisma.stationLine.create({
          data: {
            stationId: a.stationId,
            lineId: a.lineId,
            // N02 には駅番号が無いため code は空文字 (Wikidata 由来分はそのまま保持される)
            code: '',
          },
        })
        attached++
      }
    } else {
      const created = await prisma.station.create({
        data: {
          name: a.name,
          kana: '',
          sourceUri: a.sourceUri,
          importedAt,
          lineLinks: { create: [{ lineId: a.lineId, code: '' }] },
        },
      })
      createdStations++
      createdLinks++
      // 後続の同名 N02 駅 attach のため反映
      stationByName.set(created.name, created.id)
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `  N02 supplement: attached lineLinks=${attached}, new stations=${createdStations} (with ${createdLinks} lineLinks)`,
  )
}

/**
 * US-044 / ADR 0015 §C: 取り込み後の DB 状態を集計し, 駅番号未付番の lineLink を
 * `docs/audit/missing-station-codes.md` に Markdown 形式で出力する。
 * 主に Wikidata 側のデータ不備で自動補完できなかった駅×路線の可視化を目的とする。
 */
async function writeAuditReport(): Promise<void> {
  const path = await import('node:path')
  const fs = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')

  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '..', '..')
  const outDir = path.join(repoRoot, 'docs', 'audit')
  const outPath = path.join(outDir, 'missing-station-codes.md')
  await fs.mkdir(outDir, { recursive: true })

  // US-047 / ADR 0017 §C: ソース別 (Wikidata 由来 / N02 由来) に分離して集計する。
  // sourceUri に "wikidata" / "nlftp.mlit.go.jp" を含むかで判定。
  const allLinks = await prisma.stationLine.findMany({
    where: { line: { sourceUri: { not: null } } },
    include: { station: true, line: true },
    orderBy: [{ station: { name: 'asc' } }, { line: { name: 'asc' } }],
  })

  const isWikidataStation = (uri: string | null) =>
    !!uri && uri.includes('wikidata.org')
  const isN02Station = (uri: string | null) =>
    !!uri && uri.includes('nlftp.mlit.go.jp')

  const totalLink = allLinks.length
  const withCodeLinks = allLinks.filter((l) => l.code !== '')
  const missingLinks = allLinks.filter((l) => l.code === '')

  const wikidataMissing = missingLinks.filter((l) =>
    isWikidataStation(l.station.sourceUri),
  )
  const n02Missing = missingLinks.filter((l) =>
    isN02Station(l.station.sourceUri),
  )
  const otherMissing = missingLinks.filter(
    (l) =>
      !isWikidataStation(l.station.sourceUri) &&
      !isN02Station(l.station.sourceUri),
  )

  const totalStation = await prisma.station.count({
    where: { sourceUri: { not: null } },
  })
  const wikidataStationCount = await prisma.station.count({
    where: { sourceUri: { contains: 'wikidata.org' } },
  })
  const n02StationCount = await prisma.station.count({
    where: { sourceUri: { contains: 'nlftp.mlit.go.jp' } },
  })

  const pct =
    totalLink === 0 ? 0 : Math.round((withCodeLinks.length / totalLink) * 1000) / 10
  const now = new Date().toISOString()

  const lines: string[] = []
  lines.push('# 駅番号 未付番 audit レポート')
  lines.push('')
  lines.push(
    '> このファイルは取り込みスクリプト終了時に自動生成されます。手動で編集しないでください。',
  )
  lines.push(
    '> 生成元: `pnpm --filter backend exec tsx scripts/import-master-tokai.ts`',
  )
  lines.push('')
  lines.push(`- 生成日時: \`${now}\``)
  lines.push(`- 取り込み済 Station: **${totalStation}**`)
  lines.push(`  - うち Wikidata 由来: ${wikidataStationCount}`)
  lines.push(
    `  - うち N02 由来 (US-046 経路機能用先行基盤, --with-n02 指定時のみ): ${n02StationCount}`,
  )
  lines.push(`- 取り込み済 StationLine: **${totalLink}**`)
  lines.push(
    `- 駅番号付番済: **${withCodeLinks.length}** (${pct}% of total)`,
  )
  lines.push(
    `- 未付番: **${missingLinks.length}** (= Wikidata: ${wikidataMissing.length} + N02: ${n02Missing.length} + 手動/その他: ${otherMissing.length})`,
  )
  lines.push('')
  lines.push('## 解釈')
  lines.push('')
  lines.push(
    '- **Wikidata 由来駅 (補完対象)**: Wikipedia 駅ナンバリングページ (US-047) や Wikidata upstream 修正で改善できる可能性あり。本レポートの主目的はこのリストの可視化。',
  )
  lines.push(
    '- **N02 由来駅 (構造的に欠落)**: 国土数値情報 N02 GeoJSON には駅番号 (P296相当) が含まれないため, 自動補完で付番不能。座標確保のための取り込みなので空のまま (US-046 経路機能で利用)。',
  )
  lines.push('')
  lines.push('## Wikidata 由来駅で未付番のもの (要対応)')
  lines.push('')
  lines.push('主な原因:')
  lines.push(
    '1. Wikidata の P296 statement そのものが未登録 (例: JR名古屋駅 = P296 が "ナコ" 電報略号のみで CA68 等の現代駅番号が未登録)',
  )
  lines.push(
    '2. P296 は登録されているが qualifier (P81/P518) も Wikipedia ナンバリングにも掲載がなく特定不能',
  )
  lines.push(
    '3. 電報略号 (カタカナ) のみの駅 (ADR 0009 で正しく除外)',
  )
  lines.push('')
  if (wikidataMissing.length === 0) {
    lines.push('(該当なし — すべての Wikidata 由来 lineLink に駅番号が付番されています)')
  } else {
    lines.push(`### リスト (${wikidataMissing.length} 件)`)
    lines.push('')
    lines.push('| 駅名 | よみがな | 路線 | 種別 | 駅 Q-ID | 路線 Q-ID |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const m of wikidataMissing) {
      const cells = [
        m.station.name,
        m.station.kana || '-',
        m.line.name,
        m.line.kind,
        `\`${m.station.id}\``,
        `\`${m.line.id}\``,
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  lines.push('')
  lines.push('## N02 由来駅 (構造的に駅番号無し, US-046 用)')
  lines.push('')
  if (n02Missing.length === 0) {
    lines.push('(--with-n02 が無効なので該当なし)')
  } else {
    lines.push(
      `${n02Missing.length} 件あります。N02 GeoJSON は駅番号を含まないため, この一覧の駅は自動補完不能で意図的に空のまま。 US-046 (経路自動取得) で座標利用のために存在します。`,
    )
    lines.push('')
    lines.push('| 駅名 | よみがな | 路線 | 種別 | Station ID |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const m of n02Missing) {
      const cells = [
        m.station.name,
        m.station.kana || '-',
        m.line.name,
        m.line.kind,
        `\`${m.station.id}\``,
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  if (otherMissing.length > 0) {
    lines.push('')
    lines.push('## その他の未付番駅 (手動作成 等)')
    lines.push('')
    lines.push('| 駅名 | 路線 | Station ID |')
    lines.push('| --- | --- | --- |')
    for (const m of otherMissing) {
      lines.push(
        `| ${m.station.name} | ${m.line.name} | \`${m.station.id}\` |`,
      )
    }
  }
  lines.push('')

  await fs.writeFile(outPath, lines.join('\n'), 'utf8')
  // eslint-disable-next-line no-console
  console.log(
    `  Audit report written: ${path.relative(repoRoot, outPath)} (Wikidata missing=${wikidataMissing.length}, N02 missing=${n02Missing.length})`,
  )
}

// テスト時は import するだけで実行されないよう、CLI 実行を判定する
const isCli =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '')

if (isCli) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      // eslint-disable-next-line no-console
      console.error(e)
      await prisma.$disconnect()
      process.exit(1)
    })
}
