/**
 * 路線関連のクライアント層。
 *
 * 路線マスタは `GET /api/lines` 経由で動的取得する (US-011)。
 * 静的 `LINES` 配列は ADR 0007 §11 のとおり廃止し、各画面は `useLines()` フックを使用する。
 *
 * 詳細は docs/adr/0005-master-data-source.md / 0006-master-admin.md / 0007-tokai-import-spec.md。
 */
import { useCallback, useEffect, useState } from 'react'

export type LineKind = 'train' | 'subway' | 'bus' | 'other'

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
  /// US-049 / ADR 0019
  operatorId: string | null
  operatorName: string | null
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
