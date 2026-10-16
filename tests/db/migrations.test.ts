import { describe, it, expect } from "vitest";
import { createTestDb, admin } from "./harness";

describe("migrations", () => {
  it("apply cleanly and enable RLS on every public table", async () => {
    const db = await createTestDb();
    const rows = await admin<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(19);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });
});
