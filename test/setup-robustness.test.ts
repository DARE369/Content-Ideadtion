import { afterEach, describe, expect, it } from "vitest";
import { config, ConfigError, resetConfig } from "../src/config.js";
import { sslFor } from "../src/db.js";
import { explain } from "../src/server/errors.js";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetConfig(); });

describe("settings pasted into a dashboard", () => {
  it("tolerates case, spaces and quotes", () => {
    process.env.AUTH_MODE = " Open ";
    process.env.HTTP_USER_AGENT = '"ContentIdeationEngine/0.1 (me@example.com)"';
    process.env.WORKSPACE_DAILY_BUDGET_USD = "2 ";
    process.env.EMBED_URL = "";
    const c = config();
    expect(c.AUTH_MODE).toBe("open");
    expect(c.HTTP_USER_AGENT).toBe("ContentIdeationEngine/0.1 (me@example.com)");
    expect(c.WORKSPACE_DAILY_BUDGET_USD).toBe(2);
    expect(c.EMBED_URL).toBeUndefined();
  });

  it("names the bad variable without echoing its value", () => {
    process.env.AUTH_MODE = "sometimes";
    process.env.DB_POOL_MAX = "three";
    let err: unknown;
    try { config(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain("AUTH_MODE");
    expect((err as Error).message).toContain("DB_POOL_MAX");
    expect((err as Error).message).not.toContain("sometimes");
  });
});

describe("database TLS", () => {
  it("encrypts hosted databases and leaves local ones alone", () => {
    expect(sslFor("postgresql://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres")).toEqual({ rejectUnauthorized: false });
    expect(sslFor("postgresql://postgres@localhost/postgres")).toBeUndefined();
    expect(sslFor("postgresql://postgres@localhost/db?host=/var/tmp&port=54329")).toBeUndefined();
    expect(sslFor("postgresql://u:p@db.example.com/x?sslmode=disable")).toBe(false);
    expect(sslFor("postgresql://u:p@db.example.com/x?sslmode=require")).toBeUndefined();
  });
});

describe("setup errors people can act on", () => {
  it("explains the common Supabase mistakes", () => {
    expect(explain({ code: "42P01", message: 'relation "workspaces" does not exist' })).toMatch(/SQL files/);
    expect(explain({ code: "28P01", message: "password authentication failed" })).toMatch(/password/);
    expect(explain({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" })).toMatch(/host/);
    expect(explain({ code: "XX000", message: "Tenant or user not found" })).toMatch(/Session pooler/);
    expect(explain({ message: 'prepared statement "x" already exists' })).toMatch(/6543/);
    expect(explain(new ConfigError("AUTH_MODE is wrong"))).toBe("AUTH_MODE is wrong");
    expect(explain(new Error("something else"))).toBeNull();
  });
});
