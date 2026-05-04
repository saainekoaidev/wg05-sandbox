import { test, expect, request as pwRequest, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ADMIN_EMAIL = `e2e-admin-lines-${RUN_TAG}@example.com`
const NORMAL_EMAIL = `e2e-norm-lines-${RUN_TAG}@example.com`
const PASSWORD = 'TestE2E1234'

test.beforeAll(async () => {
  // 2人分のサインアップは独立したセッション (= 別 request コンテキスト) で実行する。
  // 同じ request を使い回すと、最初のサインアップで貼り付いた cookie が
  // 2回目のリクエストにも乗り、better-auth が「ログイン中の sign-up」として扱う恐れがある。
  for (const [email, name] of [
    [ADMIN_EMAIL, 'E2E Admin Lines'],
    [NORMAL_EMAIL, 'E2E Normal Lines'],
  ]) {
    const ctx = await pwRequest.newContext()
    await ctx.post('http://localhost:3000/api/auth/sign-up/email', {
      data: { email, password: PASSWORD, name },
      failOnStatusCode: false,
    })
    await ctx.dispose()
  }
  // grant-admin CLI 経由で昇格 (実 CLI を回すことで CLI 自体も検証する)
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

test.describe('US-012 路線マスタ管理 (admin)', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('一般ユーザは /admin/lines にアクセスすると 403 表示が出る', async ({
    page,
  }) => {
    await loginViaUi(page, NORMAL_EMAIL)
    await page.goto('/admin/lines')
    await expect(
      page.getByText(/このページを表示するには管理者権限が必要です/),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: '経路一覧に戻る' }),
    ).toBeVisible()
  })

  test('管理者は /account 画面に「路線マスタ管理」リンクが見える', async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/account')
    const link = page.getByRole('link', { name: '路線マスタ管理' })
    await expect(link).toHaveAttribute('href', '/admin/lines')
  })

  test('管理者: 新規作成 → 一覧に出る → 編集 → 名前が変わる → 削除 で消える', async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/admin/lines')
    await expect(
      page.getByRole('heading', { name: '路線マスタ管理' }),
    ).toBeVisible()

    const id = `e2e-line-${RUN_TAG}`
    const initialName = `E2E路線-${RUN_TAG}`
    const updatedName = `E2E路線UPD-${RUN_TAG}`

    // 新規作成 (US-025: Link で /admin/lines/new に遷移)
    await page.getByRole('link', { name: '+ 新規作成' }).first().click()
    await expect(page).toHaveURL('/admin/lines/new')
    await page.getByLabel(/^ID/).fill(id)
    await page.getByLabel(/^路線名/).fill(initialName)
    await page.getByLabel(/^種別/).selectOption('train')
    // US-049: 運営会社は dropdown (operator id を value に持つ)
    await page.getByLabel(/運営会社/).selectOption('jr-tokai')
    await page.getByRole('button', { name: '作成する' }).click()

    await expect(page).toHaveURL('/admin/lines')
    await expect(page.getByText('路線を作成しました')).toBeVisible()
    await expect(page.getByText(initialName)).toBeVisible()
    // US-050: operator フィルタ dropdown にも "JR東海" option があるので, 一覧の行に限定する
    const newLineRow = page.locator('table tbody tr', { hasText: initialName })
    await expect(newLineRow.getByText('JR東海')).toBeVisible()

    // 編集 (US-025: Link で /admin/lines/:id/edit に遷移)
    await page
      .getByRole('link', { name: `路線「${initialName}」を編集` })
      .click()
    await expect(page).toHaveURL(`/admin/lines/${id}/edit`)
    // ID は disabled
    await expect(page.getByLabel(/^ID/)).toBeDisabled()
    const nameInput = page.getByLabel(/^路線名/)
    await nameInput.fill(updatedName)
    await page.getByRole('button', { name: '更新する' }).click()

    await expect(page).toHaveURL('/admin/lines')

    await expect(page.getByText('路線を更新しました')).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
    await expect(page.getByText(initialName)).toHaveCount(0)

    // 削除 (参照0件なので有効)
    page.once('dialog', (d) => {
      expect(d.message()).toContain(updatedName)
      void d.accept()
    })
    await page
      .getByRole('button', { name: `路線「${updatedName}」を削除` })
      .click()
    await expect(page.getByText('路線を削除しました')).toBeVisible()
    await expect(page.getByText(updatedName)).toHaveCount(0)
  })

  test('管理者: 同じ ID を 2 回作ると 409 で「同じIDまたは路線名が既に登録されています」', async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN_EMAIL)
    await page.goto('/admin/lines')

    const id = `e2e-dup-${RUN_TAG}`
    const name1 = `E2E重複1-${RUN_TAG}`
    const name2 = `E2E重複2-${RUN_TAG}`

    // 1 件目 (US-025: Link で /admin/lines/new)
    await page.getByRole('link', { name: '+ 新規作成' }).first().click()
    await page.getByLabel(/^ID/).fill(id)
    await page.getByLabel(/^路線名/).fill(name1)
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page).toHaveURL('/admin/lines')
    await expect(page.getByText('路線を作成しました')).toBeVisible()

    // 同じ ID で 2 件目 → 409 (フォーム画面に留まる)
    await page.getByRole('link', { name: '+ 新規作成' }).first().click()
    await page.getByLabel(/^ID/).fill(id)
    await page.getByLabel(/^路線名/).fill(name2)
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(
      page.getByText('同じIDまたは路線名が既に登録されています'),
    ).toBeVisible()
    await expect(page).toHaveURL('/admin/lines/new')

    // /admin/lines に戻ってから後始末
    await page.getByRole('link', { name: 'キャンセル' }).click()
    await expect(page).toHaveURL('/admin/lines')

    // 後始末: 作った行を削除
    page.once('dialog', (d) => void d.accept())
    await page
      .getByRole('button', { name: `路線「${name1}」を削除` })
      .click()
    await expect(page.getByText(name1)).toHaveCount(0)
  })

  test('未ログインで /admin/lines に直接アクセスすると /login にリダイレクト', async ({
    page,
  }) => {
    await page.goto('/admin/lines')
    await expect(page).toHaveURL('/login')
  })
})
