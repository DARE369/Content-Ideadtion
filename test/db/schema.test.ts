import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/migrations.generated.js";
import { ensureSchema, resetSchemaState } from "../../src/schema.js";
import type Anthropic from "@anthropic-ai/sdk";
import { setAnthropic } from "../../src/ai/client.js";
import { addSuggestedCompetitors, analyseFinish, analyseResearch, analyseSite, BUDGET, MAX_COMPETITORS } from "../../src/research/brand.js";

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
    expect(await applied(pool)).toEqual(MIGRATIONS.map((m) => m.name));
    expect(MIGRATIONS.map((m) => m.name).slice(0, 4)).toEqual(["0001_ideation_schema.sql", "0002_analytics_and_learning.sql", "0003_brand_research.sql", "0004_buyer_insight.sql"]);
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
    expect(await applied(pool)).toHaveLength(MIGRATIONS.length);
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

  it("website analysis degrades step by step instead of hanging", async () => {
    const pool = await newDb();
    resetSchemaState();
    await ensureSchema(pool);
    await pool.query("insert into workspaces (id, studio_workspace_id, name) values ('wsp_a', 's', 'A')");
    Object.assign(BUDGET, { crawl: 3_000, research: 300, structure: 200, structureFallback: 200 });
    // An AI that never answers until the caller gives up.
    const hang = (_: unknown, opts?: { signal?: AbortSignal }) => new Promise((_r, reject) => {
      opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const hangStream = (p: unknown, opts?: { signal?: AbortSignal }) => ({ on: () => undefined, finalMessage: () => hang(p, opts) });
    setAnthropic({ messages: { create: hang, parse: hang, stream: hangStream } } as unknown as Anthropic);
    const input = { website_url: "http://127.0.0.1:9/", goal: "leads" as const, language: null };

    const started = Date.now();
    const site = await analyseSite(pool, "wsp_a", input);
    expect(site.ok).toBe(false);
    expect(site.warning).toMatch(/couldn't open your website/);
    const research = await analyseResearch(pool, "wsp_a", input);
    expect(research.ok).toBe(false);
    expect(research.warning).toMatch(/ran out of time/);
    const draft = await analyseFinish(pool, "wsp_a", input);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(draft.brain.website_url).toBe(input.website_url);
    expect(draft.warnings[0]).toMatch(/couldn't build your profile/);
    expect(draft.name).toBe("127.0.0.1");
    const saved = (await pool.query("select draft from brand_brains where workspace_id = 'wsp_a'")).rows[0].draft;
    expect(saved.website_url).toBe(input.website_url);

    // An AI that errors outright: still a draft, with a plain-language reason.
    const fail = async () => { throw Object.assign(new Error("overloaded"), { status: 429 }); };
    setAnthropic({ messages: { create: fail, parse: fail, stream: () => ({ on: () => undefined, finalMessage: fail }) } } as unknown as Anthropic);
    expect((await analyseResearch(pool, "wsp_a", input)).warning).toMatch(/AI service is busy/);
    expect((await analyseFinish(pool, "wsp_a", input)).warnings).toHaveLength(1);
    await pool.end();
  });
});
