import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@dialix/db";
import { env } from "./env.js";

export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type Database = typeof db;
