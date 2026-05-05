/**
 * 共通ソート可能テーブルヘッダ (US-055 / 元 US-030)。
 *
 * クリックで sort key を切り替え, 同じ key の再クリックで asc ↔ desc をトグルする。
 * StationPicker (US-030) で導入した実装を抽出し AdminLines / AdminStations でも再利用する。
 */
export type SortDir = 'asc' | 'desc'

export type SortableThProps<TKey extends string> = {
  label: string
  column: TKey
  sortBy: TKey | null
  sortDir: SortDir
  onSort: (col: TKey) => void
  className?: string
}

export function SortableTh<TKey extends string>({
  label,
  column,
  sortBy,
  sortDir,
  onSort,
  className,
}: SortableThProps<TKey>) {
  const active = sortBy === column
  const indicator = active ? (sortDir === 'asc' ? '▲' : '▼') : ''
  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? sortDir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th
      aria-sort={ariaSort}
      onClick={() => onSort(column)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      className={className}
      title={
        active
          ? sortDir === 'asc'
            ? `${label} (昇順)。クリックで降順へ`
            : `${label} (降順)。クリックで昇順へ`
          : `${label} で並び替え`
      }
    >
      {label}
      {active && (
        <span aria-hidden="true" style={{ marginLeft: 4 }}>
          {indicator}
        </span>
      )}
    </th>
  )
}
