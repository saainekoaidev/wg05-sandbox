import { test, expect, request as pwRequest, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ADMIN_EMAIL = `e2e-admin-st-${RUN_TAG}@example.com`
const NORMAL_EMAIL = `e2e-norm-st-${RUN_TAG}@example.com`
const PASSWORD = 'TestE2E1234'

test.beforeAll(async () => {
  for (const [email, name] of [
    [ADMIN_EMAIL, 'E2E Admin Stations'],
    [NORMAL_EMAIL, 'E2E Normal Stations'],
  ]) {
    const ctx = await pwRequest.newContext()
    await ctx.post('http://localhost:3000/api/auth/sign-up/email', {
      data: { email, password: PASSWORD, name },
      failOnStatusCode: false,
    })
    await ctx.dispose()
  }
  execSync(
    `pnpm --filter backend exec tsx scripts/grant-admin.ts ${ADMIN_EMAIL}`,
    { stdio: 'pipe' },
  )
})

async function loginViaUi(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel(/メールアドレス/).fill(email)
  await page.getByLabel(/パスワード/).fill(PASSWORD)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL('/routes')
}

test.describe('US-013 駅マスタ管理 (admin)', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('一般ユーザは /admin/stations にアクセスすると 403 表示が出る', async ({
    page,
  }) => {
    await loginViaUi(page, NORMAL_EMAIL)
    await page.goto('/admin/stations')
    await expect(
      page.getByText(/このページを表示するには管理者権限が必要です/),
    ).toBeVisible()
  })

  test('管理者は /account 画面に「駅マスタ管理」リンクが見える', async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/account')
    const link = page.getByRole('link', { name: '駅マスタ管理' })
    await expect(link).toHaveAttribute('href', '/admin/stations')
  })

  test('管理者: 路線→駅の作成・編集・削除フル往復', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL)

    // 1. 先に路線を作成 (チェックボックスに乗せるため)
    await page.goto('/admin/lines')
    const lineId = `e2e-line-st-${RUN_TAG}`
    const lineName = `E2EST路線-${RUN_TAG}`
    await page.getByRole('button', { name: '+ 新規作成' }).first().click()
    await page.getByLabel(/^ID/).fill(lineId)
    await page.getByLabel(/^路線名/).fill(lineName)
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByText('路線を作成しました')).toBeVisible()

    // 2. 駅マスタ画面で新規駅を作成 (上記路線にチェック)
    await page.goto('/admin/stations')
    await expect(
      page.getByRole('heading', { name: '駅マスタ管理' }),
    ).toBeVisible()

    const stationId = `e2e-stn-${RUN_TAG}`
    const initialName = `E2E駅-${RUN_TAG}`
    const updatedName = `E2E駅UPD-${RUN_TAG}`
    const initialKana = 'いいきえき'
    const updatedKana = 'いいきえきうぴ'

    await page.getByRole('button', { name: '+ 新規作成' }).first().click()
    await page.getByLabel(/^ID$/).fill(stationId)
    await page.getByLabel(/^駅名/).fill(initialName)
    await page.getByLabel(/よみがな/).fill(initialKana)
    // 路線チェック
    const lineCheckbox = page.getByRole('checkbox', { name: new RegExp(lineName) })
    await lineCheckbox.check()
    await page.getByRole('button', { name: '作成する' }).click()

    await expect(page.getByText('駅を作成しました')).toBeVisible()
    await expect(page.getByText(initialName)).toBeVisible()
    // 行に路線タグ
    const row = page.locator('table tbody tr', { hasText: initialName })
    await expect(row.getByText(lineName)).toBeVisible()

    // 3. 編集 — 駅名 + よみがな更新, 路線チェックを外す
    await page.getByRole('button', { name: `駅「${initialName}」を編集` }).click()
    await expect(page.getByLabel('ID')).toBeDisabled()
    // 注意書き
    await expect(
      page.getByText(/既存経路に登録されている駅名文字列は/),
    ).toBeVisible()

    await page.getByLabel(/^駅名/).fill(updatedName)
    await page.getByLabel(/よみがな/).fill(updatedKana)
    await page.getByRole('checkbox', { name: new RegExp(lineName) }).uncheck()
    await page.getByRole('button', { name: '更新する' }).click()
    await expect(page.getByText('駅を更新しました')).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
    await expect(page.getByText(initialName)).toHaveCount(0)
    // 路線タグも消えている
    const updatedRow = page.locator('table tbody tr', { hasText: updatedName })
    await expect(updatedRow.getByText(lineName)).toHaveCount(0)
    await expect(updatedRow.getByText('未接続')).toBeVisible()

    // 4. 削除
    page.once('dialog', (d) => {
      expect(d.message()).toContain(updatedName)
      void d.accept()
    })
    await page
      .getByRole('button', { name: `駅「${updatedName}」を削除` })
      .click()
    await expect(page.getByText('駅を削除しました')).toBeVisible()
    await expect(page.getByText(updatedName)).toHaveCount(0)

    // 5. クリーンアップ: 路線も削除
    await page.goto('/admin/lines')
    page.once('dialog', (d) => void d.accept())
    await page
      .getByRole('button', { name: `路線「${lineName}」を削除` })
      .click()
    await expect(page.getByText('路線を削除しました')).toBeVisible()
  })

  test('駅名のみで作成 (ID 自動採番) → 削除', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/admin/stations')

    const name = `E2EAuto駅-${RUN_TAG}`
    const kana = `いいきあうとえき${RUN_TAG.slice(0, 4)}`
    await page.getByRole('button', { name: '+ 新規作成' }).first().click()
    // ID は空のまま
    await page.getByLabel(/^駅名/).fill(name)
    await page.getByLabel(/よみがな/).fill(kana)
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByText('駅を作成しました')).toBeVisible()

    const row = page.locator('table tbody tr', { hasText: name })
    await expect(row).toHaveCount(1)
    // 自動採番された id (cuid は通常英数字混在で長め)
    const idText = await row.locator('td code').first().textContent()
    expect(idText && idText.length).toBeGreaterThan(5)

    // 削除
    page.once('dialog', (d) => void d.accept())
    await row.getByRole('button', { name: `駅「${name}」を削除` }).click()
    await expect(page.getByText('駅を削除しました')).toBeVisible()
  })

  test('駅名空欄ではフィールドエラーが出て送信されない', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/admin/stations')
    await page.getByRole('button', { name: '+ 新規作成' }).first().click()
    await page.getByLabel(/よみがな/).fill('えき')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByText('駅名を入力してください')).toBeVisible()
  })

  test('路線マスタが空のとき新規駅フォームに /admin/lines への誘導が出る', async ({
    page,
  }) => {
    // (このテストは 路線マスタが空の状態が前提。ほかのテストで作った路線が残っている場合は
    //  期待通りにならないので、まず /admin/lines を覗いて 0 件になっているかをガードしておく)
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/admin/lines')
    const linesEmpty = await page
      .getByText('路線マスタは現在空です。')
      .isVisible()
      .catch(() => false)
    test.skip(
      !linesEmpty,
      '他テスト由来の路線が残っているため、本ケースは skip',
    )

    await page.goto('/admin/stations')
    await page.getByRole('button', { name: '+ 新規作成' }).first().click()
    await expect(page.getByText(/路線マスタが空です/)).toBeVisible()
    await expect(
      page.getByRole('link', { name: '路線マスタ管理' }),
    ).toBeVisible()
  })

  test('未ログインで /admin/stations に直接アクセスすると /login にリダイレクト', async ({
    page,
  }) => {
    await page.goto('/admin/stations')
    await expect(page).toHaveURL('/login')
  })
})
