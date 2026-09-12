import { readdir } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "../drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const files = (await readdir(drizzleDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.file(join(drizzleDir, file));
  }
  await sql.end({ timeout: 5 }).catch(() => undefined);
  console.log("Dialix database migrated.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
