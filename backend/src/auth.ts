import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  trustedOrigins: ["http://localhost:5173"],
  user: {
    deleteUser: {
      // ADR 0004 §(b): 物理削除を採用。sendDeleteAccountVerification を設定しないことで
      // パスワード再認証のみで即時削除する (確認メール送信フロー無し)。
      enabled: true,
      // Session/Account/Route(→RouteSegment) は schema 側 onDelete: Cascade で連鎖削除される。
      // Verification は User と FK が無いため、ここで identifier=email を消す。
      afterDelete: async (user) => {
        await prisma.verification.deleteMany({
          where: { identifier: user.email },
        });
      },
    },
  },
});
