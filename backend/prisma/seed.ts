import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 路線/駅マスタの seed データ。
 *
 * 本番マスタは US-011 (docs/adr/0007-tokai-import-spec.md) の取り込みスクリプトで
 * Wikidata から動的に投入する (`pnpm --filter backend exec tsx scripts/import-master-tokai.ts`)。
 * seed.ts には **CI / E2E 用の最小フィクスチャだけ** を載せる。
 *
 * - フィクスチャは「e2e 駅選択 popup テスト」が動作する程度の最小限
 * - id を `test-` プレフィックスで分離し、Wikidata 取り込みデータと衝突しないようにする
 * - 開発 DB に Wikidata 取り込みを実行している場合は、本フィクスチャと共存する
 */
const LINES: Array<{
  id: string
  name: string
  kind: 'train' | 'subway' | 'bus' | 'other'
  operator: string | null
}> = [
  {
    id: 'test-tokaido',
    name: 'JR東海道線 (テスト用)',
    kind: 'train',
    operator: 'JR東海',
  },
]

const STATIONS: Array<{
  id: string
  name: string
  kana: string
  lineIds: string[]
}> = [
  {
    id: 'test-stn-nagoya',
    name: '名古屋',
    kana: 'なごや',
    lineIds: ['test-tokaido'],
  },
]

async function main() {
  for (const line of LINES) {
    await prisma.line.upsert({
      where: { id: line.id },
      update: { name: line.name, kind: line.kind, operator: line.operator },
      create: line,
    })
  }

  for (const station of STATIONS) {
    await prisma.station.upsert({
      where: { id: station.id },
      update: { name: station.name, kana: station.kana },
      create: { id: station.id, name: station.name, kana: station.kana },
    })
  }

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
