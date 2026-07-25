import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }

  // Lokaler Testmodus: Nur für den Betrieb auf dem eigenen Rechner.
  // NIEMALS auf einem öffentlich erreichbaren Server setzen!
  if (!ctx.user && process.env.LOCAL_AUTH_BYPASS === "1") {
    try {
      const { upsertUser, findUserByUnionId } = await import(
        "./queries/users"
      );
      await upsertUser({
        unionId: "local-test-user",
        name: "Lokaler Test",
        role: "admin",
        lastSignInAt: new Date(),
      });
      ctx.user = await findUserByUnionId("local-test-user");
    } catch (e) {
      console.warn("[auth] LOCAL_AUTH_BYPASS fehlgeschlagen:", e);
    }
  }
  return ctx;
}
