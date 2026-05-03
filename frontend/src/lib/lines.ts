/**
 * 路線セレクトの選択肢。
 *
 * 2026-05-03 時点でマスタは意図的に空。
 * 東海4県の路線データを取り込む US-011 までの間、各画面の路線セレクトは
 * 空 (選択肢なし) として描画される。マスタ管理機能は US-012 で実装予定。
 *
 * 詳細は docs/adr/0005-master-data-source.md, docs/adr/0006-master-admin.md。
 *
 * 将来 GET /api/lines で動的取得に切替えやすいよう、shape は API 互換にしてある。
 */

export type LineKind = 'train' | 'subway' | 'bus' | 'other'

export type Line = {
  id: string
  name: string
  kind: LineKind
}

export const LINES: ReadonlyArray<Line> = []

export const KIND_OPTIONS: ReadonlyArray<{ value: LineKind; label: string }> = [
  { value: 'train', label: '電車' },
  { value: 'subway', label: '地下鉄' },
  { value: 'bus', label: 'バス' },
  { value: 'other', label: 'その他' },
]
