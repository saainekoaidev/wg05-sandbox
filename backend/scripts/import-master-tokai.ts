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
  const lineVals = lineIds.map((q) => `wd:${q}`).join(' ')
  const prefVals = PREF_QIDS.map((q) => `wd:${q}`).join(' ')
  // 駅情報は重複しがち (P81 が複数あり, 4県内駅で複数県マッチ等)。SELECT 後にアプリ層で集約する。
  // US-033 / ADR 0008: P296 は statement node + qualifier P81 (路線対応) で取得し, 駅×路線粒度の
  // 駅番号 (StationLine.code) として割り当てる。qualifier 無しは全 lineLink 共通の値として fallback。
  const query = `
SELECT DISTINCT ?station ?stationLabel ?stationKana ?stationCode ?qualifierLine ?line WHERE {
  VALUES ?targetLine { ${lineVals} }
  VALUES ?pref { ${prefVals} }
  ?station wdt:P81 ?targetLine ;
           wdt:P31/wdt:P279* wd:Q55488 ;
           wdt:P131* ?pref ;
           wdt:P81 ?line .
  OPTIONAL { ?station wdt:P1814 ?stationKana }
  OPTIONAL {
    ?station p:P296 ?codeStmt .
    ?codeStmt ps:P296 ?stationCode .
    OPTIONAL { ?codeStmt pq:P81 ?qualifierLine . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
`
  const rows = await fetcher(query)
  const targetSet = new Set(lineIds)

  type Acc = {
    name: string
    kana: string
    sourceUri: string
    /** 駅単位の lineId 集合 (取り込み対象に絞った後) */
    lineIds: Set<string>
    /** (station, line) ペア → code 候補集合。"/" 結合前の状態。 */
    codesByLine: Map<string, Set<string>>
    /** qualifier P81 が無い code (どの路線か不明) の集合。最後に全 lineId へ広げる fallback。 */
    unattachedCodes: Set<string>
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
      }
      acc.set(stationQid, a)
    }
    if (targetSet.has(lineQid)) a.lineIds.add(lineQid)
    const codeVal = r.stationCode?.value
    if (codeVal) {
      const qLine = r.qualifierLine?.value
        ? qidFromUri(r.qualifierLine.value)
        : null
      if (qLine && targetSet.has(qLine)) {
        // qualifier が指す路線が取り込み対象なら、その (station, line) 限定の code として登録
        const set = a.codesByLine.get(qLine) ?? new Set<string>()
        set.add(codeVal)
        a.codesByLine.set(qLine, set)
      } else {
        // qualifier 無し or qualifier が対象外路線 → 全 lineLink の fallback
        a.unattachedCodes.add(codeVal)
      }
    }
  }

  return Array.from(acc.entries()).map(([stationQid, a]) => {
    const lineIds = Array.from(a.lineIds)
    const links = lineIds.map((lineId) => {
      const set = new Set<string>(a.codesByLine.get(lineId) ?? [])
      // qualifier 無し code は「どの路線か断定できない」ため全 link に同じ値を流し込む。
      for (const c of a.unattachedCodes) set.add(c)
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

  const startedAt = Date.now()
  // eslint-disable-next-line no-console
  console.log('== Tokai master import (Wikidata) ==')
  // eslint-disable-next-line no-console
  console.log(
    `Operators: JR東海 (whitelist 14) + ${OTHER_OPERATORS.length} 社 (operator-based)`,
  )
  // eslint-disable-next-line no-console
  console.log(`Prefectures: 4 (愛知, 岐阜, 三重, 静岡)`)

  if (clean) {
    const cleaned = await cleanImported()
    // eslint-disable-next-line no-console
    console.log(
      `\n[--clean] Wikidata 由来分を削除: Line ${cleaned.deletedLines} / Station ${cleaned.deletedStations}`,
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

  // eslint-disable-next-line no-console
  console.log(
    `\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
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
