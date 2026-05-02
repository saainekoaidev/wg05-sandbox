// アプリ側コード (auth.ts / db.ts → PrismaClient) が import される前にテスト用の env を確定させる。
// .env で設定された dev.db / 本番 SECRET を上書きすることが目的。
// test.db のスキーマ整備は global-setup.ts で run 全体に1回だけ行う。
process.env.DATABASE_URL = 'file:./test.db'
process.env.BETTER_AUTH_SECRET =
  'test-secret-deterministic-deadbeef-cafebabe-1234567890abcdef'
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
