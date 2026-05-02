import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // run 全体で1回だけ実行: test.db のスキーマ整備
    globalSetup: ['./src/test/global-setup.ts'],
    // 各テストファイルの import 直前に実行: 環境変数の上書き
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
})
