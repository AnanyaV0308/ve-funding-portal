import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { initialRoles } from "@ve/core";
import { accounts, auditLog, db, sessions, userRoles, users, verificationTokens } from "@ve/db";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/** The local "sign in as a demo user" option. Never available in a production build. */
export const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
export const microsoftEnabled = Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID);

const providers: NextAuthConfig["providers"] = [];

if (microsoftEnabled) {
  // Phase 1 asks Microsoft for sign-in only. Mail and calendar scopes are added with email sync in Phase 2.
  providers.push(
    MicrosoftEntraID({
      authorization: { params: { scope: "openid profile email User.Read" } },
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Demo user",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const user = await db.query.users.findFirst({ where: eq(users.email, email) });
        return user ?? null;
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // JWT sessions so the dev login works alongside Microsoft. Roles are read from the database on
  // every request (see lib/authz.ts), so a role change takes effect immediately.
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/signin" },
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      const roles = initialRoles(user.email, process.env.ADMIN_EMAILS);
      await db
        .insert(userRoles)
        .values(roles.map((role) => ({ userId: user.id!, role })))
        .onConflictDoNothing();
      await db.insert(auditLog).values({
        actorId: user.id,
        action: "user.created",
        targetType: "user",
        targetId: user.id,
        detail: { roles },
      });
    },
    async signIn({ user, account }) {
      if (!user.id) return;
      await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
      await db.insert(auditLog).values({
        actorId: user.id,
        action: "user.signed_in",
        targetType: "user",
        targetId: user.id,
        detail: { provider: account?.provider ?? null },
      });
    },
  },
});
