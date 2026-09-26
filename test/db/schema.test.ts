import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetSchemaState } from "../../src/schema.js";
import { addSuggestedCompetitors, MAX_COMPETITORS } from "../../src/research/brand.js";

const admin = process.env.TEST_DATABASE_URL!;
const created: string[] = [];

async function newDb(): Promise<pg.Pool> {
  const name = `cie_schema_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`create database ${name}`);
  await c.end();
  created.push(name);
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString(), options: "-c search_path=ideation,public,extensions" });
}

afterAll(async () => {
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  for (const n of created) await c.query(`drop database if exists ${n} with (force)`);
  await c.end();
});

const applied = async (pool: pg.Pool) => (await pool.query("select name from ideation._migrations order by name")).rows.map((r) => r.name);

describe("automatic migrations", () => {
  it("builds a fresh database, and is idempotent", async () => {
    const pool = await newDb();
    resetSchemaState();
    await ensureSchema(pool);
    resetSchemaState();
    await ensureSchema(pool);
    expect(await applied(pool)).toEqual(["0001_ideation_schema.sql", "0002_analytics_and_learning.sql", "0003_brand_research.sql"]);
    const cols = (await pool.query("select column_name from information_schema.columns where table_schema = 'ideation' and table_name = 'brand_brains'")).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["description", "industry", "social_links", "competitor_suggestions", "research"]));
    const rls = await pool.query("select count(*)::int as n from pg_tables where schemaname = 'ideation' and not rowsecurity");
    expect(rls.rows[0].n).toBe(0);
    await pool.end();
  });

  it("recognises tables created by hand in the SQL editor and only adds what's new", async () => {
    const pool = await newDb();
    for (const f of ["0001_ideation_schema.sql", "0002_analytics_and_learning.sql"]) await pool.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await pool.query("insert into ideation.workspaces (id, studio_workspace_id, name) values ('wsp_keep', 's', 'Existing')");
    resetSchemaState();
    await ensureSchema(pool);
    expect(await applied(pool)).toHaveLength(3);
    expect((await pool.query("select name from ideation.workspaces")).rows).toEqual([{ name: "Existing" }]);
    await pool.end();
  });

  it("competitor picks never exceed the limit; auto takes the strongest", async () => {
    const pool = await newDb();
    resetSchemaState();
    await ensureSchema(pool);
    await pool.query("insert into workspaces (id, studio_workspace_id, name) values ('wsp_c', 's', 'C')");
    const sugg = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => ({ name: `${n} Co`, website: null, why: "", overlap: [], market: "", confidence: i < 3 ? "high" : "low", handles: { instagram: `${n.toLowerCase()}co` } }));
    await pool.query("insert into brand_brains (workspace_id, goal, language, competitor_suggestions) values ('wsp_c', 'leads', 'en', $1)", [JSON.stringify(sugg)]);
    await pool.query("insert into competitors (id, workspace_id, name, handles) values ('cmp_x', 'wsp_c', 'Mine', '{}')");
    const picked = await addSuggestedCompetitors(pool, "wsp_c", { names: ["B Co", "D Co"] });
    expect(picked.added).toEqual(["B Co", "D Co"]);
    const auto = await addSuggestedCompetitors(pool, "wsp_c", { auto: true });
    expect(auto.added).toEqual(["A Co", "C Co"]);
    expect(auto.skipped.length).toBeGreaterThan(0);
    expect((await pool.query("select count(*)::int as n from competitors where workspace_id = 'wsp_c'")).rows[0].n).toBe(MAX_COMPETITORS);
    await pool.end();
  });
});
