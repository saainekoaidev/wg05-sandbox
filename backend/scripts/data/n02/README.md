# 国土数値情報 N02 (鉄道) GeoJSON キャッシュ

このディレクトリは [国土数値情報 N02](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02.html) (国土交通省 国土政策局) の GeoJSON ファイルを置く場所です。`*.geojson` / `*.zip` は `.gitignore` で除外しているため commit されません。

US-045 / [ADR 0016](../../../../docs/adr/0016-n02-secondary-source.md) の N02 補完取り込みで使用します。

## ダウンロード手順

1. https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02.html へアクセス
2. 最新年度 (例: 令和5年/N02-23) の **全国版 GeoJSON** をダウンロード
   - データ規約に同意して zip を取得
3. zip を展開し、得られた `N02-XX_Station.geojson` (駅データ Point feature) を本ディレクトリに配置
   - ファイル名は何でも良い (拡張子 `.geojson` であれば検出される)
4. `pnpm --filter backend exec tsx scripts/import-master-tokai.ts --clean` を実行
   - Wikidata 取り込み完了後に N02 補完が自動で走る
   - キャッシュが無い場合は警告を出して N02 補完だけスキップ (Wikidata 取り込みは継続)

## 取り扱い注意

- 国土数値情報のライセンスは商用利用可ですが、**出典明示** が必要です。アプリ画面で表示する場合は「国土交通省 国土政策局 国土情報課『国土数値情報 (鉄道データ)』」と表示してください。
- 4 県 (愛知/岐阜/三重/静岡) のスコープ外データは `N02_BBOX` でフィルタされて DB に入りません。
- バージョン (取得年度) は ADR 0016 の Decision §B に従い明示的に固定してください。古いデータで取り込んだ場合は再ダウンロードして再取込。

## 想定するファイル構造

例: 国交省ダウンロードサービスから取得した zip を展開した結果

```
backend/scripts/data/n02/
├── README.md             (このファイル)
├── N02-23_Station.geojson   (駅 Point feature の GeoJSON)
└── N02-23_RailroadSection.geojson  (路線 LineString feature, 当面は使わない)
```

このスクリプトは `*.geojson` 全部を読み Point geometry のみを駅として処理します。
