/**
 * US-045 / ADR 0016: 国土数値情報 N02 (鉄道) GeoJSON の取り込みヘルパ。
 *
 * Wikidata 取り込み完了後に呼ばれ, N02 駅データを Wikidata 由来 Station と
 * 「座標 < 200m + 名称一致」で突合し, 一致した駅は Line を補完, 一致しない駅は
 * (取り込み対象 Line に該当すれば) 新規 Station として追加する。
 *
 * N02 GeoJSON の Point feature properties (典型例):
 *   N02_001: 鉄道種別  ("11" 新幹線 / "12" JR在来線 / "13" 民鉄 / "14" 公営 / "15" 第三セクター)
 *   N02_002: 事業者種別
 *   N02_003: 運営会社名 (例: "東海旅客鉄道")
 *   N02_004: 路線名     (例: "東海道本線")
 *   N02_005: 駅名       (例: "名古屋")
 *
 * 当面は Point feature のみ駅として処理。LineString (路線セクション) は将来検討。
 */
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

/** 4 県 (愛知/岐阜/三重/静岡) を含む座標 bounding box (ADR 0016 §C)。 */
export const N02_BBOX = {
  lonMin: 135.5,
  lonMax: 139.5,
  latMin: 33.5,
  latMax: 36.7,
} as const

/** 突合距離の閾値 (ADR 0016 §C)。Wikidata Station と N02 駅が同一物理駅とみなせる距離 [m]。 */
export const N02_MATCH_THRESHOLD_M = 200

/** N02 GeoJSON Feature の properties (我々が使うフィールドのみ型定義)。 */
type N02FeatureProps = {
  N02_001?: string
  N02_002?: string
  N02_003?: string
  N02_004?: string
  N02_005?: string
}

type N02Feature = {
  type: 'Feature'
  geometry: { type: string; coordinates: number[] | number[][] }
  properties: N02FeatureProps
}

type N02FeatureCollection = {
  type: 'FeatureCollection'
  features: N02Feature[]
}

/** N02 から取り出した駅情報 (我々の処理単位)。 */
export type N02Station = {
  /** 駅名 (素のまま, 必要に応じて呼び出し側で正規化) */
  name: string
  /** 路線名 (例: "東海道本線") */
  lineName: string
  /** 運営会社名 (例: "東海旅客鉄道") */
  operator: string
  lon: number
  lat: number
}

/**
 * N02 路線名と Wikidata Line.name の表記揺らぎを吸収する正規化関数。
 * - "JR" プレフィックス除去
 * - 末尾の "(XX地区)" 修飾子除去
 * - 末尾の「線」「本線」を統一しない (区別が必要なため残す)
 *
 * 例:
 *  "JR東海道線 (名古屋地区)" → "東海道線"
 *  "東海道本線"               → "東海道本線"
 *  どちらも "東海道" が一致するので呼び出し側でさらに緩い比較も行う。
 */
export function normalizeLineName(name: string): string {
  return name
    .replace(/^JR/, '')
    .replace(/\s*\([^)]*地区\)\s*$/, '')
    .trim()
}

/**
 * 2 つの路線名が「同じ路線」を指していると見なせるか判定する。
 * 段階的に: 完全一致 → 正規化後一致 → 一方が他方を含む (本線/支線等の親子)。
 */
export function lineNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const na = normalizeLineName(a)
  const nb = normalizeLineName(b)
  if (na === nb) return true
  // "東海道本線" と "東海道線" のように本線/線で揺れる場合
  const stripHonsen = (s: string) => s.replace(/本線$/, '線')
  if (stripHonsen(na) === stripHonsen(nb)) return true
  return false
}

/**
 * N02 駅名を我々の正規化と整合させる: 末尾「駅」を除去 + 前 prefixes (JR東海等) を除去。
 * import-master-tokai.ts の normalizeStationName と同等の挙動になるよう揃える。
 */
export function normalizeN02StationName(rawName: string): string {
  let name = rawName.trim()
  // 既知の事業者プレフィックスを除去 (Wikidata 側の normalizeStationName と整合)
  const prefixes = [
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
  for (const re of prefixes) name = name.replace(re, '')
  name = name.replace(/駅$/, '').trim()
  return name || rawName
}

/**
 * Haversine 距離 [m]。import-master-tokai.ts に同じ関数があるが循環参照を避けるためここにも複製する。
 */
function haversineM(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const R = 6371000
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

/**
 * 指定ディレクトリ配下の `*.geojson` を全部読み, N02 駅 (Point feature) を抽出する。
 * - 4 県 bbox 外の Feature は除外
 * - properties が不完全な Feature は除外
 *
 * ファイルが 1 つも無い場合は空配列を返す (呼び出し側で警告等を出す)。
 */
export async function loadN02Stations(cacheDir: string): Promise<N02Station[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(cacheDir)
  } catch {
    return []
  }
  const files = entries.filter((f) => /\.geojson$/i.test(f))
  if (files.length === 0) return []
  const out: N02Station[] = []
  for (const f of files) {
    const raw = await fs.readFile(path.join(cacheDir, f), 'utf8')
    let json: N02FeatureCollection
    try {
      json = JSON.parse(raw) as N02FeatureCollection
    } catch {
      continue
    }
    for (const feature of json.features ?? []) {
      if (feature.geometry?.type !== 'Point') continue
      const coords = feature.geometry.coordinates as number[]
      if (!coords || coords.length < 2) continue
      const [lon, lat] = coords
      if (typeof lon !== 'number' || typeof lat !== 'number') continue
      if (lon < N02_BBOX.lonMin || lon > N02_BBOX.lonMax) continue
      if (lat < N02_BBOX.latMin || lat > N02_BBOX.latMax) continue
      const props = feature.properties ?? {}
      const name = (props.N02_005 ?? '').trim()
      const lineName = (props.N02_004 ?? '').trim()
      const operator = (props.N02_003 ?? '').trim()
      if (!name || !lineName) continue
      out.push({ name, lineName, operator, lon, lat })
    }
  }
  return out
}

export type WikidataStationLite = {
  id: string
  name: string
  /** Wikidata 由来駅は座標が取れていないと突合できない */
  lon: number | null
  lat: number | null
}

export type WikidataLineLite = {
  id: string
  name: string
  /** N02 由来で更新可能な additional フィールド (operator) を判断するため */
  operator: string | null
}

/**
 * N02 駅と Wikidata Station を突合した結果を返す。実際の DB 書き込みは呼び出し側で行う。
 */
export type N02MergeAction =
  | {
      type: 'attach-line'
      /** 既存の Wikidata Station.id */
      stationId: string
      /** 追加する Line.id (canonical, スコープ内) */
      lineId: string
    }
  | {
      type: 'create-station'
      /** 新規 Station の name (正規化済み) */
      name: string
      /** N02 駅の座標 (sourceUri と組み合わせて DB に書く) */
      lon: number
      lat: number
      /** 新規駅を紐付ける Line.id */
      lineId: string
      /** N02 由来のソース URL (情報出典として保存) */
      sourceUri: string
    }

/**
 * N02 駅一覧と Wikidata Station/Line を入力にマージアクションを計算する。
 * - 座標 < N02_MATCH_THRESHOLD_M + 名称一致 (正規化後) で attach-line
 * - 該当無 + 路線が Wikidata Line にマッチ → create-station
 * - 路線が Wikidata Line にもマッチしない → スキップ (ホワイトリスト外路線扱い)
 */
export function planN02Merge(
  n02Stations: N02Station[],
  wikidataStations: WikidataStationLite[],
  lines: WikidataLineLite[],
): N02MergeAction[] {
  const actions: N02MergeAction[] = []
  // (stationId, lineId) ごとに重複防止
  const seenAttach = new Set<string>()
  // (canonical name + lineId) ごとに重複 create を防止
  const seenCreate = new Set<string>()

  for (const ns of n02Stations) {
    // 1. 路線マッチ: スコープ内 (Wikidata Line にマッチ) でなければスキップ
    const matchedLine = lines.find((l) => lineNamesMatch(l.name, ns.lineName))
    if (!matchedLine) continue

    // 2. 駅マッチ: 既存 Wikidata 駅と座標 + 名称で突合
    const normalizedNs = normalizeN02StationName(ns.name)
    let bestMatch: { st: WikidataStationLite; dist: number } | null = null
    for (const ws of wikidataStations) {
      if (ws.lon === null || ws.lat === null) continue
      // 名称比較 (Wikidata name は normalizeStationName 適用済前提)
      if (ws.name !== normalizedNs) continue
      const d = haversineM({ lon: ns.lon, lat: ns.lat }, { lon: ws.lon, lat: ws.lat })
      if (d > N02_MATCH_THRESHOLD_M) continue
      if (!bestMatch || bestMatch.dist > d) bestMatch = { st: ws, dist: d }
    }

    if (bestMatch) {
      const key = `${bestMatch.st.id}|${matchedLine.id}`
      if (!seenAttach.has(key)) {
        seenAttach.add(key)
        actions.push({
          type: 'attach-line',
          stationId: bestMatch.st.id,
          lineId: matchedLine.id,
        })
      }
    } else {
      const key = `${normalizedNs}|${matchedLine.id}`
      if (!seenCreate.has(key)) {
        seenCreate.add(key)
        actions.push({
          type: 'create-station',
          name: normalizedNs,
          lon: ns.lon,
          lat: ns.lat,
          lineId: matchedLine.id,
          // 国土数値情報全体への参照 URL (個別駅の URL は無いため)
          sourceUri:
            'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02.html',
        })
      }
    }
  }
  return actions
}
