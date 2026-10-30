import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { accounts, transactions, type Account, type NewAccount } from '../../db/schema.js';

export type AccountWithBalance = Account & {
  currentBalanceCents: number;
};

export function findAccountById(db: DbOrTx, id: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function findAccountByName(db: DbOrTx, name: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.name, name)).get();
}

export function sumPaidNetByAccountId(db: DbOrTx, accountId: string): number {
  const row = db
    .select({
      net: sql<number>`coalesce(sum(
        case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
      ), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.invoiceId),
        eq(transactions.isPaid, true),
      ),
    )
    .get();
  return Number(row?.net ?? 0);
}

export function listAccounts(db: DbOrTx): AccountWithBalance[] {
  const allAccounts = db.select().from(accounts).orderBy(asc(accounts.name)).all();
  return allAccounts.map((acc) => {
    const netPaidCents = sumPaidNetByAccountId(db, acc.id);
    return {
      ...acc,
      currentBalanceCents: acc.initialBalanceCents + netPaidCents,
    };
  });
}

export function insertAccount(db: DbOrTx, data: NewAccount): Account {
  return db.insert(accounts).values(data).returning().get();
}

export function updateAccountById(
  db: DbOrTx,
  id: string,
  data: Partial<Pick<NewAccount, 'name' | 'type' | 'initialBalanceCents'>>,
): Account {
  return db.update(accounts).set(data).where(eq(accounts.id, id)).returning().get();
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
