/**
 * 路線関連のクライアント層。
 *
 * - 静的 `LINES`: マスタは意図的に空 (US-011 で東海4県を取り込むまで)。
 * - `useLines()`: GET /api/lines を叩く API 経由フック。管理画面 (US-012) で使用。
 *   既存 routes 系画面 (RouteRegister/Edit/List/Detail/StationPicker) は引き続き
 *   静的 `LINES` を参照しており、US-011 のタイミングで本フックに切り替える前提。
 *
 * 詳細は docs/adr/0005-master-data-source.md, docs/adr/0006-master-admin.md。
 */
import { useCallback, useEffect, useState } from 'react'

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

export type ApiLine = {
  id: string
  name: string
  kind: LineKind
  operator: string | null
  routeSegmentCount: number
  stationCount: number
}

export type UseLinesResult = {
  lines: ApiLine[] | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useLines(opts?: { enabled?: boolean }): UseLinesResult {
  const enabled = opts?.enabled ?? true
  const [lines, setLines] = useState<ApiLine[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('http://localhost:3000/api/lines', {
          credentials: 'include',
        })
        if (cancelled) return
        if (!res.ok) {
          setError('路線一覧の取得に失敗しました')
          setLines([])
          return
        }
        const body = (await res.json()) as { lines: ApiLine[] }
        setLines(body.lines)
      } catch {
        if (!cancelled) {
          setError('路線一覧の取得に失敗しました')
          setLines([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tick, enabled])

  return { lines, loading, error, reload }
}
