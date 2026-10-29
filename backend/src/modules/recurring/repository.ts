import { and, asc, eq, isNotNull, isNull, like, or } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import {
  invoices,
  recurringTransactions,
  transactions,
  type NewRecurringTransaction,
  type RecurringTransaction,
} from '../../db/schema.js';

export function listRecurringTransactions(db: DbOrTx): RecurringTransaction[] {
  return db
    .select()
    .from(recurringTransactions)
    .orderBy(asc(recurringTransactions.dueDay), asc(recurringTransactions.description))
    .all();
}

export function listActiveRecurringTransactions(db: DbOrTx): RecurringTransaction[] {
  return db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.isActive, true))
    .orderBy(asc(recurringTransactions.dueDay), asc(recurringTransactions.description))
    .all();
}

export function findRecurringById(db: DbOrTx, id: string): RecurringTransaction | undefined {
  return db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.id, id))
    .get();
}

export function insertRecurringTransaction(
  db: DbOrTx,
  data: NewRecurringTransaction,
): RecurringTransaction {
  const [created] = db.insert(recurringTransactions).values(data).returning().all();
  if (!created) throw new Error('Falha ao criar transação recorrente');
  return created;
}

export function updateRecurringById(
  db: DbOrTx,
  id: string,
  data: Partial<NewRecurringTransaction>,
): RecurringTransaction | undefined {
  const [updated] = db
    .update(recurringTransactions)
    .set(data)
    .where(eq(recurringTransactions.id, id))
    .returning()
    .all();
  return updated;
}

export function deleteRecurringById(db: DbOrTx, id: string): RecurringTransaction | undefined {
  const [deleted] = db
    .delete(recurringTransactions)
    .where(eq(recurringTransactions.id, id))
    .returning()
    .all();
  return deleted;
}

export function findMaterializedRecurringIdsForMonth(db: DbOrTx, month: string): Set<string> {
  const monthPrefix = `${month}-%`;
  const rows = db
    .select({ recurringId: transactions.recurringId })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        isNotNull(transactions.recurringId),
        or(
          and(isNull(transactions.invoiceId), like(transactions.date, monthPrefix)),
          and(isNotNull(transactions.invoiceId), eq(invoices.month, month)),
        ),
      ),
    )
    .all();

  return new Set(rows.map((r) => r.recurringId).filter((id): id is string => id !== null));
}

export function findEarliestRecurringMonths(db: DbOrTx): Map<string, string> {
  const rows = db
    .select({
      recurringId: transactions.recurringId,
      date: transactions.date,
      invoiceMonth: invoices.month,
    })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(isNotNull(transactions.recurringId))
    .all();

  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.recurringId) continue;
    const competenceMonth = r.invoiceMonth ?? r.date.slice(0, 7);
    const existing = map.get(r.recurringId);
    if (!existing || competenceMonth < existing) {
      map.set(r.recurringId, competenceMonth);
    }
  }
  return map;
}

