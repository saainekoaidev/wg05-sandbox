import { test, expect } from '@playwright/test'

// run ごとに一意なメールアドレスを使用 (ローカル dev.db への蓄積汚染と並列ワーカ間の競合を避ける)。
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test.describe('US-001 サインアップフロー', () => {
  test.beforeEach(async ({ context }) => {
    // 各テストはセッション無し (Cookie 無し) で開始する
    await context.clearCookies()
  })

  test('正しい入力で登録に成功すると /routes に遷移しユーザ情報が表示される', async ({
    page,
  }) => {
    const email = `e2e-register-${RUN_TAG}@example.com`
    const password = 'TestE2E1234'
    const name = `E2E Register ${RUN_TAG}`

    await page.goto('/register')
    await expect(
      page.getByRole('heading', { name: 'アカウント登録' }),
    ).toBeVisible()

    await page.getByLabel(/メールアドレス/).fill(email)
    await page.getByLabel(/パスワード/).fill(password)
    await page.getByLabel(/お名前/).fill(name)
    await page.getByRole('button', { name: '登録する' }).click()

    // better-auth は sign-up 成功時に自動でセッションを発行するため、
    // そのまま /routes (認証必須スタブ) に着地する。
    await expect(page).toHaveURL('/routes')
    // US-014: フッタは email ではなく name を表示する
    await expect(page.getByText(`ユーザー: ${name}`)).toBeVisible()
  })

  test('既登録メールでは「既に登録されています」バナーが出て /register に留まる', async ({
    page,
    request,
  }) => {
    // 同 run 内で別ブラウザコンテキストから先に登録しておく (二重登録を確実に発生させる)。
    const email = `e2e-duplicate-${RUN_TAG}@example.com`
    const password = 'TestE2E1234'
    const name = 'Duplicate User'

    await request.post('http://localhost:3000/api/auth/sign-up/email', {
      data: { email, password, name },
      failOnStatusCode: false,
    })

    await page.goto('/register')
    await page.getByLabel(/メールアドレス/).fill(email)
    await page.getByLabel(/パスワード/).fill(password)
    await page.getByLabel(/お名前/).fill(name)
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(
      page.getByText('このメールアドレスは既に登録されています'),
    ).toBeVisible()
    await expect(page).toHaveURL('/register')
  })

  test('未入力で送信すると3つのフィールドエラーが出て /register に留まる', async ({
    page,
  }) => {
    await page.goto('/register')

    await page.getByRole('button', { name: '登録する' }).click()

    await expect(
      page.getByText('メールアドレスを入力してください'),
    ).toBeVisible()
    await expect(
      page.getByText('パスワードを入力してください'),
    ).toBeVisible()
    await expect(page.getByText('氏名を入力してください')).toBeVisible()
    await expect(page).toHaveURL('/register')
  })

  test('パスワード文字種不足ではフィールドエラーが出て /register に留まる', async ({
    page,
  }) => {
    await page.goto('/register')

    await page
      .getByLabel(/メールアドレス/)
      .fill(`e2e-pwd-${RUN_TAG}@example.com`)
    await page.getByLabel(/パスワード/).fill('alllowercase1') // 大文字なし
    await page.getByLabel(/お名前/).fill('Pwd Test')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(
      page.getByText(
        'パスワードは英大文字・小文字・数字をそれぞれ1文字以上含めてください',
      ),
    ).toBeVisible()
    await expect(page).toHaveURL('/register')
  })

  test('既ログイン状態で /register にアクセスすると /routes に自動リダイレクトする', async ({
    page,
  }) => {
    const email = `e2e-redirect-${RUN_TAG}@example.com`
    const password = 'TestE2E1234'
    const name = 'Redirect User'

    // まず登録 (= 自動ログイン)
    await page.goto('/register')
    await page.getByLabel(/メールアドレス/).fill(email)
    await page.getByLabel(/パスワード/).fill(password)
    await page.getByLabel(/お名前/).fill(name)
    await page.getByRole('button', { name: '登録する' }).click()
    await expect(page).toHaveURL('/routes')

    // 再度 /register を開くとリダイレクトされる
    await page.goto('/register')
    await expect(page).toHaveURL('/routes')
  })

  test('キャンセルボタンで入力なしなら確認なしに /login へ遷移する', async ({
    page,
  }) => {
    await page.goto('/register')

    await page.getByRole('button', { name: 'キャンセル' }).click()

    await expect(page).toHaveURL('/login')
    await expect(
      page.getByRole('heading', { name: 'ログイン' }),
    ).toBeVisible()
  })

  test('ログイン画面の「新規登録」リンクから /register に到達できる', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: '新規登録' }).click()

    await expect(page).toHaveURL('/register')
    await expect(
      page.getByRole('heading', { name: 'アカウント登録' }),
    ).toBeVisible()
  })
})
