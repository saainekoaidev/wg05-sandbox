/**
 * 路線セレクトの選択肢。
 * docs/ui-screens/screen_design_route_register.md §3.3 のリストと、
 * backend/prisma/seed.ts の Line.id と一致させる (FK 制約のため)。
 *
 * 将来 GET /api/lines で動的取得に切替えやすいよう、shape は API 互換にしてある。
 */

export type LineKind = 'train' | 'subway' | 'bus' | 'other'

export type Line = {
  id: string
  name: string
  kind: LineKind
}

export const LINES: ReadonlyArray<Line> = [
  { id: 'jr-yamanote', name: 'JR山手線', kind: 'train' },
  { id: 'jr-chuo', name: 'JR中央線', kind: 'train' },
  { id: 'jr-keihin-tohoku', name: 'JR京浜東北線', kind: 'train' },
  { id: 'metro-ginza', name: '東京メトロ銀座線', kind: 'subway' },
  { id: 'metro-marunouchi', name: '東京メトロ丸ノ内線', kind: 'subway' },
  { id: 'metro-fukutoshin', name: '東京メトロ副都心線', kind: 'subway' },
  { id: 'metro-chiyoda', name: '東京メトロ千代田線', kind: 'subway' },
  { id: 'toei-oedo', name: '都営大江戸線', kind: 'subway' },
  { id: 'toei-asakusa', name: '都営浅草線', kind: 'subway' },
  { id: 'tokyu-toyoko', name: '東急東横線', kind: 'train' },
  { id: 'keio', name: '京王線', kind: 'train' },
  { id: 'odakyu', name: '小田急線', kind: 'train' },
  { id: 'toei-bus-01', name: '都営バス01系統', kind: 'bus' },
  { id: 'other', name: 'その他', kind: 'other' },
]

export const KIND_OPTIONS: ReadonlyArray<{ value: LineKind; label: string }> = [
  { value: 'train', label: '電車' },
  { value: 'subway', label: '地下鉄' },
  { value: 'bus', label: 'バス' },
  { value: 'other', label: 'その他' },
]
