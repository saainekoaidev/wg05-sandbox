import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 路線マスタ (Line) の seed データ。
 * docs/ui-screens/screen_design_route_register.md §3.3 の路線リスト 14 件と一致させる。
 * id は手動採番のスラッグ形式。
 */
const LINES: Array<{
  id: string
  name: string
  kind: 'train' | 'subway' | 'bus' | 'other'
  operator: string | null
}> = [
  { id: 'jr-yamanote', name: 'JR山手線', kind: 'train', operator: 'JR東日本' },
  { id: 'jr-chuo', name: 'JR中央線', kind: 'train', operator: 'JR東日本' },
  { id: 'jr-keihin-tohoku', name: 'JR京浜東北線', kind: 'train', operator: 'JR東日本' },
  { id: 'metro-ginza', name: '東京メトロ銀座線', kind: 'subway', operator: '東京メトロ' },
  { id: 'metro-marunouchi', name: '東京メトロ丸ノ内線', kind: 'subway', operator: '東京メトロ' },
  { id: 'metro-fukutoshin', name: '東京メトロ副都心線', kind: 'subway', operator: '東京メトロ' },
  { id: 'metro-chiyoda', name: '東京メトロ千代田線', kind: 'subway', operator: '東京メトロ' },
  { id: 'toei-oedo', name: '都営大江戸線', kind: 'subway', operator: '東京都交通局' },
  { id: 'toei-asakusa', name: '都営浅草線', kind: 'subway', operator: '東京都交通局' },
  { id: 'tokyu-toyoko', name: '東急東横線', kind: 'train', operator: '東急電鉄' },
  { id: 'keio', name: '京王線', kind: 'train', operator: '京王電鉄' },
  { id: 'odakyu', name: '小田急線', kind: 'train', operator: '小田急電鉄' },
  { id: 'toei-bus-01', name: '都営バス01系統', kind: 'bus', operator: '東京都交通局' },
  { id: 'other', name: 'その他', kind: 'other', operator: null },
]

/**
 * 駅 / 停留所マスタ (Station) と接続路線 (StationLine) の seed データ。
 * docs/ui-screens/screen_design_station_master.md の例データと、register モックの主要駅を反映。
 * 種別は持たず、StationLine 経由で派生表示する設計 (docs/adr/0002-data-model.md §3.2.4)。
 */
const STATIONS: Array<{
  id: string
  name: string
  kana: string
  lineIds: string[]
}> = [
  { id: 'stn-shibuya', name: '渋谷', kana: 'しぶや',
    lineIds: ['jr-yamanote', 'tokyu-toyoko', 'metro-fukutoshin', 'metro-ginza'] },
  { id: 'stn-shinjuku', name: '新宿', kana: 'しんじゅく',
    lineIds: ['jr-yamanote', 'jr-chuo', 'toei-oedo', 'odakyu', 'keio'] },
  { id: 'stn-omotesando', name: '表参道', kana: 'おもてさんどう',
    lineIds: ['metro-ginza', 'metro-chiyoda'] },
  { id: 'stn-kanda', name: '神田', kana: 'かんだ',
    lineIds: ['jr-yamanote', 'jr-chuo', 'jr-keihin-tohoku', 'metro-ginza'] },
  { id: 'stn-ikebukuro', name: '池袋', kana: 'いけぶくろ',
    lineIds: ['jr-yamanote', 'metro-marunouchi', 'metro-fukutoshin'] },
  { id: 'stn-otemachi', name: '大手町', kana: 'おおてまち',
    lineIds: ['metro-marunouchi', 'metro-chiyoda', 'toei-oedo'] },
  { id: 'stn-tokyo', name: '東京', kana: 'とうきょう',
    lineIds: ['jr-yamanote', 'jr-chuo', 'jr-keihin-tohoku', 'metro-marunouchi'] },
  { id: 'stn-ginza', name: '銀座', kana: 'ぎんざ',
    lineIds: ['metro-ginza', 'metro-marunouchi'] },
  { id: 'stn-asakusa', name: '浅草', kana: 'あさくさ',
    lineIds: ['metro-ginza', 'toei-asakusa'] },
  { id: 'stn-nihombashi', name: '日本橋', kana: 'にほんばし',
    lineIds: ['metro-ginza', 'toei-asakusa'] },
  { id: 'stn-shinagawa', name: '品川', kana: 'しながわ',
    lineIds: ['jr-yamanote', 'jr-keihin-tohoku', 'keio'] },
  { id: 'bus-shibuya-ekimae', name: '都営バス 渋谷駅前', kana: 'しぶやえきまえ',
    lineIds: ['toei-bus-01'] },
]

async function main() {
  // Line: upsert で冪等に
  for (const line of LINES) {
    await prisma.line.upsert({
      where: { id: line.id },
      update: { name: line.name, kind: line.kind, operator: line.operator },
      create: line,
    })
  }

  // Station: upsert
  for (const station of STATIONS) {
    await prisma.station.upsert({
      where: { id: station.id },
      update: { name: station.name, kana: station.kana },
      create: { id: station.id, name: station.name, kana: station.kana },
    })
  }

  // StationLine: 既存リンクを一旦削除してから挿入 (路線追加/削除を反映するため)
  for (const station of STATIONS) {
    await prisma.stationLine.deleteMany({ where: { stationId: station.id } })
    if (station.lineIds.length > 0) {
      await prisma.stationLine.createMany({
        data: station.lineIds.map((lineId) => ({ stationId: station.id, lineId })),
      })
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${LINES.length} Line / ${STATIONS.length} Station / ${
      STATIONS.reduce((acc, s) => acc + s.lineIds.length, 0)
    } StationLine records`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
