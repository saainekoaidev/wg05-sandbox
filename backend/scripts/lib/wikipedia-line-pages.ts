/**
 * US-048 / ADR 0018: 個別路線 Wikipedia 記事 (駅一覧) から駅番号を取り込む。
 *
 * 駅ナンバリングページ (US-047) は始終点・主要駅のみで全駅補完できなかったため,
 * 各路線の Wikipedia 記事に書かれた駅一覧 wikitable をパースする。
 *
 * フロー:
 *   1. Line Q-ID から Wikidata API で ja.wikipedia の記事タイトルを取得
 *   2. MediaWiki API で wikitext 取得 (キャッシュは backend/scripts/data/wikipedia/lines/<qid>.json, 7日 TTL)
 *   3. 記事中の wikitable から「駅名 + 駅番号 (路線記号 + 数字)」 を抽出
 *   4. 駅番号空の lineLink を埋める (Wikidata 既存値は上書きしない)
 */
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { _internal as numberingInternal } from './wikipedia-numbering.js'

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const USER_AGENT =
  'WG05Sandbox/1.0 (https://github.com/saainekoaidev/wg05-sandbox; education sandbox)'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 日

/**
 * Line Q-ID → 取得すべき ja.wikipedia 記事タイトルの override マップ。
 * Wikidata sitelink で得られる記事が umbrella 記事 (= 全国版) で駅番号 wikitable を持たない場合,
 * 名古屋地区/静岡地区等の地域版 sub-article に切り替える。
 *
 * 例: Q1199703 = 関西本線 (umbrella) は駅番号 wikitable 無し。
 *     代わりに「関西線 (名古屋地区)」サブ記事を取得すれば駅番号一覧が取れる。
 */
export const LINE_ARTICLE_OVERRIDES: Readonly<Record<string, string>> = {
  Q1199703: '関西線 (名古屋地区)', // JR関西本線 → 名古屋地区サブ記事
}

/**
 * Wikidata Q-ID から ja.wikipedia の記事タイトルを取得。無ければ null。
 */
export async function getJaWikipediaTitle(
  qid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(WIKIDATA_API)
  url.searchParams.set('action', 'wbgetentities')
  url.searchParams.set('ids', qid)
  url.searchParams.set('props', 'sitelinks')
  url.searchParams.set('sitefilter', 'jawiki')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const json = (await res.json()) as {
    entities?: Record<
      string,
      { sitelinks?: { jawiki?: { title?: string } } }
    >
  }
  return json.entities?.[qid]?.sitelinks?.jawiki?.title ?? null
}

/**
 * 指定タイトルの ja.wikipedia 記事の wikitext を取得。
 */
export async function fetchPageWikitext(
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(WIKIPEDIA_API)
  url.searchParams.set('action', 'parse')
  url.searchParams.set('page', title)
  url.searchParams.set('prop', 'wikitext')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const json = (await res.json()) as {
    parse?: { wikitext?: string }
  }
  return json.parse?.wikitext ?? null
}

export type LineArticle = { title: string; wikitext: string }

/**
 * Line Q-ID に対応する ja.wikipedia 記事を取得 (キャッシュ優先)。
 * LINE_ARTICLE_OVERRIDES に Q-ID が登録されていればそちらを優先 fetch する。
 */
export async function fetchLineArticle(
  qid: string,
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineArticle | null> {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${qid}.json`)
  try {
    const stat = await fs.stat(cachePath)
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      return JSON.parse(await fs.readFile(cachePath, 'utf8')) as LineArticle
    }
  } catch {
    // miss
  }
  // Override があればそれを使う, 無ければ Wikidata sitelink から取得
  const title =
    LINE_ARTICLE_OVERRIDES[qid] ?? (await getJaWikipediaTitle(qid, fetchImpl))
  if (!title) return null
  const wikitext = await fetchPageWikitext(title, fetchImpl)
  if (!wikitext) return null
  const result: LineArticle = { title, wikitext }
  await fs.writeFile(cachePath, JSON.stringify(result), 'utf8')
  return result
}

export type LineArticleEntry = {
  /** 駅名 (素のまま, 末尾「駅」付与可能性あり) */
  stationName: string
  /** 路線記号 prefix (大文字, 例: "CA") */
  prefix: string
  /** 駅番号 (例: "CA68") */
  code: string
}

/**
 * 路線 Wikipedia 記事の wikitext から「駅名 + 駅番号」を抽出する。
 *
 * 駅一覧表は通常 `{| class="wikitable"` で始まり, 行ごとに駅情報が書かれる。
 * 駅番号セルは「CA68」「CA-68」「CA 68」等の形式。各行から:
 *   - 駅番号セル (regex で判定)
 *   - 駅名セル (日本語文字を含み駅番号セルではないもの)
 * を取り出す。
 */
export function parseStationCodesFromLineArticle(
  wikitext: string,
): LineArticleEntry[] {
  const out: LineArticleEntry[] = []
  const tables = numberingInternal.extractWikitables(wikitext)
  for (const table of tables) {
    const rows = numberingInternal.parseTableRows(table)
    for (const row of rows) {
      const codeCell = row.find((c) => /^[A-Z]{1,3}[\s-]?\d{1,3}$/.test(c))
      if (!codeCell) continue
      const code = codeCell.replace(/[\s-]/g, '').toUpperCase()
      const m = code.match(/^([A-Z]+)(\d+)$/)
      if (!m) continue
      const prefix = m[1]!

      // 駅名セルを探す: 日本語文字を含む / 駅番号でない / 短すぎず長すぎない
      const nameCell = row.find((c) => {
        if (c === codeCell) return false
        if (c.length === 0 || c.length > 30) return false
        if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)) return false
        // 単位や数値だけのセルは除外 (例: "0.0" "12,345人")
        if (/^[\d.,\s人日年月]+$/.test(c)) return false
        return true
      })
      if (!nameCell) continue
      const stationName = numberingInternal
        .extractWikilinkDisplay(nameCell)
        .trim()
      if (!stationName) continue

      out.push({ stationName, prefix, code })
    }
  }
  // 重複除去 (同じ stationName + code は 1 件)
  const seen = new Set<string>()
  return out.filter((e) => {
    const key = `${e.code}|${e.stationName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const _internal = {
  CACHE_TTL_MS,
  WIKIPEDIA_API,
  WIKIDATA_API,
  USER_AGENT,
}
