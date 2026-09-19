import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

/** Erkennt DB-Treiberfehler auch über verschachtelte cause-Ketten. */
function istDatenbankfehler(err: unknown): boolean {
  let e = err as { name?: unknown; code?: unknown; cause?: unknown } | null;
  for (let tiefe = 0; tiefe < 5 && e && typeof e === "object"; tiefe++) {
    if (e.name === "DrizzleQueryError") return true;
    const code = typeof e.code === "string" ? e.code : "";
    if (
      code.startsWith("ER_") ||
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "PROTOCOL_CONNECTION_LOST"
    )
      return true;
    e = e.cause as typeof e;
  }
  return false;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Rohe DB-Treiberfehler (Query, Parameter, Schema-Details) nie an den Client.
    // Fachliche TRPCError mit eigenen Meldungen bleiben unberührt.
    if (error.code === "INTERNAL_SERVER_ERROR" && istDatenbankfehler(error)) {
      console.error("[db] Fehler maskiert (volle Details nur im Server-Log):", error);
      return {
        ...shape,
        message:
          "Datenbank momentan nicht erreichbar — bitte kurz warten und erneut versuchen.",
      };
    }
    return shape;
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/** Read-Only-Allowlist der Rolle „kanzlei" (Prozedur-Pfade, Präfix-Abgleich).
 *  Alles andere (jede Mutation außer Klärungen) → 403. GoBD: lesende Zugriffe
 *  werden in kanzlei_log protokolliert. */
const KANZLEI_ERLAUBT: string[] = [
  "ping",
  "auth.me", "auth.logout",
  "invoices.list", "invoices.get", "invoices.aktivitaeten",
  "einrechnung.list", "einrechnung.get", "einrechnung.xml",
  "bankTrans.liste", "bankTrans.kontenUebersicht", "bankTrans.offeneZiele",
  "stats.uebersicht", "stats.verlauf", "stats.top", "stats.liquiditaet", "stats.ustva",
  "berichte.katalog", "berichte.bericht", "berichte.pdf", "berichte.konten",
  "export.datevBuchungsstapel",
  "customers.list", "customers.get",
  "klaerungen.", // der Schreibbereich der Kanzlei (Rückfragen-Workflow)
];

function kanzleiErlaubt(pfad: string): boolean {
  return KANZLEI_ERLAUBT.some((p) => pfad === p || pfad.startsWith(p));
}

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  // Kanzlei-Gate: read-only auf die Allowlist, alles andere 403 + Zugriffsprotokoll
  if (ctx.user.role === "kanzlei") {
    if (!kanzleiErlaubt(opts.path)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Kanzlei-Zugang: nur Lesezugriff auf Buchhaltung und Klärungen.",
      });
    }
    // GoBD-Zugriffsprotokoll (fire-and-forget, darf nie blockieren)
    import("@db/schema")
      .then(({ kanzleiLog }) =>
        import("./queries/connection").then(({ getDb }) =>
          getDb()
            .insert(kanzleiLog)
            .values({ userId: ctx.user!.id, benutzername: ctx.user!.username, pfad: opts.path })
            .catch(() => undefined),
        ),
      )
      .catch(() => undefined);
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
