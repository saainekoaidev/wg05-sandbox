import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 路線/駅マスタの seed データ。
 *
 * 2026-05-03 時点でマスタは意図的に空。
 * 東海4県 (愛知/岐阜/三重/静岡) の路線・駅マスタ取り込みは US-011 で対応する。
 * 取り込みデータソース・取り込み方式は docs/adr/0005-master-data-source.md 参照。
 *
 * テストでマスタが必要な場合は各テスト内で fixture を直接生成する方針 (seed には依存しない)。
 */
const LINES: Array<{
  id: string
  name: string
  kind: 'train' | 'subway' | 'bus' | 'other'
  operator: string | null
}> = []

const STATIONS: Array<{
  id: string
  name: string
  kana: string
  lineIds: string[]
}> = []

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
