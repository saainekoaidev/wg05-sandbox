# UI 設計索引

本ドキュメントは, WG05 通勤経路登録システム ([requirements.md](requirements.md)) の全画面の対応関係 / 共通設計ルール / 画面間連携を集約する。各画面の詳細仕様は `ui-screens/` 配下の個別 md を参照すること。

---

## 1. 画面一覧

| ID | 画面名 | URL | アクセス権限 | 個別設計書 | 画面イメージ |
| --- | --- | --- | --- | --- | --- |
| S01 | サインアップ | `/register` | 未認証 | [サインアップ](ui-screens/screen_design_register.md) | [register.html](ui-images/register.html) |
| S02 | ログイン | `/login` | 未認証 | [ログイン](ui-screens/screen_design_login.md) | [login.html](ui-images/login.html) |
| S03 | 経路一覧 | `/routes` | 認証必須 | [経路一覧](ui-screens/screen_design_route_list.md) | [route_list.html](ui-images/route_list.html) |
| S04 | 経路登録 | `/routes/new` | 認証必須 | [経路登録](ui-screens/screen_design_route_register.md) | [route_register.html](ui-images/route_register.html) |
| S05 | 経路詳細 | `/routes/:id` | 認証必須（オーナー） | [経路詳細](ui-screens/screen_design_route_detail.md) | [route_detail.html](ui-images/route_detail.html) |
| S06 | 経路編集 | `/routes/:id/edit` | 認証必須（オーナー） | [経路編集](ui-screens/screen_design_route_edit.md) | [route_edit.html](ui-images/route_edit.html) |
| S07 | 駅マスタ参照 | `/stations`（モーダル併用） | 認証必須 | [駅マスタ参照](ui-screens/screen_design_station_master.md) | [station_master.html](ui-images/station_master.html) |
| S08 | プロフィール設定 | `/account` | 認証必須 | [プロフィール設定](ui-screens/screen_design_account.md) | (画面イメージ未作成) |

---

## 2. ユーザーストーリー対応

| US | 内容 | 主担当画面 | 補助画面 |
| --- | --- | --- | --- |
| US-001 | アカウント新規登録 | S01 サインアップ | - |
| US-002 | ログイン | S02 ログイン | - |
| US-003 | 経路登録 | S04 経路登録 | S07 駅マスタ参照 |
| US-004 | 経路一覧 | S03 経路一覧 | - |
| US-005 | 経路詳細 | S05 経路詳細 | - |
| US-006 | 経路編集 | S06 経路編集 | S07 駅マスタ参照 |
| US-007 | 経路削除 | S05 経路詳細（削除ボタン） | S03 経路一覧（削除ボタン） |
| US-008 | プロフィール (氏名/郵便番号) 変更 | S08 プロフィール設定 | S03 経路一覧（フッタ動線） |

---

## 3. 画面遷移図

```
[未認証]
   ┌────────────────────────────┐
   │  S01 サインアップ           │  ←→  S02 ログイン
   └────────────────────────────┘                 │
              │ (登録成功 → 自動ログイン)        │ (認証成功)
              └────────────┬─────────────────────┘
                           ▼
[認証済み]
   ┌──────────────────────────────────────────────┐
   │  S03 経路一覧 (中心ハブ)                       │
   │                                              │
   │   ├→ S04 経路登録    ────(成功)──→ S05 経路詳細
   │   │     ↑↓ S07 駅マスタ参照 (モーダル)
   │   │
   │   ├→ S05 経路詳細    ────────────→ S06 経路編集
   │   │                                   ↑↓ S07 駅マスタ参照
   │   │     ←────(更新成功)────────────────
   │   │
   │   └→ 削除 (一覧 / 詳細から)  → 確認 → 一覧へ
   │
   │   ├→ S08 プロフィール設定 (一覧フッタの「ユーザー: ...」リンク)
   │   │     └→ 一覧へ戻る
   │
   └────────────── ログアウト → S02 ─┘
```

---

## 4. 共通設計ルール

### 4.1 URL 設計

- フロントエンド: SPA (Vite + React Router) でハッシュレス。サーバ Hono は `/api/*` のみを提供
- 認証必須ルートは未ログイン時 `/login` へリダイレクト
- リソース ID は cuid（Prisma 既定の文字列 ID）を採用
- 削除アクションは画面遷移ではなく `DELETE /api/routes/:id` 呼出 + 一覧再描画で実現

### 4.2 画面構成（shell パターン）

すべての画面は共通カード `.shell` を中心に構成し、上部に `.head`（青グラデの帯 + 画面タイトル + サブテキスト）、中央に本体、下部に `.foot`（補助リンク・ログアウト等）を配置する。

> 共通スタイル (`.shell` `.btn` `.group` 等) の **一次正は [frontend/src/styles/app.css](../frontend/src/styles/app.css)** に置く。docs/ui-images/ 以下の HTML モックと style.css は設計フェーズの凍結スナップショットとして保持する。詳細は [ADR 0003](adr/0003-design-system-source.md) を参照。

| パーツ | 用途 | 主要 class |
| --- | --- | --- |
| `.shell` | カード本体 | 基本 560px、一覧/詳細/編集/駅マスタ参照は `.shell--wide` (920px) |
| `.head` | タイトル領域 | `.brand`（英字小キャプション） + `.head h1` + `.head p`。右側にアクション配置時は `.head-row` |
| `form` / `.body` | 入力 / 表示領域 | `.group`（フィールド単位） / `.divider` / `.detail` `.detail-row`（読み取り専用） |
| `.actions` | フッター操作群 | `.btn` + `.btn-primary/secondary/ghost/danger` |
| `.foot` | 補助リンク | `.foot` / 左右配置時は `.foot--split` |

### 4.3 カラーパレット

| 役割 | CSS 変数 | 値 | 用途 |
| --- | --- | --- | --- |
| メインアクセント | `--blue-700` | `#2456c9` | 主要ボタン、フォーカスリング |
| ヘッダ強アクセント | `--blue-900` | `#0f2350` | `.head` 上端のグラデ起点 |
| 背景中央色 | `--bg` | `#eaf1fb` | ページ背景 |
| 危険アクション | `--danger` | `#d83a52` | 削除ボタン、エラーバナー |
| 本文色 | `--ink` | `#1a2540` | 本文テキスト、入力値 |
| 補助色 | `--muted` | `#6b7a9a` | ラベル、補助文、`.hint` |
| 罫線 | `--line` | `#d8e2f4` | 区切り線、入力枠 |

### 4.4 タイポグラフィ

- 本文: `Noto Sans JP` (400 / 500 / 700)
- 英字キャプション・セクションラベル: `Outfit` (400 / 600 / 800)、`letter-spacing: 0.3em` の英大文字で使用
- 主なサイズ: ヘッダタイトル 26px / 本文 14〜15px / ヒント・補助 11〜13px

### 4.5 ボタン規則

| 種別 | クラス | 用途 |
| --- | --- | --- |
| プライマリ | `.btn-primary` | 送信 / 登録 / 更新 / ログイン |
| セカンダリ | `.btn-secondary` | リセット / クリア |
| ゴースト | `.btn-ghost` | キャンセル / 戻る |
| 危険 | `.btn-danger` | 削除 |
| 小型 | `.btn-sm` | 一覧の行内アクション（詳細 / 編集 / 削除） |
| 駅選択 | `.btn-pick` | 入力欄横の補助ボタン（駅マスタ呼出） |
| 区間追加 | `.btn-add` | 動的フォームの行追加 |
| 区間削除 | `.btn-rm` | 動的フォームの行削除 |

並び順は左から `primary` → `secondary` → `ghost` または `danger`。`.btn-primary` は `flex: 1.6` で他より幅広に表示する。

### 4.6 テーブル規則（一覧画面 / 駅マスタ）

- ヘッダ背景は `--blue-50`、左寄せ。数値列は `.col-num` で右寄せ + tabular-nums
- 行ホバーで `--blue-50` の薄い反転
- 操作列は `.col-actions` で最右に配置し、`.btn-sm` を 6px gap で並べる
- 0件時は `<table>` を `.empty` の空状態メッセージで置換

### 4.7 入力フォーム規則

- ラベルは `.group label` で項目名 + 必須バッジ `.req`
- 入力枠は `--blue-50` 背景 + 1.5px `--line` 枠。focus 時は `--blue-700` ハイライト + 4px 透過リング
- ヒント文は `.hint` で 11px ミュート色、ラベル直下または入力直下
- 動的フォーム（区間入力）は `.segments` ボックス内に `.segment-row` を縦積み
- 入力欄横の補助ボタン（駅選択など）は `.input-with-action` で flex 配置

### 4.8 バリデーション / エラー表示規則

- クライアント側はフォーカスアウト時 + 主要ボタン押下時に実行
- フィールド単位のエラーは入力直下に赤字（実装時に `.field-error` クラスを追加予定）
- フォーム全体の致命エラーは画面上部に `.banner.is-shown`（赤背景バー）を表示
- 確認ダイアログは `window.confirm` で代用（将来 modal コンポーネント化）

### 4.9 レスポンシブ

- 520px 未満で `.actions` を縦並びに、`.segment-row` を縦積みに、`.detail-row` の label/value を縦に配置（CSS 既存対応）

---

## 5. 画面間連携

### 5.1 認証連携（S01 / S02 ↔ 認証必須画面）

- better-auth のクライアントは [frontend/src/lib/auth.ts](../frontend/src/lib/auth.ts) を全画面で利用
- `useSession()` で認証状態を取得し、認証必須画面では未認証時に `/login` へリダイレクト
- ログアウトは [経路一覧](ui-screens/screen_design_route_list.md) のフッターから実行可能

### 5.2 駅マスタ連携（S04 / S06 → S07）

- [経路登録](ui-screens/screen_design_route_register.md) / [経路編集](ui-screens/screen_design_route_edit.md) の出発駅・到着駅・各区間駅入力欄の右に「駅選択」ボタン (`.btn-pick`) を配置
- ボタン押下で [駅マスタ参照](ui-screens/screen_design_station_master.md) をモーダルで開き、「選択」ボタン押下で親フォームに駅名を返してモーダルを閉じる
- フリー入力（駅マスタ未収載駅）も許容するため、S07 を経由しない値も受け付ける

### 5.3 経路 CRUD 連携（S03 ↔ S04 / S05 / S06）

- [経路一覧](ui-screens/screen_design_route_list.md) からの遷移: 詳細 / 編集 / 削除 / 新規登録
- [経路登録](ui-screens/screen_design_route_register.md) の登録成功時 → [経路詳細](ui-screens/screen_design_route_detail.md) へ遷移（登録結果を確認できる動線）
- [経路編集](ui-screens/screen_design_route_edit.md) の更新成功時 → [経路詳細](ui-screens/screen_design_route_detail.md) へ戻る
- 削除は [経路詳細](ui-screens/screen_design_route_detail.md) と [経路一覧](ui-screens/screen_design_route_list.md) の両方から実行可能。確認ダイアログを必須とする
- 削除実行後の遷移先は [経路一覧](ui-screens/screen_design_route_list.md)。削除完了メッセージは画面遷移後にバナー表示する

### 5.4 データキー対応

- `Route`: `id` / `userId` / `name?` / `fromStation`(派生) / `toStation`(派生) / `segments[]` / `createdAt` / `updatedAt`
- `Segment`: `id` / `routeId` / `orderIndex` / **`kind` (`"train"` \| `"subway"` \| `"bus"` \| `"other"`)** / **`lineName?`** / `fromStation` / `toStation` / `fare`
- `Station` (マスタ): `id` / `kind` / `name` / `kana` / `lines[]`
- **派生フィールド**: `Route.fromStation` = `segments[0].fromStation`、`Route.toStation` = `segments[N-1].toStation` をサーバ保存時に算出。経路登録/編集画面では入力項目として表示せず、サマリバーで自動表示する
- 一覧表示の合計運賃は `segments[].fare` の合計をクライアント側で算出（将来 Prisma 集約クエリへ移行検討）
- 一覧画面の「種別 / 路線」セルは `segments[].kind` のユニーク集合（タグ表示）と `segments[].lineName` のユニーク集合（`/` 区切りテキスト）から派生
- 路線名は固定リストからの選択形式（`(未選択)` / `JR山手線` / ... / `その他`）。将来 `Line` マスタのテーブル化を予定
- ※ Prisma `Segment` モデルへの `kind` (String) / `lineName` (String?) フィールド追加が次の整合作業として残る（マイグレーション必要）

---

## 6. 用語

| 用語 | 意味 |
| --- | --- |
| 経路 | ユーザーが登録する1つの通勤経路（1〜10区間で構成） |
| 区間 | 経路を構成する1つのセグメント（種別・路線名・出発駅・到着駅・運賃） |
| 種別 | 区間の交通機関種別。データキーは `kind`、値は `train` / `subway` / `bus` / `other` のいずれか。表示色分けタグ `tag-train` / `tag-subway` / `tag-bus` / `tag-other` に対応 |
| 路線名 | 区間で利用する路線名（任意）。データキーは `lineName`、例: `JR山手線`、`東京メトロ銀座線`。空または `null` 可 |
| 駅マスタ | 駅 / 停留所名の正規候補リスト（[駅マスタ参照](ui-screens/screen_design_station_master.md) で参照）。`kind` / `name` / `kana` / `lines[]` を保持 |
| オーナー | 経路の所有ユーザー（`Route.userId` と一致するユーザー） |
| 経路名 | 経路に付ける任意のラベル（未設定時は `(無題)` として扱う） |

---

## 7. 既知の課題 / 次フェーズ候補

- 経路名を必須化するか（現状は任意）
- 区間並び替え（ドラッグ操作）の対応
- 駅マスタの初期データ整備（オープンデータの取り込み）
- 路線図ベースの選択UIの要否
- パスワードリセットフロー（[ログイン](ui-screens/screen_design_login.md) からの導線）
- ソフトデリート / 履歴管理の要否
- 月間費用シミュレーター（出勤日数 × 合計運賃 × 2）の要否
