# ADR 0020: 運営会社・種別・路線の cascade 連動 (US-050)

## Status

Accepted (2026-05-04)

## Context

US-049 で運営会社マスタを導入し, 駅マスタ管理や路線マスタ管理に operator フィルタや operator dropdown を追加した。しかし以下の課題が残った:

- 画面ごとにフィルタの並び順が不統一 (駅マスタ管理は 種別 → 路線 → 運営会社, 路線マスタ管理は 種別 のみ等)
- 種別と路線の cascade は US-017/US-020 で実装済だが, 運営会社の cascade は未実装
- 例えば駅マスタ参照 (S07) で運営会社を絞っても, 路線セレクトに別 operator の路線がそのまま表示される

利用者は 1 軸 (例: 種別=subway) を選んだら関連する他軸 (operator=名古屋市交通局, 路線=東山線/名城線) が自動的に絞られる挙動を期待している。

## Decision

### 並び順を統一

すべての画面で **運営会社 → 種別 → 路線** の順に左 → 右 (または上 → 下) に並べる。対象画面:

- S04 経路登録 (区間ごと)
- S06 経路編集 (区間ごと)
- S07 駅マスタ参照 (検索フォーム)
- S09 路線マスタ管理 (フィルタ + 路線フォーム)
- S10 駅マスタ管理 (フィルタ + 駅フォーム)

### Cascade ルール

`frontend/src/lib/cascade.ts` に純関数として実装し各画面で再利用する。

| 入力変更 | operator | kind | line |
|---|---|---|---|
| operator 選択 | (固定) | 矛盾するならクリア | 矛盾するならクリア + 一覧を operator の路線に絞る |
| kind 選択 | 候補 1 社なら自動選択 / 矛盾するならクリア | (固定) | 矛盾するならクリア + 一覧を kind に絞る |
| line 選択 | line.operatorId に hard-set | line.kind に hard-set | (固定) |

### Dropdown オプションの絞り込み方針

- **operator dropdown**: kind / line と整合する operator のみ表示
- **kind dropdown**: 常に 4 種 (train/subway/bus/other) 全表示 (4 件しかないため絞ると逆に不便)
- **line dropdown**: operator / kind と整合する line のみ表示

### 経路登録/編集の特例

`Segment` 型に UI 専用の `operator: string` フィールドを追加するが, API には送らない (segment の永続フィールドは `kind` と `lineId` のまま)。operator 選択は区間ごとの絞り込み利便性のためだけに使う。

### API 拡張

- `GET /api/stations?operator=xxx` パラメタを追加 (`Station.operatorId` 一致のみ返す)
- レスポンスに `operatorId` / `operatorName` を含める

## Consequences

### 良い影響

- 全画面で cascade 挙動が一貫し, ユーザは一度学習したら他画面にも適用できる
- 例えば「東山線」を選ぶだけで運営会社=名古屋市交通局, 種別=subway が確定し, 駅検索の絞り込みが容易
- 共通実装により今後 4 軸目を追加する場合も拡張しやすい

### 悪い影響 / トレードオフ

- 既存 US-017 / US-020 で実装した kind ↔ line の単純 cascade は cascade.ts に統合され, 旧コードが消える
- 区間 (Segment) の Type 定義に UI 専用フィールド (`operator`) が混じる。将来的に永続フィールドと UI フィールドを別 Type に分けたほうが良い場合は別途リファクタリング

## References

- docs/requirements.md US-050
- frontend/src/lib/cascade.ts (共通実装)
- 影響を受けた画面: AdminLines, AdminStations, StationPicker, RouteRegister, RouteEdit, AdminLineForm, AdminStationForm
