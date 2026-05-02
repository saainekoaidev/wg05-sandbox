import { execSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(__dirname, '..', '..')
const testDbPath = resolve(backendDir, 'prisma', 'test.db')
const testDbJournalPath = `${testDbPath}-journal`

// アプリ側コード (auth.ts / db.ts → PrismaClient) が import される前に
// テスト用の env を確定させる。.env で設定された dev.db / 本番 SECRET を上書きする。
process.env.DATABASE_URL = 'file:./test.db'
process.env.BETTER_AUTH_SECRET =
  'test-secret-deterministic-deadbeef-cafebabe-1234567890abcdef'
process.env.BETTER_AUTH_URL = 'http://localhost:3000'

// Prisma の destructive-action ガードを避けるため、test.db を fs で直接削除し、
// 残った空の状態に対して非破壊な `prisma db push` でスキーマを適用する。
try {
  if (existsSync(testDbPath)) unlinkSync(testDbPath)
  if (existsSync(testDbJournalPath)) unlinkSync(testDbJournalPath)
} catch {
  // 削除失敗 (掴まれている場合等) は push に委ねる
}

execSync('npx prisma db push --skip-generate', {
  cwd: backendDir,
  stdio: 'pipe',
  env: { ...process.env },
})
