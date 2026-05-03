/**
 * 管理者昇格 CLI。
 * 使い方: `pnpm --filter backend exec tsx scripts/grant-admin.ts <email>`
 *
 * docs/adr/0006-master-admin.md §1 に従い、画面からの admin 昇格 UI は提供しない。
 * 初回セットアップや、追加の管理者を作る際は本スクリプトを直接実行する。
 *
 * exit code:
 *   0: 成功 (role を "admin" に更新)
 *   1: 引数不正 / 該当ユーザ不在 / DB エラー
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2]
  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      'usage: tsx scripts/grant-admin.ts <email>\n' +
        '       (該当ユーザの role を "admin" に更新します)',
    )
    process.exit(1)
  }

  const before = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  })
  if (!before) {
    // eslint-disable-next-line no-console
    console.error(`user not found: email=${email}`)
    process.exit(1)
  }

  const after = await prisma.user.update({
    where: { email },
    data: { role: 'admin' },
    select: { id: true, email: true, name: true, role: true },
  })

  // eslint-disable-next-line no-console
  console.log(
    `granted: ${after.email} (${after.name})  role: ${before.role} -> ${after.role}`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
