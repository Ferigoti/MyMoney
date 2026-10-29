import { asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { accounts, transactions, type Account, type NewAccount } from '../../db/schema.js';

export function findAccountById(db: DbOrTx, id: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function findAccountByName(db: DbOrTx, name: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.name, name)).get();
}

export function listAccounts(db: DbOrTx): Account[] {
  return db.select().from(accounts).orderBy(asc(accounts.name)).all();
}

export function insertAccount(db: DbOrTx, data: NewAccount): Account {
  return db.insert(accounts).values(data).returning().get();
}

export function countTransactionsByAccountId(db: DbOrTx, accountId: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .get();
  return Number(row?.count ?? 0);
}

export function deleteAccountById(db: DbOrTx, id: string): Account[] {
  return db.delete(accounts).where(eq(accounts.id, id)).returning().all();
}
