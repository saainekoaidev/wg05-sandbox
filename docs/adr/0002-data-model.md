# 0002 データモデル設計

## Status

Accepted

## Context

### 取り扱う要件 (US-001〜US-007)

本サンドボックス ([CLAUDE.md](../../CLAUDE.md) で定義された 2〜3画面の小規模システム追体験環境) は通勤経路登録システムを題材としており、要件は [requirements.md](../requirements.md) に記載の以下7件のユーザーストーリーである:

- US-001: メールアドレスとパスワードでアカウントを新規登録
- US-002: メールアドレスとパスワードでログイン
- US-003: 出発駅・到着駅・経由駅・区間運賃を入力して通勤経路を登録 (本セッションの UI 設計過程で「種別」「路線名」も区間に持たせることが決まった)
- US-004: 自分が登録した通勤経路を一覧で確認
- US-005: 1経路の詳細情報 (経由・区間ごとの内訳) を確認
- US-006: 既存の通勤経路を編集
- US-007: 不要になった通勤経路を削除

データモデルは US-001/002 の認証系と US-003〜007 の経路 CRUD の両方を、画面側の操作 ([ui.md](../ui.md) S01〜S07) からみて欠落なく支える必要がある。

### 制約

#### 1. better-auth が要求する4テーブル

step 13 (`a46f51d`) で実装環境を一括セットアップした際に認証ライブラリとして better-auth を採用済みである。better-auth の prismaAdapter は **User / Session / Account / Verification** の4テーブルとそのフィールド形を要求し、これに準拠していなければサインアップ・ログイン・セッション管理が機能しない。具体的には User の `id` / `name` / `email` (UNIQUE) / `emailVerified` / `image` / `createdAt` / `updatedAt`、Session の `token` (UNIQUE) / `expiresAt` / `userId` (FK→User CASCADE) / `ipAddress` / `userAgent`、Account の `providerId` / `accountId` / `password` (Email/Password 認証時のハッシュ) / OAuth プロバイダ用フィールド群、Verification の `identifier` / `value` / `expiresAt` といったスキーマ要件が固定で課されている。アプリ側ドメインの都合で必須列を削除したり型を変更することはできず、保持必須である。

#### 2. SQLite + Prisma 6

永続化は SQLite を採用 (個人ローカル試行のサンドボックスでありサーバ運用不要・移行容易を優先)。ORM は Prisma で、step 13 では当初 pnpm が最新の Prisma 7 を入れたが、Prisma 7 は `datasource.url` を schema.prisma から廃止し別途 `prisma.config.ts` での adapter 設定を必須化する破壊的変更を含むため、教育目的のサンドボックスとしては安定構成を優先する判断で **Prisma 6 (`^6`) にダウングレードして固定** した。これにより従来形式の `datasource db { provider = "sqlite"; url = env("DATABASE_URL") }` が引き続き使える。SQLite はネイティブな enum 型を持たないという制約があり、enum 相当のフィールド (種別 `kind`) は文字列として保存しアプリ層で zod 検証を行う方針が前提となる。

#### 3. MVP スコープ

本サンドボックスは「要件定義 → 設計 → 製造 → テストまで一気通貫で追体験する」目的の学習環境であり ([CLAUDE.md](../../CLAUDE.md))、以下は本フェーズのスコープ外として明確に外している:

- メール認証 / パスワードリセットフロー (`Verification` テーブルは保持するが MVP 内では発行しない)
- アカウント削除 UI (User の物理削除のみで連鎖削除する設計、UI からの削除導線なし)
- ソフトデリート (Route も物理削除前提)
- 経路の他ユーザ共有 / 公開 (`Route` はオーナー専用)
- マスタ (Line / Station) の管理画面 (admin)
- マスタの自動投入 (オープンデータ取込) — 初期は手動 seed のみ

### 検討した代替案

本セッションでの設計対話を通じて、以下の代替案を検討したうえで判断を下した。

1. **路線名の保持方法 (denormalize テキスト vs 正規化マスタ)** — UI 設計の最初の改修 (種別・路線名の追加) では `lineName` を Segment に文字列列として denormalize して保持していた。しかしユーザフィードバック⑦『路線名は入力形式ではなく選択形式とすることが望ましい』を受け、`Line` マスタを新設して `RouteSegment.lineId` で参照する正規化形式に変更した。
2. **Station の種別 (kind) の保持場所** — Station テーブルに `kind` 列を直接持たせる案を検討したが、(a) 1駅が複数の路線・複数の交通機関種別をまたがるケース (例: 新宿駅で JR電車 + 地下鉄 + バス停留所が併設) を表現しにくい、(b) 駅マスタ参照画面 ([screen_design_station_master.md](../ui-screens/screen_design_station_master.md)) の検索条件「種別」は実用上「接続する Line のいずれかが該当する駅」を返したい、という2点から、Station 自体には kind を持たせず StationLine 経由で接続する Line(s) の kind から派生表示する方式を採用した。
3. **`RouteSegment.fromStation` / `toStation` の参照整合性 (Station への FK vs プレーン文字列)** — Station マスタへの FK にして参照整合性を担保する案と、プレーン文字列にして自由入力を許容する案を比較した。UI 設計 ([screen_design_route_register.md](../ui-screens/screen_design_route_register.md) §7) で「駅マスタに無い駅をフリー入力で登録することを許容する (マスタ未整備時の暫定)」と決定済みであり、駅マスタが MVP 期では未整備である現実を受け、参照整合性 < 入力柔軟性 を優先しプレーン文字列で保持する方針を採用した。
4. **Route の出発駅・到着駅の保持方法 (ユーザ入力 vs 派生)** — step 13 時点では `Route.fromStation` / `toStation` をユーザ入力フィールドとして保持する設計だった。UI 仕様の変更ご要望④『SEGMENTS で区間を追加した結果が出発駅と到着駅に自動反映される形が望ましい。ROUTE は削除して、合計運賃の左に出発駅と到着駅が SEGMENTS の入力内容によってラベルに自動表示される仕組み』を受け、これらを入力フィールドから派生フィールドへ位置づけ変更した。さらに「Route から fromStation/toStation 列を削除し、必要時に segments から都度算出する」案も比較したが、(a) 一覧表示で頻繁に使うため都度算出は JOIN コストが高い、(b) 既存テーブル列を削除するマイグレーションは破壊的、の2点から denormalize されたまま列を保持しつつサーバ保存時に segments の端点から再計算する方針 (denormalized cache) を採用した。
5. **Segment / RouteSegment の命名** — step 13 時点では Prisma モデル名 `Segment` だったが、ドメイン用語としては「経路の区間」であり `Segment` 単独では曖昧 (TCP セグメント等と紛らわしい) ため、ドメイン語として明示的な `RouteSegment` にリネームした。
6. **路線マスタ ID の採番方式 (cuid 自動 vs 手動スラッグ)** — Line は事業者・路線名と1対1対応する固定マスタであり、可読性 + seed 投入時の冪等性 (再実行で同じ ID になる) を優先して `id` は手動採番のスラッグ形式 (`jr-yamanote` 等) を採用した。
7. **Verification テーブルの保持有無** — better-auth 必須テーブルだが MVP 内で使用予定がない (メール認証・パスワードリセット未実装)。本来は不要だが、better-auth の prismaAdapter が要求するため保持必須と判断した (空のまま保持)。

## Decision

### 採用したモデル

主要エンティティは9種で、認証系4 (better-auth 保持) + ドメイン系5 (新規・改修)。

#### 認証系 (better-auth 必須・保持・改変なし)

- **User** — ユーザ本体。`id` (better-auth 発行) / `name` / `email` UNIQUE / `emailVerified` boolean (MVP では常 false) / `image` nullable / `createdAt` / `updatedAt`。多 Session / 多 Account / 多 Route のリレーション保持。
- **Session** — ログインセッション。`id` / `token` UNIQUE / `expiresAt` / `userId` FK→User ON DELETE CASCADE / `ipAddress` / `userAgent` / `createdAt` / `updatedAt`。
- **Account** — 認証手段。Email/Password 認証では `providerId="credential"`、`password` にハッシュ済み値を保持。OAuth 用フィールド群は MVP では使用しない。`userId` FK→User ON DELETE CASCADE。
- **Verification** — メール認証・パスワードリセット用 (MVP では未使用、空保持)。リレーションを持たない独立テーブル。

#### ドメイン系 (新規・改修)

- **Route** — 通勤経路。`id` cuid / `userId` FK→User ON DELETE CASCADE / `name` nullable (経路名は任意、未設定時は UI で「(無題)」表示) / `fromStation` / `toStation` (派生フィールド: segments 端点から保存時に算出) / `createdAt` / `updatedAt` (`updatedAt` は楽観ロック値としても使用)。1〜10件の RouteSegment を持つ。
- **RouteSegment** — 経路区間。step 13 時点の `Segment` をリネーム + `kind` / `lineId` を追加した。`id` cuid / `routeId` FK→Route ON DELETE CASCADE / `orderIndex` (1始まり) / `kind` 文字列 (`train|subway|bus|other`、SQLite に enum 型がないため文字列 + zod 検証) / `lineId` nullable FK→Line ON DELETE SET NULL / `fromStation` プレーン文字列 (FK にしない、フリー入力許容) / `toStation` 同様 / `fare` integer (1〜99,999 円)。索引: `(routeId, orderIndex)` 複合 + `lineId` 単一。
- **Line** — 路線マスタ。`id` 手動スラッグ (例: `jr-yamanote`) / `kind` (`train|subway|bus|other`) / `name` UNIQUE / `operator` nullable。経路登録の路線セレクトと駅マスタ参照のフィルタの両方で参照される。
- **Station** — 駅 / 停留所マスタ。`id` cuid / `name` / `kana`。種別 (`kind`) は持たず、StationLine 経由で接続する Line(s) の `kind` から派生表示する。`name` に索引。
- **StationLine** — Station ↔ Line の M:N 中間テーブル。複合主キー `(stationId, lineId)`、両側 ON DELETE CASCADE、`lineId` の逆引き索引も追加。

### 主要な設計判断とその根拠

#### 1. 派生フィールドを denormalize して Route に保持する

`Route.fromStation` / `Route.toStation` は UI 上の入力項目ではないが、Route テーブル列としては保持する。理由は (a) 経路一覧 ([screen_design_route_list.md](../ui-screens/screen_design_route_list.md)) は最頻アクセス画面で、Route のみで「出発→到着」を表示できる方が JOIN 不要で高速、(b) 既存テーブル列を削除するマイグレーションは破壊的で避けたい、の2点。サーバ側 POST/PATCH ハンドラで segments の端点から算出して保存する責務をアプリ層に置く (受信した値はサーバ側で再計算して上書きする方針)。

#### 2. RouteSegment の駅情報をプレーン文字列とする

`RouteSegment.fromStation` / `toStation` は Station マスタへの FK にせずプレーン文字列で保持する。UI 設計 ([screen_design_route_register.md](../ui-screens/screen_design_route_register.md) §7) で「駅マスタに無い駅をフリー入力で登録することを許容する」と決定済みで、MVP では駅マスタが未整備のため、参照整合性より入力の柔軟性を優先する。将来駅マスタが充実した段階で FK 化を再検討する余地は残す。

#### 3. RouteSegment.lineId は nullable FK + ON DELETE SET NULL

[screen_design_route_register.md](../ui-screens/screen_design_route_register.md) §3.3 の路線セレクトには「(未選択)」「その他」の選択肢があり、これらは `lineId = null` で表現する。さらに、マスタの Line を将来的に削除した場合でも RouteSegment 自体は保護したい (経路ごと消えてはいけない) ため、ON DELETE SET NULL とした。CASCADE は経路まで巻き込まれるので不適、RESTRICT はマスタ削除がブロックされて運用しにくいので不適。

#### 4. Station の種別を派生表示 (StationLine 経由)

1駅に複数の路線・複数の交通機関種別が接続する現実を表現するため、Station 自体には種別を持たせず、StationLine の `lineId` 経由で接続する Line(s) の `kind` 集合から派生表示する。駅マスタ参照画面 ([screen_design_station_master.md](../ui-screens/screen_design_station_master.md)) の種別フィルタは「接続する Line のいずれかが該当する駅」を返すクエリで実現する。

#### 5. enum を文字列として保存し zod でアプリ層検証

SQLite はネイティブ enum 型を持たないため `kind` (`train|subway|bus|other`) は文字列カラムとし、API 受信時に zod の `z.enum(["train","subway","bus","other"])` で検証する。SQL レベルでの enum 制約はないが、kind は致命的整合性が必要なフィールドではない (誤値は表示時のタグ色分けで「unknown」相当になるだけ) と判断した。

#### 6. CASCADE 連鎖削除の方針

User 削除 → Session / Account / Route / (Route 経由で) RouteSegment まで全て CASCADE で連鎖削除する。これにより US-007 の経路削除はもちろん、将来のアカウント削除も単一 DELETE で完結する。一方マスタ系 (Line / Station) からの CASCADE は採らない (RouteSegment.lineId は SET NULL で保護、StationLine は両側 CASCADE で junction 自体は連鎖削除)。

#### 7. RouteSegment の orderIndex 索引

US-005 (経路詳細) で 1〜10件の RouteSegment を順序通りに取得する用途のため、`(routeId, orderIndex)` 複合索引を貼る。

#### 8. better-auth スキーマの完全保持

step 13 (`a46f51d`) で導入した better-auth の4テーブル定義 (User / Session / Account / Verification) を一切変更せずに保持。これは制約セクションの通り better-auth Prisma adapter の要求であり、改変は機能不全につながる。User に `routes Route[]` のリレーションを追加するなど、追加方向の変更のみ可能。

#### 9. Prisma 6 への固定

Prisma 7 は `datasource.url` を廃止する破壊的変更を含むため、サンドボックスとしては安定構成 Prisma 6 (`^6`) を選択。これにより従来形式の `datasource db {...}` がそのまま使える。

#### 10. Segment → RouteSegment へのリネーム

ドメイン用語の明確化のため、step 13 時点の `Segment` を `RouteSegment` にリネーム。SQLite + Prisma のマイグレーションでは旧 `Segment` テーブル DROP + 新 `RouteSegment` テーブル CREATE として扱われるが、本セッション内での適用時点では旧テーブルが空だったためデータ損失は発生していない。

## Consequences

### 利点

1. **US-001〜US-007 の全件をカバー**: 認証 (User/Session/Account)、経路 CRUD (Route/RouteSegment)、駅・路線参照 (Station/Line/StationLine) が揃い、要件側からみて欠落がない。各 US がどのエンティティに対応するかは [design.md](../design.md) §3 に整理済み。
2. **better-auth の認証実装をそのまま再利用可能**: スキーマを忠実に保持したことで、サインアップ / ログイン / セッション管理は better-auth が標準提供する機能で完結する。アプリ側の認証ロジック実装が最小化される。
3. **正規化された路線情報**: 路線名が Line マスタに集約されたことで、表記ゆれ (`JR山手線` vs `JR 山手線`) が起きない。経路一覧での「種別 / 路線」サマリ ([screen_design_route_list.md](../ui-screens/screen_design_route_list.md)) も Line.name の一意性を前提にできる。
4. **派生フィールドの保持により一覧表示が高速**: `Route.fromStation` / `toStation` を保持することで、経路一覧は Route テーブル単独で「出発→到着」を取得できる (RouteSegment への JOIN 不要)。
5. **柔軟な駅入力**: `RouteSegment.fromStation` / `toStation` がプレーン文字列であるため、駅マスタが整備されていなくても経路登録は機能する。マスタ未整備の MVP 期でも US-003 の登録が成立する。
6. **マスタ削除に対する保護**: `RouteSegment.lineId` が SET NULL のため、Line を将来削除しても経路自体は残る (UI 上は「(未選択)」相当として表示される)。
7. **SQLite + Prisma 6 の安定構成**: マイグレーションが従来形式で書け、教育目的に適した素直さがある。本セッションで実際に2回 (`init` / `add_line_station_kind`) のマイグレーションを発行・適用済み。

### 代償

1. **派生フィールドの整合性責務がアプリ層に乗る**: `Route.fromStation` / `toStation` は segments から派生するため、サーバ POST/PATCH ハンドラで毎回再計算する責務が発生する。これを忘れると Route と segments で齟齬が生じうる。
2. **enum の SQL 制約がない**: `kind` が文字列のため、SQL を直接叩いて不正値 (`"train"` の typo `"trian"` 等) が入り込む可能性がある。アプリ層の zod バリデーションをバイパスされた場合の防御線がない。
3. **fromStation/toStation の表記ゆれリスク**: `RouteSegment.fromStation` / `toStation` が FK でないため、`渋谷` と `渋谷駅` のように同一駅で異なる表記が混在しうる。経路一覧の「出発→到着」表示でも同じ。
4. **Verification テーブルが空のまま保持される**: better-auth 要求のため保持しているが、MVP では使われないため空テーブルが1個常駐する形となる (実質容量は無視できる量)。
5. **Station の種別表示で常に StationLine + Line への JOIN が必要**: Station 単独で種別がわからないため、駅マスタ参照画面の表示には毎回 JOIN が伴う。MVP では件数が小さく問題ないが、データ量が増えると顕在化しうる。
6. **Prisma 6 へのバージョン固定**: 最新の Prisma 7 への追従コストが将来発生する (config 形式の移行が必要)。本セッションでは「サンドボックス安定優先」で固定したため、その判断のフォローアップは別の機会となる。
7. **Segment → RouteSegment リネームによる過去データ非互換**: 本セッション内では旧 Segment が空だったため問題なかったが、もし運用後に同種のリネームを行う場合はデータ移行のマイグレーションが別途必要になる。

### 将来のリスク

1. **駅マスタが充実した段階で fromStation/toStation を FK 化したくなる可能性**: その場合は表記ゆれの正規化マイグレーションが必要 (既存 RouteSegment の駅名を Station マスタ ID に置換する処理)。
2. **Station の kind を直接保持したくなる可能性**: パフォーマンス問題が顕在化した場合、Station.kind を denormalize する選択肢が生じる。その場合は「1駅複数種別」をどう表現するかの再設計が必要。
3. **Line マスタの管理画面が必要になる場合**: 現状は seed のみで Line の追加・更新フローがない。マスタの保守が利用拡大に追いつかなくなる可能性。
4. **他ユーザとの経路共有要件が発生した場合**: Route に visibility (`private` / `public` 等) 列を追加し、参照系クエリの権限制御を全面的に見直す必要がある。
5. **オープンデータ取込の自動化**: 国交省データ等から Station / Line / StationLine を自動投入するパイプラインを将来構築する場合、本マスタ構造との対応付け (国交省データ側の駅 ID 体系との突合せ) が必要。
6. **ソフトデリート要件の発生**: 監査・履歴管理が必要になった場合、Route に `deletedAt` 列を追加し全クエリに `WHERE deletedAt IS NULL` を入れる改修が必要。

### 他の決定への波及

1. **API 設計**: `POST /api/routes` / `PATCH /api/routes/:id` の実装で、受信 segments から `fromStation` / `toStation` を算出するロジックが必須となる。`GET /api/stations` は Station + StationLine + Line を JOIN して種別タグ込みで返却する形に。これらの API 設計は本 ADR のスコープ外で、別 ADR または実装フェーズで明文化する。
2. **seed スクリプト**: 初期データ投入のため `backend/prisma/seed.ts` の整備が必要。Line 固定リスト ([screen_design_route_register.md](../ui-screens/screen_design_route_register.md) §3.3) と代表 Station + StationLine を投入する。本セッション内では未着手。
3. **画面実装での派生算出**: 経路登録 / 編集画面 ([screen_design_route_register.md](../ui-screens/screen_design_route_register.md) / [screen_design_route_edit.md](../ui-screens/screen_design_route_edit.md)) のサマリバー JS で `fromStation` / `toStation` / 合計運賃を再計算する責務がフロント側にも発生する。HTML モックには既に `recalc()` として実装済み。
4. **CLAUDE.md の工程運用ルール遵守**: 本 ADR がデータモデル決定の根拠を残すことで、後の意思決定が過去判断を踏まえて進められる状態を保つ ([CLAUDE.md](../../CLAUDE.md) §工程運用ルール「設計判断 → ADR 記載」に合致)。

### 未確定 (本セッションの対話で判断保留 / 言及されていない事項)

以下は本セッションで結論を出していない事項であり、推測で埋めない。今後の意思決定で扱う:

- `Route.name` を必須化するか (現状 nullable で UI では任意)
- 同一ユーザ内の経路名重複を許容するか禁止するか
- 区間連結性チェック (隣接区間の到着駅 = 次区間の出発駅) をエラーにするか警告のみにするか — UI では警告で進めているがサーバ側スキーマ制約への落とし込みは未定
- 1区間目の出発駅と最終区間の到着駅が同じ循環経路を許容するか
- `Route.updatedAt` を楽観ロック値として実際にどう実装するか (UI 設計では言及あり、API 実装は未着手)
- RouteSegment 並び替え (drag) 対応の時期と並び替え時の `orderIndex` 振り直しアルゴリズム
- ソフトデリート対応の有無
- Station マスタの初期データソース (国交省 / 鉄道各社 / オープンデータ等)
- バス停留所のデータソース (自治体 / 各社データ)
- 月間費用シミュレーター (出勤日数 × 合計運賃 × 2) 用の集約テーブル設計
- 路線・駅マスタの管理画面 (admin) の必要性と権限モデル
- 認証系の追加プロバイダ (Google OAuth 等) と、その場合の Account テーブルの OAuth 関連列の運用
- パスワードリセットフロー (`Verification` を活用するかどうか)
- Prisma 7 への移行時期と手順
- テスト用 DB の分離方法 (環境変数切り替え / プロジェクト別 db ファイル / インメモリ等)
- 駅マスタのローマ字検索対応 (ローマ字列を Station に追加する必要があるかどうか)
- Account の OAuth 用フィールド (`accessToken` / `refreshToken` / `idToken` / `accessTokenExpiresAt` / `refreshTokenExpiresAt` / `scope`) の暗号化保存の要否
