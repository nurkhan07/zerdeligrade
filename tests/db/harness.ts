import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = path.resolve(__dirname, "../..");

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(root, "tests/db/supabase-stub.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

type Row = Record<string, unknown>;

/** Run a query as an authenticated user (RLS applies), like PostgREST does. */
export async function asUser<T extends Row = Row>(
  db: PGlite,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx: Transaction) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

/** Run a query as the service role (server-side code with the service key). */
export async function asService<T extends Row = Row>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx: Transaction) => {
    await tx.exec("set local role service_role");
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

/** Superuser query used to arrange fixtures. */
export async function admin<T extends Row = Row>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function createUser(db: PGlite, email: string, opts: { hq?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await admin(db, "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ full_name: email.split("@")[0] }),
  ]);
  if (opts.hq) await admin(db, "update public.profiles set is_hq_admin = true where id = $1", [id]);
  return id;
}

export async function createCenter(db: PGlite, code: string): Promise<string> {
  const [row] = await admin<{ id: string }>(
    db,
    "insert into public.centers (name, code, city) values ($1, $2, 'Almaty') returning id",
    [`Center ${code}`, code],
  );
  return row!.id;
}

export async function addMember(
  db: PGlite,
  centerId: string,
  userId: string,
  role: "center_admin" | "teacher",
  canFinalize = true,
): Promise<void> {
  await admin(db, "insert into public.center_memberships (center_id, user_id, role, can_finalize) values ($1,$2,$3,$4)", [
    centerId,
    userId,
    role,
    canFinalize,
  ]);
}

export async function expectDenied(p: Promise<unknown>, code?: RegExp): Promise<string> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (code && !code.test(msg)) throw new Error(`Expected error matching ${code}, got: ${msg}`);
    return msg;
  }
  throw new Error("Expected the operation to be denied, but it succeeded");
}
