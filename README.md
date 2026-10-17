# shopify-app-session-storage-kysely

A [Kysely](https://kysely.dev)-backed implementation of Shopify's
[`SessionStorage`](https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/session-storage/shopify-app-session-storage)
interface, for Shopify apps that already use Kysely as their query builder.

Works with any database Kysely supports (Postgres, MySQL, SQLite). Like the
official `prisma`/`drizzle` adapters, **you own the schema** — this package
ships a Kysely migration to create the table, but doesn't create it implicitly.

## Install

```sh
npm install shopify-app-session-storage-kysely
```

Peer dependencies (you almost certainly already have these):

```sh
npm install @shopify/shopify-api @shopify/shopify-app-session-storage kysely
```

Requires `kysely` 0.28.17 or later. Earlier versions have known SQL injection
advisories.

## 1. Create the `Session` table

The package exports a standard Kysely [`Migration`](https://kysely.dev/docs/migrations).
The migration uses Kysely's dialect-aware schema builder, so it's designed to
run on Postgres, MySQL, and SQLite (only Postgres is covered by this package's
tests).

Run it through Kysely's own `Migrator` (recommended — versioned, tracked):

```ts
import { Migrator } from "kysely/migration"; // `from "kysely"` on Kysely 0.28
import { migrations } from "shopify-app-session-storage-kysely";

const migrator = new Migrator({
  db,
  provider: { getMigrations: async () => migrations },
});

await migrator.migrateToLatest();
```

…or, if you manage schema elsewhere (Atlas, raw SQL, an existing table), apply
it once directly:

```ts
import { sessionTableMigration } from "shopify-app-session-storage-kysely";

await sessionTableMigration.up(db);
```

## 2. Tell Kysely about the table

Your Kysely database type needs a `Session` table. If you generate types from a
database where the migration has run (e.g. `kysely-codegen`), you get this for
free. Otherwise, compose the exported `SessionTable` into your database type:

```ts
import { Kysely } from "kysely";
import type { SessionTable } from "shopify-app-session-storage-kysely";

interface Database {
  Session: SessionTable;
  // ...your other tables
}

const db = new Kysely<Database>({ dialect: /* ... */ });
```

## 3. Use it

```ts
import { shopifyApp } from "@shopify/shopify-app-react-router/server";
import { KyselySessionStorage } from "shopify-app-session-storage-kysely";

const shopify = shopifyApp({
  // ...
  sessionStorage: new KyselySessionStorage(db),
});
```

`KyselySessionStorage` accepts any Kysely instance whose database type includes
a `Session` table — the column types only need to be compatible at runtime, so a
codegen'd type using `Generated<…>` / `ColumnType<…>` wrappers is accepted just
the same as a plain `SessionTable`.

## Schema

The table follows the Shopify Remix/Prisma template's `Session` model —
broken-out associated-user columns plus `refreshToken`/`refreshTokenExpires` for
the token-exchange flow. (The official SQL adapters instead serialize
online-access data into an `onlineAccessInfo` column and name the table
`shopify_sessions`; this adapter uses the template's column-per-field shape.)

| Column                | Type        | Notes                                  |
| --------------------- | ----------- | -------------------------------------- |
| `id`                  | text (PK)   |                                        |
| `shop`                | text        |                                        |
| `state`               | text        |                                        |
| `isOnline`            | boolean     | default `false`                        |
| `scope`               | varchar(1024) |                                      |
| `expires`             | timestamp   | nullable                               |
| `accessToken`         | text        |                                        |
| `refreshToken`        | text        | nullable                               |
| `refreshTokenExpires` | timestamp   | nullable                               |
| `userId`              | bigint      | online sessions; stored as a string    |
| `firstName`           | text        | online sessions                        |
| `lastName`            | text        | online sessions                        |
| `email`               | text        | online sessions                        |
| `accountOwner`        | boolean     | default `false`                        |
| `locale`              | text        | online sessions                        |
| `collaborator`        | boolean     | nullable                               |
| `emailVerified`       | boolean     | nullable                               |

The table is named `Session` and is indexed on `(shop, isOnline)`.

## License

MIT
