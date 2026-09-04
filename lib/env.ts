const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ist nicht konfiguriert.`);
  return value;
};

export const getDatabaseUrl = () => required("DATABASE_URL");
export const getSessionSecret = () => {
  const value = required("SESSION_SECRET");
  if (Buffer.byteLength(value, "utf8") < 32) throw new Error("SESSION_SECRET muss mindestens 32 Bytes lang sein.");
  return value;
};
export const getSetupToken = () => {
  const value = required("SETUP_TOKEN");
  if (Buffer.byteLength(value, "utf8") < 32) throw new Error("SETUP_TOKEN muss mindestens 32 Bytes lang sein.");
  return value;
};

export function getAppOrigin(): string {
  const value = required("APP_ORIGIN").replace(/\/$/, "");
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new Error("APP_ORIGIN muss eine vollständige HTTP(S)-Origin ohne Pfad sein.");
  }
  if (
    process.env.NODE_ENV === "production"
    && parsed.protocol !== "https:"
    && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("APP_ORIGIN muss im Produktivbetrieb HTTPS verwenden.");
  }
  return parsed.origin;
}

export function getAppTimezone(): string {
  return process.env.TZ?.trim() || "Europe/Berlin";
}
