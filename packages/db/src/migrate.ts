import { config } from "dotenv";
import postgres from "postgres";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0000_init.sql");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.file(sqlPath);
  console.log("Dialix database migrated.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
