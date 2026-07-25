import * as cookie from "cookie";
import { z } from "zod";
import { eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { users } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, publicQuery, authedQuery, adminQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import { hashPassword, verifyPassword } from "./lib/password";
import { getDb } from "./queries/connection";
import type { TrpcContext } from "./context";

const CLIENT_ID = "local";

const benutzernameInput = z
  .string()
  .trim()
  .min(3, "Mindestens 3 Zeichen")
  .max(50)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich",
  );
const passwortInput = z.string().min(8, "Mindestens 8 Zeichen").max(200);

async function setzeSessionCookie(ctx: TrpcContext, unionId: string) {
  const token = await signSessionToken({ unionId, clientId: CLIENT_ID });
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 60 * 60 * 24 * 365,
    }),
  );
}

async function hatPasswortKonten(): Promise<boolean> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.passwordHash))
    .limit(1);
  return rows.length > 0;
}

export const authRouter = createRouter({
  // Oeffentlich: Sagt dem Login-Dialog, ob noch die Ersteinrichtung offen ist
  setupStatus: publicQuery.query(async () => ({
    needsSetup: !(await hatPasswortKonten()),
  })),

  // Ersteinrichtung: legt den ersten Admin an (nur moeglich, solange noch
  // kein Konto mit Passwort existiert)
  register: publicQuery
    .input(
      z.object({
        username: benutzernameInput,
        password: passwortInput,
        name: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (await hatPasswortKonten()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Die Ersteinrichtung ist bereits abgeschlossen. Bitte melde dich an.",
        });
      }
      const db = getDb();
      const vorhanden = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);
      if (vorhanden.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Benutzername ist bereits vergeben.",
        });
      }
      await db.insert(users).values({
        unionId: input.username,
        username: input.username,
        passwordHash: hashPassword(input.password),
        name: input.name || input.username,
        role: "admin",
        lastSignInAt: new Date(),
      });
      await setzeSessionCookie(ctx, input.username);
      return { success: true };
    }),

  login: publicQuery
    .input(z.object({ username: z.string().trim(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);
      const user = rows.at(0);
      if (
        !user?.passwordHash ||
        !verifyPassword(input.password, user.passwordHash)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Benutzername oder Passwort falsch.",
        });
      }
      await db
        .update(users)
        .set({ lastSignInAt: new Date() })
        .where(eq(users.id, user.id));
      await setzeSessionCookie(ctx, user.unionId);
      return { success: true };
    }),

  me: authedQuery.query((opts) => opts.ctx.user),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),

  // ── Benutzerverwaltung (nur Admin) ──────────────────────────────────────
  benutzer: adminQuery.query(async () => {
    const rows = await getDb()
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        lastSignInAt: users.lastSignInAt,
        hatPasswort: users.passwordHash,
      })
      .from(users);
    return rows.map((r) => ({ ...r, hatPasswort: !!r.hatPasswort }));
  }),

  benutzerAnlegen: adminQuery
    .input(
      z.object({
        username: benutzernameInput,
        password: passwortInput,
        name: z.string().trim().max(255).optional(),
        role: z.enum(["user", "admin"]).default("user"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const vorhanden = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);
      if (vorhanden.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Benutzername ist bereits vergeben.",
        });
      }
      await db.insert(users).values({
        unionId: input.username,
        username: input.username,
        passwordHash: hashPassword(input.password),
        name: input.name || input.username,
        role: input.role,
        lastSignInAt: new Date(),
      });
      return { success: true };
    }),

  benutzerPasswort: adminQuery
    .input(z.object({ id: z.number().int(), password: passwortInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(users)
        .set({ passwordHash: hashPassword(input.password) })
        .where(eq(users.id, input.id));
      return { success: true };
    }),

  benutzerLoeschen: adminQuery
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Du kannst dein eigenes Konto nicht löschen.",
        });
      }
      const db = getDb();
      const ziel = await db
        .select()
        .from(users)
        .where(eq(users.id, input.id))
        .limit(1);
      const zielUser = ziel.at(0);
      if (!zielUser) return { success: true };
      if (zielUser.role === "admin" && zielUser.passwordHash) {
        // Mindestens ein Admin mit Passwort muss bestehen bleiben
        const alle = await db.select().from(users);
        const passwortAdmins = alle.filter(
          (u) => u.role === "admin" && u.passwordHash,
        ).length;
        if (passwortAdmins <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Der letzte Admin mit Passwort kann nicht gelöscht werden.",
          });
        }
      }
      await db.delete(users).where(eq(users.id, input.id));
      return { success: true };
    }),
});
