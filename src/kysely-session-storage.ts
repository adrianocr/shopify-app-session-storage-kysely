import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { Insertable, Kysely } from "kysely";
import type {
  SessionDatabase,
  SessionRow,
  SessionTable,
} from "./session-table";

/**
 * Kysely-backed implementation of Shopify's {@link SessionStorage} interface.
 *
 * The `Session` table is assumed to already exist — create it with the exported
 * migration (see `./migrations`). The constructor accepts any Kysely instance
 * whose database type has a `Session` table containing the expected columns (see
 * {@link SessionTable}). The bound checks column *names*, not value types, so a
 * codegen'd table using `Generated<…>`/`ColumnType<…>` wrappers binds just the
 * same; the runtime column shape is defined by the migration, not enforced here.
 */
export class KyselySessionStorage<
  DB extends { Session: Record<keyof SessionTable, unknown> } = SessionDatabase,
> implements SessionStorage
{
  private readonly db: Kysely<SessionDatabase>;

  constructor(db: Kysely<DB>) {
    // The bound guarantees the queried column names exist; narrow to the
    // concrete SessionTable shape for query building. Value types vary across
    // consumers (Generated<…>/ColumnType<…>) and the migration defines the real
    // runtime shape, so this cast is the intended seam, not a safety gap.
    this.db = db as unknown as Kysely<SessionDatabase>;
  }

  async storeSession(session: Session) {
    const data = sessionToRow(session);

    await this.db
      .insertInto("Session")
      .values(data)
      .onConflict((oc) => oc.column("id").doUpdateSet(data))
      .execute();

    return true;
  }

  async loadSession(id: string) {
    const row = await this.db
      .selectFrom("Session")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? rowToSession(row) : undefined;
  }

  async deleteSession(id: string) {
    await this.db.deleteFrom("Session").where("id", "=", id).execute();

    return true;
  }

  async deleteSessions(ids: string[]) {
    // An empty `in ()` is a Postgres syntax error and Kysely doesn't guard it
    // by default. Reachable on uninstall when a shop has no stored sessions.
    if (ids.length === 0) return true;

    await this.db.deleteFrom("Session").where("id", "in", ids).execute();

    return true;
  }

  async findSessionsByShop(shop: string) {
    const rows = await this.db
      .selectFrom("Session")
      .selectAll()
      .where("shop", "=", shop)
      .execute();

    return rows.map(rowToSession);
  }
}

function sessionToRow(session: Session): Insertable<SessionTable> {
  const user = session.onlineAccessInfo?.associated_user;

  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope ?? null,
    expires: session.expires ? new Date(session.expires) : null,
    accessToken: session.accessToken || "",
    refreshToken: session.refreshToken ?? null,
    refreshTokenExpires: session.refreshTokenExpires
      ? new Date(session.refreshTokenExpires)
      : null,
    userId: user?.id != null ? String(user.id) : null,
    firstName: user?.first_name ?? null,
    lastName: user?.last_name ?? null,
    email: user?.email ?? null,
    accountOwner: user?.account_owner ?? false,
    locale: user?.locale ?? null,
    collaborator: user?.collaborator ?? false,
    emailVerified: user?.email_verified ?? false,
  };
}

function rowToSession(row: SessionRow) {
  // `userId` is reconstructed by `fromPropertyArray` as a JS number, so
  // associated-user ids beyond Number.MAX_SAFE_INTEGER lose precision. That's a
  // limitation of the upstream Session type, not of this storage layer.
  const params: Record<keyof SessionRow, string | number | boolean | null> = {
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    scope: row.scope,
    expires: row.expires?.getTime() ?? null,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    refreshTokenExpires: row.refreshTokenExpires?.getTime() ?? null,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    accountOwner: row.accountOwner,
    locale: row.locale,
    collaborator: row.collaborator,
    emailVerified: row.emailVerified,
  };

  // fromPropertyArray drops null/undefined internally while preserving `false`
  // and `""`; filtering here only narrows the tuple type it accepts.
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== null,
  );

  return Session.fromPropertyArray(entries, true);
}
