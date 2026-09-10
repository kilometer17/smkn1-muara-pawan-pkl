import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

export function getConfig(overrides = {}) {
  const maxFileMb = Number(process.env.MAX_FILE_MB || 50);

  return {
    rootDir,
    dataDir: process.env.DATA_DIR || path.join(rootDir, "data"),
    uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, "uploads"),
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "0.0.0.0",
    sessionSecret:
      process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
    secureCookies: process.env.NODE_ENV === "production",
    maxFileBytes: Math.max(1, maxFileMb) * 1024 * 1024,
    ...overrides,
  };
}
