/**
 * 愛知環状鉄道 (Aikan) のマスタを手動登録するスクリプト (US-056)。
 *
 * Wikidata 取り込み (US-011 / ADR 0007) のスコープ外のため, 別途用意する。
 * Operator + Line + Station + StationLine を idempotent に upsert する。
 *
 * 使い方: pnpm --filter backend exec tsx scripts/seed-aikan.ts
 *
 * 駅番号 (code): 公式には letter prefix の駅ナンバリングが未導入のため,
 * 路線内の駅順 (岡崎 → 高蔵寺) を 2 桁ゼロ詰めの 01〜23 で振る。
 * 将来公式な番号が導入されたら admin UI で更新可能。
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const OPERATOR = {
  id: 'aikan',
  name: '愛知環状鉄道',
  aliases: '["愛環"]',
  kinds: '["train"]',
}

const LINE = {
  id: 'aikan-line',
  name: '愛知環状鉄道線',
  kind: 'train',
  operator: '愛知環状鉄道',
  operatorId: 'aikan',
}

/** 岡崎 → 高蔵寺 の駅一覧 (順序が code の連番に対応)。 */
const STATIONS: Array<{ id: string; name: string; kana: string; code: string }> = [
  { id: 'aikan-okazaki',      name: '岡崎',         kana: 'おかざき',         code: '01' },
  { id: 'aikan-mutsuna',      name: '六名',         kana: 'むつな',           code: '02' },
  { id: 'aikan-naka-okazaki', name: '中岡崎',       kana: 'なかおかざき',     code: '03' },
  { id: 'aikan-kita-okazaki', name: '北岡崎',       kana: 'きたおかざき',     code: '04' },
  { id: 'aikan-daimon',       name: '大門',         kana: 'だいもん',         code: '05' },
  { id: 'aikan-kitano-masuzuka', name: '北野桝塚',  kana: 'きたのますづか',   code: '06' },
  { id: 'aikan-mikawa-kamigo', name: '三河上郷',    kana: 'みかわかみごう',   code: '07' },
  { id: 'aikan-ekaku',        name: '永覚',         kana: 'えかく',           code: '08' },
  { id: 'aikan-suenohara',    name: '末野原',       kana: 'すえのはら',       code: '09' },
  { id: 'aikan-mikawa-toyota', name: '三河豊田',    kana: 'みかわとよた',     code: '10' },
  { id: 'aikan-shin-uwagoromo', name: '新上挙母',   kana: 'しんうわごろも',   code: '11' },
  { id: 'aikan-shin-toyota',  name: '新豊田',       kana: 'しんとよた',       code: '12' },
  { id: 'aikan-umetsubo',     name: '愛環梅坪',     kana: 'あいかんうめつぼ', code: '13' },
  { id: 'aikan-shigo',        name: '四郷',         kana: 'しごう',           code: '14' },
  { id: 'aikan-kaizu',        name: '貝津',         kana: 'かいづ',           code: '15' },
  { id: 'aikan-homi',         name: '保見',         kana: 'ほみ',             code: '16' },
  { id: 'aikan-sasabara',     name: '篠原',         kana: 'ささばら',         code: '17' },
  { id: 'aikan-yakusa',       name: '八草',         kana: 'やくさ',           code: '18' },
  { id: 'aikan-yamaguchi',    name: '山口',         kana: 'やまぐち',         code: '19' },
  { id: 'aikan-setoguchi',    name: '瀬戸口',       kana: 'せとぐち',         code: '20' },
  { id: 'aikan-setoshi',      name: '瀬戸市',       kana: 'せとし',           code: '21' },
  { id: 'aikan-naka-mizuno',  name: '中水野',       kana: 'なかみずの',       code: '22' },
  { id: 'aikan-kozoji',       name: '高蔵寺',       kana: 'こうぞうじ',       code: '23' },
]

async function main() {
  // 1) Operator upsert
  await prisma.operator.upsert({
    where: { id: OPERATOR.id },
    update: {
      name: OPERATOR.name,
      aliases: OPERATOR.aliases,
      kinds: OPERATOR.kinds,
    },
    create: OPERATOR,
  })
  // eslint-disable-next-line no-console
  console.log(`Operator: ${OPERATOR.id} upserted`)

  // 2) Line upsert
  await prisma.line.upsert({
    where: { id: LINE.id },
    update: {
      name: LINE.name,
      kind: LINE.kind,
      operator: LINE.operator,
      operatorId: LINE.operatorId,
    },
    create: LINE,
  })
  // eslint-disable-next-line no-console
  console.log(`Line: ${LINE.id} upserted`)

  // 3) Stations + StationLine upsert
  let upserted = 0
  for (const s of STATIONS) {
    await prisma.station.upsert({
      where: { id: s.id },
      update: { name: s.name, kana: s.kana, operatorId: OPERATOR.id },
      create: { id: s.id, name: s.name, kana: s.kana, operatorId: OPERATOR.id },
    })
    // StationLine は (stationId, lineId) 複合キーで upsert
    await prisma.stationLine.upsert({
      where: {
        stationId_lineId: { stationId: s.id, lineId: LINE.id },
      },
      update: { code: s.code },
      create: { stationId: s.id, lineId: LINE.id, code: s.code },
    })
    upserted++
  }
  // eslint-disable-next-line no-console
  console.log(`Stations: ${upserted} 件 upserted (with code)`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
