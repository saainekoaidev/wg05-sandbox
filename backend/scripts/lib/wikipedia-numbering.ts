/**
 * US-047 / ADR 0017: Wikipedia 駅ナンバリングページから駅番号を取得して
 * 既存 lineLink (空の code) を補完する。
 *
 * フロー:
 *   1. MediaWiki API で「駅ナンバリング」ページの wikitext を取得 (24h キャッシュ)
 *   2. wikitext から「路線記号 + 駅 + 駅番号」表をパース
 *   3. 「路線記号 prefix → 既存 Line」を Wikidata 由来駅から逆引き学習し,
 *      Wikipedia 駅と Line を突合
 *   4. lineLink.code が空のものに Wikipedia 値を埋める (Wikidata 由来は上書きしない)
 */
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

const WIKI_API = 'https://ja.wikipedia.org/w/api.php'
const WIKI_PAGE_TITLE = '駅ナンバリング'
const USER_AGENT =
  'WG05Sandbox/1.0 (https://github.com/saainekoaidev/wg05-sandbox; education sandbox)'

/** キャッシュ TTL: 24 時間 (Wikimedia への負荷配慮) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Wikipedia の wikitext を取得する (キャッシュ優先)。
 */
export async function fetchWikipediaNumberingWikitext(
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, 'numbering.wikitext')

  try {
    const stat = await fs.stat(cachePath)
    const age = Date.now() - stat.mtimeMs
    if (age < CACHE_TTL_MS) {
      return await fs.readFile(cachePath, 'utf8')
    }
  } catch {
    // cache miss
  }

  const url = new URL(WIKI_API)
  url.searchParams.set('action', 'parse')
  url.searchParams.set('page', WIKI_PAGE_TITLE)
  url.searchParams.set('prop', 'wikitext')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')

  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(
      `Wikipedia API request failed: HTTP ${res.status} ${await res.text()}`,
    )
  }
  const data = (await res.json()) as {
    parse?: { wikitext?: string }
    error?: unknown
  }
  const wikitext = data.parse?.wikitext
  if (typeof wikitext !== 'string' || !wikitext) {
    throw new Error('Wikipedia API returned no wikitext')
  }
  await fs.writeFile(cachePath, wikitext, 'utf8')
  return wikitext
}

/** 1 駅 1 路線の駅番号エントリ (パーサ出力単位)。 */
export type WikipediaNumberingEntry = {
  /** 路線記号 (例: "CA"). 大文字統一済 */
  prefix: string
  /** 駅番号 (例: "CA68") */
  code: string
  /** 駅名 (素のまま, 末尾「駅」付与可能性あり) */
  stationName: string
  /** どの路線セクションで取れたか (デバッグ用. 例: "JR東海道本線") */
  sectionTitle: string
}

/**
 * 駅ナンバリング Wikipedia ページの wikitext を解析して entries を返す。
 *
 * パース戦略:
 *   駅ナンバリングページは wikitable ではなく **箇条書き** で
 *     `* [[File:...]] [[路線名|表示]]（記号説明）[[駅名]] (CODE) - [[駅名]] (CODE)`
 *   の形式で書かれている。1 行から複数の `(CODE)` パターンが出るため,
 *   行内の全「[[駅 wikilink]] (CODE)」 を regex で抽出する。
 *
 * 駅ナンバリングページが収録するのは各路線の **始点 / 終点 / 主要駅** のみで,
 * 全駅は個別路線記事 (将来 US-048 で対応予定) に載っている。本パーサは
 * 駅ナンバリングページから取れる範囲だけを補完する。
 */
export function parseWikipediaNumbering(
  wikitext: string,
): WikipediaNumberingEntry[] {
  const out: WikipediaNumberingEntry[] = []
  // 章題で分割
  const sections = splitByHeadings(wikitext)
  // 「[[駅 wikilink]] (CODE)」または「駅名 (CODE)」のパターンを抽出する regex。
  // 駅 wikilink: [[A]] / [[A|B]]
  // CODE: 英字 1-3 + (空白/ハイフン任意) + 数字 1-3
  const pattern =
    /(?:\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]|([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^\s（）\[\]]*?駅))\s*[（(]\s*([A-Z]{1,3})[\s-]?(\d{1,3})\s*[）)]/gu
  for (const sec of sections) {
    // 行ごとに走査 (箇条書きの行内に複数 entries が並ぶため)
    const lines = sec.body.split(/\n/)
    for (const line of lines) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(line)) !== null) {
        const wikilinkTarget = m[1]
        const wikilinkLabel = m[2]
        const plainName = m[3]
        const prefix = m[4]!.toUpperCase()
        const num = m[5]!
        // 表示名は label > target > 平文名 の優先
        const displayName = wikilinkLabel ?? wikilinkTarget ?? plainName ?? ''
        const stationName = displayName.trim()
        if (!stationName) continue
        out.push({
          prefix,
          code: `${prefix}${num}`,
          stationName,
          sectionTitle: sec.title,
        })
      }
    }
  }
  // 重複除去
  const seen = new Set<string>()
  return out.filter((e) => {
    const key = `${e.prefix}|${e.code}|${e.stationName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** wikitext を ==見出し== で section 分割。 */
function splitByHeadings(
  wikitext: string,
): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = []
  // 見出しは行頭の `=+ title =+` パターン
  const re = /^(=+)\s*(.*?)\s*\1\s*$/gm
  let lastIndex = 0
  let lastTitle = '(intro)'
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext)) !== null) {
    const body = wikitext.slice(lastIndex, m.index)
    sections.push({ title: lastTitle, body })
    lastTitle = m[2] ?? ''
    lastIndex = m.index + m[0].length
  }
  sections.push({ title: lastTitle, body: wikitext.slice(lastIndex) })
  return sections
}

/** wikitext から `{| class="wikitable"...|}` の中身を全部抽出。 */
function extractWikitables(wikitext: string): string[] {
  const out: string[] = []
  const re = /\{\|[^\n]*?wikitable[\s\S]*?\n\|\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext)) !== null) {
    out.push(m[0])
  }
  return out
}

/**
 * 1 つの wikitable から row × cell の 2 次元配列を返す。
 * - 行は `|-` で区切られる
 * - 各行のセルは `|` または `||` 区切り (先頭の `|` は cell 開始マーカー)
 * - ヘッダ `!` は無視 (データ行のみ)
 */
function parseTableRows(table: string): string[][] {
  const rows: string[][] = []
  const tlines = table.split(/\n/)
  let current: string[] = []
  for (const raw of tlines) {
    const line = raw.trim()
    if (line.startsWith('{|') || line === '|}') continue
    if (line.startsWith('|-')) {
      // 行区切り: 直前の current が非空なら push
      if (current.length > 0) rows.push(current)
      current = []
      continue
    }
    // `!` (ヘッダセル) と `|` (データセル) を両方データとして扱う。
    // 路線記事の駅一覧では駅番号がヘッダセル (`!CA68`) に置かれることがあるため。
    if (line.startsWith('!')) {
      const stripped = line.replace(/^!/, '').trim()
      // 1 行内に `!!` で複数セル
      const cells = stripped.split('!!').map((cell) => cleanupCell(cell))
      current.push(...cells)
    } else if (line.startsWith('|') && !line.startsWith('|-')) {
      const stripped = line.replace(/^\|/, '').trim()
      const cells = stripped.split('||').map((cell) => cleanupCell(cell))
      current.push(...cells)
    }
  }
  if (current.length > 0) rows.push(current)
  return rows
}

/**
 * セルから wikitext 装飾を取り除いてクリーンな文字列を返す:
 *   - `style="..." | 値` の場合は `|` 後ろを採用
 *   - `[[A|B]]` → `B`, `[[A]]` → `A`
 *   - 末尾改行・先頭末尾空白除去
 */
function cleanupCell(cell: string): string {
  let s = cell
  // attribute prefix (style="..." | value) を切り落とす
  if (
    /=/.test(s) &&
    /style|class|colspan|rowspan|align|scope/i.test(s.split('|')[0] ?? '')
  ) {
    const idx = s.indexOf('|')
    if (idx >= 0) s = s.slice(idx + 1)
  }
  s = s.trim()
  // wikilink を表示テキストに展開
  s = extractWikilinkDisplay(s)
  // テンプレート {{...}} を除去 (簡易版: ネスト未対応)
  // 例: "[[名古屋駅]] {{JR特定都区市内|名}}" → "名古屋駅"
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\{\{[^{}]*\}\}/g, '')
  }
  // ref タグ等を除去
  s = s.replace(/<ref[\s\S]*?<\/ref>/g, '')
  s = s.replace(/<ref[^>]*\/>/g, '')
  // br タグを空白に
  s = s.replace(/<br\s*\/?>/g, ' ')
  // 残った HTML タグ
  s = s.replace(/<[^>]+>/g, '')
  // HTML エンティティの簡易デコード
  s = s.replace(/&nbsp;/g, ' ')
  return s.trim()
}

/** [[A|B]] → B / [[A]] → A / 普通文字列 → そのまま。`#fragment` は除去。 */
function extractWikilinkDisplay(s: string): string {
  return s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
    // label が無ければ target を表示 (target の `#fragment` は除去)
    const display = label ?? (target as string).split('#')[0]
    return (display ?? '').trim()
  })
}

/**
 * 取り込み側 (import-master-tokai.ts の normalizeStationName) と同じ前処理を行うため
 * のプレフィックスパターン。DB 駅名は事業者プレフィックス + 末尾「駅」が剥がれた形で
 * 保存されているので, Wikipedia 由来の駅名にも同じ正規化を適用する必要がある。
 *
 * import-master-tokai.ts の NAME_PREFIX_PATTERNS と意図的に同期している。
 * (循環 import を避けるためここに複製)
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

/**
 * Station 名正規化。Wikidata 取り込み側 (`normalizeStationName`) と挙動を揃える:
 * 事業者プレフィックスを剥がし, 末尾「駅」も除去。
 *
 * 例:
 *   "近鉄名古屋駅" → "名古屋"
 *   "JR東海名古屋駅" → "名古屋"
 *   "中京競馬場前駅" → "中京競馬場前"
 *   "名古屋駅" → "名古屋"
 */
export function normalizeWikipediaStationName(rawName: string): string {
  let name = rawName.trim()
  for (const re of NAME_PREFIX_PATTERNS) {
    name = name.replace(re, '')
  }
  name = name.replace(/駅$/, '').trim()
  return name || rawName.trim()
}

/**
 * Wikipedia のエントリを「path id ベースの補完計画」に変換する。
 * - prefixesByLine: 各 Wikidata Line.id が持つ prefix 集合 (US-040 で構築済)
 * - 既存の (stationName, lineId) ペアで code が空 → 補完アクション
 *
 * 入力 lookup:
 *  - prefixesByLine: Map<lineId, Set<prefix>>
 *  - stationsByName: Map<normalized name, Array<{ id, lineLinks: Array<{ lineId, code }>}>>
 */
export type WikipediaFillAction = {
  stationId: string
  lineId: string
  code: string
  /** デバッグ用 */
  source: WikipediaNumberingEntry
}

export function planWikipediaFills(
  entries: WikipediaNumberingEntry[],
  prefixesByLine: Map<string, Set<string>>,
  stationsByName: Map<
    string,
    Array<{ id: string; lineLinks: Array<{ lineId: string; code: string }> }>
  >,
): WikipediaFillAction[] {
  const fills: WikipediaFillAction[] = []
  for (const e of entries) {
    const norm = normalizeWikipediaStationName(e.stationName)
    const candidates = stationsByName.get(norm) ?? []
    if (candidates.length === 0) continue
    for (const station of candidates) {
      // 駅の lineLinks から prefix が一致する空 code を探す
      for (const link of station.lineLinks) {
        if (link.code) continue // 既存 code は上書きしない
        const prefSet = prefixesByLine.get(link.lineId)
        if (!prefSet || !prefSet.has(e.prefix)) continue
        fills.push({
          stationId: station.id,
          lineId: link.lineId,
          code: e.code,
          source: e,
        })
      }
    }
  }
  // 重複排除
  const seen = new Set<string>()
  return fills.filter((f) => {
    const key = `${f.stationId}|${f.lineId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const _internal = {
  splitByHeadings,
  extractWikitables,
  parseTableRows,
  cleanupCell,
  extractWikilinkDisplay,
  CACHE_TTL_MS,
}
