import type { Kysely, Migration } from "kysely";

/**
 * Creates the `Session` table (and its shop/isOnline lookup index) using
 * Kysely's dialect-aware schema builder, so it's designed to run on Postgres,
 * MySQL, and SQLite (only Postgres is covered by this package's tests).
 *
 * Run it through Kysely's own {@link https://kysely.dev/docs/migrations Migrator}
 * via {@link migrations}, or call `up`/`down` directly.
 *
 * Note: this migration is the schema source of truth for *external* consumers
 * and for this package's tests. An app that manages the `Session` table with
 * another tool (e.g. Atlas) owns its own schema and need not run this — keep the
 * two in sync if both exist.
 */
export const sessionTableMigration: Required<Migration> = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("Session")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("shop", "text", (col) => col.notNull())
      .addColumn("state", "text", (col) => col.notNull())
      .addColumn("isOnline", "boolean", (col) => col.notNull().defaultTo(false))
      .addColumn("scope", "varchar(1024)")
      .addColumn("expires", "timestamp")
      .addColumn("accessToken", "text", (col) => col.notNull().defaultTo(""))
      .addColumn("refreshToken", "text")
      .addColumn("refreshTokenExpires", "timestamp")
      .addColumn("userId", "bigint")
      .addColumn("firstName", "text")
      .addColumn("lastName", "text")
      .addColumn("email", "text")
      .addColumn("accountOwner", "boolean", (col) =>
        col.notNull().defaultTo(false),
      )
      .addColumn("locale", "text")
      .addColumn("collaborator", "boolean", (col) => col.defaultTo(false))
      .addColumn("emailVerified", "boolean", (col) => col.defaultTo(false))
      .execute();

    await db.schema
      .createIndex("Session_shop_isOnline_idx")
      .ifNotExists()
      .on("Session")
      .columns(["shop", "isOnline"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("Session").ifExists().execute();
  },
};

/**
 * Migration map keyed by name, ready to hand to a Kysely
 * `Migrator` with a static migration provider.
 */
export const migrations: Record<string, Migration> = {
  "0001_create_session_table": sessionTableMigration,
};
