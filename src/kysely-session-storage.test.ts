import { Session } from "@shopify/shopify-api";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KyselySessionStorage } from "./kysely-session-storage";
import { sessionTableMigration } from "./migrations";
import type { SessionDatabase } from "./session-table";

let container: StartedPostgreSqlContainer;
let db: Kysely<SessionDatabase>;
let storage: KyselySessionStorage<SessionDatabase>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  db = new Kysely<SessionDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: container.getConnectionUri() }),
    }),
  });
  await sessionTableMigration.up(db);
  storage = new KyselySessionStorage(db);
});

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

beforeEach(async () => {
  await db.deleteFrom("Session").execute();
});

function offlineSession(id: string, overrides: Partial<Session> = {}) {
  return new Session({
    id,
    shop: "my-shop.myshopify.com",
    state: "test-state",
    isOnline: false,
    scope: "read_products",
    accessToken: "offline-token",
    ...overrides,
  });
}

describe("KyselySessionStorage", () => {
  it("stores and loads an offline session", async () => {
    const session = offlineSession("offline_1");

    expect(await storage.storeSession(session)).toBe(true);

    const loaded = await storage.loadSession(session.id);
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.shop).toBe(session.shop);
    expect(loaded?.state).toBe(session.state);
    expect(loaded?.isOnline).toBe(false);
    expect(loaded?.scope).toBe("read_products");
    expect(loaded?.accessToken).toBe("offline-token");
  });

  it("round-trips the expiry date", async () => {
    const expires = new Date("2030-01-01T12:34:56.000Z");
    const session = offlineSession("offline_expires", { expires });

    await storage.storeSession(session);

    const loaded = await storage.loadSession(session.id);
    expect(loaded?.expires?.getTime()).toBe(expires.getTime());
  });

  it("stores a session without an expiry", async () => {
    const session = offlineSession("offline_no_expiry");

    await storage.storeSession(session);

    const loaded = await storage.loadSession(session.id);
    expect(loaded?.expires).toBeUndefined();
  });

  it("updates an existing session on conflicting id", async () => {
    const session = offlineSession("offline_upsert", {
      accessToken: "first",
    });
    await storage.storeSession(session);

    const updated = offlineSession("offline_upsert", { accessToken: "second" });
    await storage.storeSession(updated);

    const loaded = await storage.loadSession("offline_upsert");
    expect(loaded?.accessToken).toBe("second");
    expect(await db.selectFrom("Session").selectAll().execute()).toHaveLength(
      1,
    );
  });

  it("stores and loads an online session with user info", async () => {
    const session = new Session({
      id: "online_user",
      shop: "my-shop.myshopify.com",
      state: "test-state",
      isOnline: true,
      accessToken: "online-token",
      scope: "read_products",
      expires: new Date("2030-01-01T00:00:00.000Z"),
      onlineAccessInfo: {
        expires_in: 3600,
        associated_user_scope: "read_products",
        associated_user: {
          id: 12345,
          first_name: "Jane",
          last_name: "Doe",
          email: "jane@example.com",
          email_verified: true,
          account_owner: true,
          locale: "en",
          collaborator: false,
        },
      },
    });

    await storage.storeSession(session);

    const loaded = await storage.loadSession(session.id);
    expect(loaded?.isOnline).toBe(true);
    const user = loaded?.onlineAccessInfo?.associated_user;
    expect(user?.id).toBe(12345);
    expect(user?.first_name).toBe("Jane");
    expect(user?.last_name).toBe("Doe");
    expect(user?.email).toBe("jane@example.com");
    expect(user?.email_verified).toBe(true);
    expect(user?.account_owner).toBe(true);
    expect(user?.locale).toBe("en");
    expect(user?.collaborator).toBe(false);
  });

  it("ignores unexpected fields on the session", async () => {
    const session = offlineSession("offline_extra");
    (session as unknown as Record<string, unknown>).somethingExtra = "ignored";

    expect(await storage.storeSession(session)).toBe(true);
    expect((await storage.loadSession(session.id))?.id).toBe(session.id);
  });

  it("returns undefined for a missing session id", async () => {
    expect(await storage.loadSession("does-not-exist")).toBeUndefined();
  });

  it("deletes a session by id", async () => {
    const session = offlineSession("offline_delete");
    await storage.storeSession(session);

    expect(await storage.deleteSession(session.id)).toBe(true);
    expect(await storage.loadSession(session.id)).toBeUndefined();
  });

  it("deletes a batch of sessions by id", async () => {
    await storage.storeSession(offlineSession("offline_a"));
    await storage.storeSession(offlineSession("offline_b"));
    await storage.storeSession(offlineSession("offline_c"));

    expect(await storage.deleteSessions(["offline_a", "offline_b"])).toBe(true);
    expect(await storage.loadSession("offline_a")).toBeUndefined();
    expect(await storage.loadSession("offline_b")).toBeUndefined();
    expect(await storage.loadSession("offline_c")).toBeDefined();
  });

  it("finds all sessions for a given shop", async () => {
    await storage.storeSession(
      offlineSession("offline_shopA_1", { shop: "shop-a.myshopify.com" }),
    );
    await storage.storeSession(
      offlineSession("offline_shopA_2", { shop: "shop-a.myshopify.com" }),
    );
    await storage.storeSession(
      offlineSession("offline_shopB_1", { shop: "shop-b.myshopify.com" }),
    );

    const found = await storage.findSessionsByShop("shop-a.myshopify.com");
    expect(found.map((s) => s.id).sort()).toEqual([
      "offline_shopA_1",
      "offline_shopA_2",
    ]);
  });

  it("stores a scope longer than 255 characters", async () => {
    const scope = Array.from(
      { length: 40 },
      (_, i) => `read_long_scope_${i}`,
    ).join(",");
    expect(scope.length).toBeGreaterThan(255);
    const session = offlineSession("offline_long_scope", { scope });

    await storage.storeSession(session);

    expect((await storage.loadSession(session.id))?.scope).toBe(scope);
  });

  it("stores and loads refresh tokens", async () => {
    const refreshTokenExpires = new Date("2030-06-01T00:00:00.000Z");
    const session = offlineSession("offline_refresh", {
      refreshToken: "refresh-token",
      refreshTokenExpires,
    });

    await storage.storeSession(session);

    const loaded = await storage.loadSession(session.id);
    expect(loaded?.refreshToken).toBe("refresh-token");
    expect(loaded?.refreshTokenExpires?.getTime()).toBe(
      refreshTokenExpires.getTime(),
    );
  });

  it("treats deleteSessions([]) as a no-op", async () => {
    await storage.storeSession(offlineSession("offline_keep"));

    expect(await storage.deleteSessions([])).toBe(true);
    expect(await storage.loadSession("offline_keep")).toBeDefined();
  });

  it("returns an empty array for a shop with no sessions", async () => {
    expect(await storage.findSessionsByShop("nobody.myshopify.com")).toEqual(
      [],
    );
  });

  it("preserves an empty-string scope", async () => {
    const session = offlineSession("offline_empty_scope", { scope: "" });

    await storage.storeSession(session);

    expect((await storage.loadSession(session.id))?.scope).toBe("");
  });

  it("round-trips false account_owner / email_verified online", async () => {
    const session = new Session({
      id: "online_false_flags",
      shop: "my-shop.myshopify.com",
      state: "test-state",
      isOnline: true,
      accessToken: "online-token",
      onlineAccessInfo: {
        expires_in: 3600,
        associated_user_scope: "read_products",
        associated_user: {
          id: 999,
          first_name: "A",
          last_name: "B",
          email: "a@b.com",
          email_verified: false,
          account_owner: false,
          locale: "en",
          collaborator: false,
        },
      },
    });

    await storage.storeSession(session);

    const user = (await storage.loadSession(session.id))?.onlineAccessInfo
      ?.associated_user;
    expect(user?.account_owner).toBe(false);
    expect(user?.email_verified).toBe(false);
    expect(user?.collaborator).toBe(false);
  });

  it("drops the Session table on migration down", async () => {
    await sessionTableMigration.down(db);
    const tables = await db.introspection.getTables();
    expect(tables.some((t) => t.name === "Session")).toBe(false);

    // Restore the table for any remaining work against the shared container.
    await sessionTableMigration.up(db);
  });
});
