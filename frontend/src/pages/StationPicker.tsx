import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '../lib/auth'
import { LINES, type LineKind } from '../lib/lines'

type ApiStation = {
  id: string
  name: string
  kana: string
  lines: Array<{ id: string; name: string; kind: LineKind; operator: string | null }>
}

type ApiResponse = { stations: ApiStation[] }

const KIND_TAG_CLASS: Record<LineKind, string> = {
  train: 'tag tag-train',
  subway: 'tag tag-subway',
  bus: 'tag tag-bus',
  other: 'tag tag-other',
}

const KIND_LABEL: Record<LineKind, string> = {
  train: '電車',
  subway: '地下鉄',
  bus: 'バス',
  other: 'その他',
}

function isOpenedAsPopup(): boolean {
  try {
    return Boolean(window.opener && !window.opener.closed)
  } catch {
    return false
  }
}

export function StationPicker() {
  const { data: session, isPending } = useSession()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'' | LineKind>('')
  const [lineId, setLineId] = useState('')
  const [stations, setStations] = useState<ApiStation[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isPending && !session) {
    return <Navigate to="/login" replace />
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSearched(true)
    if (!q.trim() && !kind && !lineId) {
      setError('駅名・種別・路線のいずれかを入力または選択してください')
      setStations([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (kind) params.set('kind', kind)
      if (lineId) params.set('line', lineId)
      const res = await fetch(`http://localhost:3000/api/stations?${params}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        setError('駅マスタの取得に失敗しました。再読み込みをお試しください')
        setStations([])
        return
      }
      const body = (await res.json()) as ApiResponse
      setStations(body.stations)
    } catch {
      setError('駅マスタの取得に失敗しました。再読み込みをお試しください')
      setStations([])
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setQ('')
    setKind('')
    setLineId('')
    setStations(null)
    setSearched(false)
    setError(null)
  }

  function handlePick(name: string) {
    if (isOpenedAsPopup()) {
      try {
        window.opener!.postMessage(
          { type: 'station-pick', name },
          window.location.origin,
        )
      } catch {
        // postMessage 失敗時は単に閉じる
      }
      window.close()
    }
    // 単独画面で叩かれた場合は何もしない (将来 routes 一覧へ navigate して
    // 値を引き継ぐ等の拡張余地あり)。
  }

  function handleClose() {
    if (isOpenedAsPopup()) {
      window.close()
    }
  }

  const popupMode = isOpenedAsPopup()

  return (
    <div className="shell shell--wide">
      <div className="head">
        <div className="brand">Station Master</div>
        <h1>駅マスタ参照</h1>
        <p>
          {popupMode
            ? '駅を選択すると呼出元のフォームに反映されます'
            : 'キーワード・種別・路線で駅 / 停留所を検索できます'}
        </p>
      </div>

      <div className="body">
        <form className="search-row" onSubmit={handleSearch} noValidate>
          <div className="group">
            <label htmlFor="picker-q">駅名 / よみがな</label>
            <input
              id="picker-q"
              type="text"
              placeholder="しぶや / 渋谷"
              maxLength={30}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="group group--narrow">
            <label htmlFor="picker-kind">種別</label>
            <select
              id="picker-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as '' | LineKind)}
            >
              <option value="">すべて</option>
              <option value="train">電車</option>
              <option value="subway">地下鉄</option>
              <option value="bus">バス</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div className="group">
            <label htmlFor="picker-line">路線</label>
            <select
              id="picker-line"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              <option value="">すべての路線</option>
              {LINES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '検索中…' : '検索'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={loading}
          >
            クリア
          </button>
        </form>

        {error && <div className="banner is-shown">{error}</div>}

        {searched && stations && stations.length === 0 && !error && (
          <div className="empty">
            該当する駅が見つかりませんでした。条件を変えてお試しください
          </div>
        )}

        {stations && stations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th>種別</th>
                  <th>駅名 / 停留所</th>
                  <th>よみがな</th>
                  <th>主要路線</th>
                  <th className="col-actions">選択</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => {
                  // 接続する路線の種別ユニーク集合 (表示用タグ)
                  const kinds = Array.from(new Set(s.lines.map((l) => l.kind)))
                  return (
                    <tr key={s.id}>
                      <td className="col-num">{i + 1}</td>
                      <td>
                        {kinds.map((k) => (
                          <span key={k} className={KIND_TAG_CLASS[k]}>
                            {KIND_LABEL[k]}
                          </span>
                        ))}
                      </td>
                      <td>{s.name}</td>
                      <td>{s.kana}</td>
                      <td>{s.lines.map((l) => l.name).join(', ')}</td>
                      <td>
                        <div className="col-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handlePick(s.name)}
                            aria-label={`${s.name} を選択`}
                          >
                            選択
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="actions actions--no-divider"
          style={{ marginTop: '24px' }}
        >
          <button type="button" className="btn btn-ghost" onClick={handleClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
