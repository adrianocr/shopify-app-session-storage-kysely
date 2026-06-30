import type { ColumnType, Selectable } from "kysely";

/**
 * Postgres `timestamp` column: selected as a `Date`, accepted as `Date | string`.
 */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

/**
 * Postgres `bigint` column: node-postgres returns it as a `string`; we accept
 * the usual numeric inputs on write.
 */
type Int8 = ColumnType<
  string,
  bigint | number | string,
  bigint | number | string
>;

/**
 * Column contract for the Shopify session table.
 *
 * Follows the Shopify Remix/Prisma template's `Session` model — broken-out
 * associated-user columns plus `refreshToken`/`refreshTokenExpires` for the
 * token-exchange flow. (The official SQL adapters instead persist online-access
 * data as a serialized `onlineAccessInfo` column and name the table
 * `shopify_sessions`; this adapter follows the template's column-per-field
 * shape.) Compose it into your Kysely database type, or use it as the reference
 * for the columns the {@link KyselySessionStorage} queries.
 */
export interface SessionTable {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: Timestamp | null;
  accessToken: string;
  refreshToken: string | null;
  refreshTokenExpires: Timestamp | null;
  userId: Int8 | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  accountOwner: boolean;
  locale: string | null;
  collaborator: boolean | null;
  emailVerified: boolean | null;
}

/** The minimal database shape {@link KyselySessionStorage} operates on. */
export interface SessionDatabase {
  Session: SessionTable;
}

/** A row as read back from the `Session` table. */
export type SessionRow = Selectable<SessionTable>;
