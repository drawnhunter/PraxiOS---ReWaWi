import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  // APP_SECRET verschluesselt die Login-Sessions (JWT) - Pflicht.
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  // Ueberbleibsel der frueheren Kimi-OAuth-Anbindung - optional, werden im
  // Stand-alone-Betrieb (Eigenes Login) nicht benoetigt.
  appId: process.env.APP_ID ?? "",
  kimiAuthUrl: process.env.KIMI_AUTH_URL ?? "",
  kimiOpenUrl: process.env.KIMI_OPEN_URL ?? "",
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
};
