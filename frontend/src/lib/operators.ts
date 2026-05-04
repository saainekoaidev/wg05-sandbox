/**
 * 運営会社マスタ (US-049 / ADR 0019) のクライアント層。
 *
 * 経路登録 / 路線フォーム / 駅フォームの operator 選択 dropdown で参照する。
 */
import { useCallback, useEffect, useState } from 'react'
import type { LineKind } from './lines'

export type ApiOperator = {
  id: string
  name: string
  aliases: string[]
  /// US-052: 当該 operator が運営する路線種別。
  kinds: LineKind[]
}

export type ApiAdminOperator = ApiOperator & {
  lineCount: number
  stationCount: number
}

export type UseOperatorsResult = {
  operators: ApiOperator[] | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 認証ユーザ向けの一覧 (operator dropdown 用)。 */
export function useOperators(opts?: { enabled?: boolean }): UseOperatorsResult {
  const enabled = opts?.enabled ?? true
  const [operators, setOperators] = useState<ApiOperator[] | null>(null)
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
        const res = await fetch('http://localhost:3000/api/operators', {
          credentials: 'include',
        })
        if (cancelled) return
        if (!res.ok) {
          setError('運営会社一覧の取得に失敗しました')
          setOperators([])
          return
        }
        const body = (await res.json()) as { operators: ApiOperator[] }
        setOperators(body.operators)
      } catch {
        if (!cancelled) {
          setError('運営会社一覧の取得に失敗しました')
          setOperators([])
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

  return { operators, loading, error, reload }
}

export type UseAdminOperatorsResult = {
  operators: ApiAdminOperator[] | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 管理画面向けの一覧 (件数情報同梱)。 */
export function useAdminOperators(opts?: {
  enabled?: boolean
}): UseAdminOperatorsResult {
  const enabled = opts?.enabled ?? true
  const [operators, setOperators] = useState<ApiAdminOperator[] | null>(null)
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
        const res = await fetch('http://localhost:3000/api/admin/operators', {
          credentials: 'include',
        })
        if (cancelled) return
        if (!res.ok) {
          setError('運営会社一覧の取得に失敗しました')
          setOperators([])
          return
        }
        const body = (await res.json()) as { operators: ApiAdminOperator[] }
        setOperators(body.operators)
      } catch {
        if (!cancelled) {
          setError('運営会社一覧の取得に失敗しました')
          setOperators([])
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

  return { operators, loading, error, reload }
}
