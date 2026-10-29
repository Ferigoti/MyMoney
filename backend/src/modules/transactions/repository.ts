import { and, asc, desc, eq, gte, isNotNull, isNull, like, ne, or, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { invoices, transactions, type NewTransaction, type Transaction } from '../../db/schema.js';
import type { ListTransactionsQuery } from './schemas.js';

export function insertTransactions(db: DbOrTx, rows: NewTransaction[]): Transaction[] {
  if (rows.length === 0) return [];
  return db.insert(transactions).values(rows).returning().all();
}

export function findTransactionById(db: DbOrTx, id: string): Transaction | undefined {
  return db.select().from(transactions).where(eq(transactions.id, id)).get();
}

export function listTransactions(db: DbOrTx, filter: ListTransactionsQuery): Transaction[] {
  const conditions: SQL[] = [];

  if (filter.month !== undefined) {
    // Competência: para contas é o mês de `date`; para compras no cartão é a competência da fatura
    // ou compras avulsas/assinaturas cuja data pertença ao mês filtrado.
    const accountInMonth = and(isNull(transactions.invoiceId), like(transactions.date, `${filter.month}-%`))!;
    const cardInMonth = and(
      isNotNull(transactions.invoiceId),
      or(
        eq(invoices.month, filter.month),
        and(isNull(transactions.installmentGroupId), like(transactions.date, `${filter.month}-%`)),
      ),
    )!;
    conditions.push(or(accountInMonth, cardInMonth)!);
  }

  if (filter.status !== undefined) {
    if (filter.status === 'paid') {
      const accountPaid = and(isNull(transactions.invoiceId), eq(transactions.isPaid, true))!;
      const cardPaid = and(isNotNull(transactions.invoiceId), eq(invoices.status, 'PAID'))!;
      conditions.push(or(accountPaid, cardPaid)!);
    } else {
      const accountPending = and(isNull(transactions.invoiceId), eq(transactions.isPaid, false))!;
      const cardPending = and(isNotNull(transactions.invoiceId), ne(invoices.status, 'PAID'))!;
      conditions.push(or(accountPending, cardPending)!);
    }
  }

  if (filter.categoryId !== undefined) {
    conditions.push(eq(transactions.categoryId, filter.categoryId));
  }
  if (filter.accountId !== undefined) {
    conditions.push(eq(transactions.accountId, filter.accountId));
  }
  if (filter.cardId !== undefined) {
    conditions.push(eq(invoices.cardId, filter.cardId));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(transactions.type, filter.type));
  }

  const rows = db
    .select({ tx: transactions })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.date), asc(transactions.installmentNumber), desc(transactions.createdAt))
    .all();

  return rows.map((r) => r.tx);
}

export function updateTransactionPaid(db: DbOrTx, id: string, isPaid: boolean): Transaction {
  return db.update(transactions).set({ isPaid }).where(eq(transactions.id, id)).returning().get();
}

export function updateTransactionById(
  db: DbOrTx,
  id: string,
  data: Partial<Pick<Transaction, 'description' | 'amountCents' | 'date' | 'categoryId' | 'isPaid'>>,
): Transaction {
  return db.update(transactions).set(data).where(eq(transactions.id, id)).returning().get();
}

export function deleteTransactionById(db: DbOrTx, id: string): Transaction[] {
  return db.delete(transactions).where(eq(transactions.id, id)).returning().all();
}

export function listUnpaidByInstallmentGroup(db: DbOrTx, groupId: string): Transaction[] {
  const rows = db
    .select({ tx: transactions })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        eq(transactions.installmentGroupId, groupId),
        or(isNull(transactions.invoiceId), ne(invoices.status, 'PAID')),
      ),
    )
    .orderBy(asc(transactions.installmentNumber))
    .all();

  return rows.map((r) => r.tx);
}

export function listUnpaidByRecurringId(db: DbOrTx, recurringId: string): Transaction[] {
  const rows = db
    .select({ tx: transactions })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        eq(transactions.recurringId, recurringId),
        or(
          and(isNull(transactions.invoiceId), eq(transactions.isPaid, false)),
          and(isNotNull(transactions.invoiceId), ne(invoices.status, 'PAID')),
        ),
      ),
    )
    .all();

  return rows.map((r) => r.tx);
}

export function listInstallmentFromNumber(
  db: DbOrTx,
  groupId: string,
  fromInstallmentNumber: number,
): Transaction[] {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.installmentGroupId, groupId),
        gte(transactions.installmentNumber, fromInstallmentNumber),
      ),
    )
    .orderBy(asc(transactions.installmentNumber))
    .all();
}

export function deleteInstallmentsFromNumber(
  db: DbOrTx,
  groupId: string,
  fromInstallmentNumber: number,
): Transaction[] {
  return db
    .delete(transactions)
    .where(
      and(
        eq(transactions.installmentGroupId, groupId),
        gte(transactions.installmentNumber, fromInstallmentNumber),
      ),
    )
    .returning()
    .all();
}
