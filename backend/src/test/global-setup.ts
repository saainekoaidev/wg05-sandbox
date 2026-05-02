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
 * - run 全体で1回だけ test.db のスキーマ最新化 + 共通マスタ (Line/Station/StationLine) を seed する
 * - Prisma の destructive-action ガードを避けるため fs で test.db を直接削除し、
 *   非破壊な `prisma db push` でスキーマを適用する
 * - 各テストでのユーザ系データの行レベルクリアは個別 test ファイルの beforeEach に任せる
 *   (マスタは run 中保持される)
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

  execSync('pnpm exec prisma db seed', {
    cwd: backendDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  })
}
