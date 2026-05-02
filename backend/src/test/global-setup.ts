import { execSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(__dirname, '..', '..')
const testDbPath = resolve(backendDir, 'prisma', 'test.db')
const journalPath = `${testDbPath}-journal`

/**
 * vitest の globalSetup として実行される。
 * - run 全体で1回だけ test.db のスキーマを最新化する (テストファイルが増えても再実行されない)
 * - Prisma の destructive-action ガードを避けるため、test.db を fs で直接削除し、
 *   残った空の状態に対して非破壊な `prisma db push` でスキーマを適用する。
 * - 各テストでの行レベルクリアは src/auth.test.ts の beforeEach (deleteMany) に任せる。
 */
export async function setup() {
  try {
    if (existsSync(testDbPath)) unlinkSync(testDbPath)
    if (existsSync(journalPath)) unlinkSync(journalPath)
  } catch {
    // 削除失敗 (掴まれている場合等) は push に委ねる
  }

  execSync('pnpm exec prisma db push --skip-generate', {
    cwd: backendDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  })
}
