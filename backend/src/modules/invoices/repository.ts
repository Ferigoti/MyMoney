import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { invoices, transactions, type Invoice, type NewInvoice, type Transaction } from '../../db/schema.js';

export function findInvoiceById(db: DbOrTx, id: string): Invoice | undefined {
  return db.select().from(invoices).where(eq(invoices.id, id)).get();
}

export function findInvoiceByCardAndMonth(db: DbOrTx, cardId: string, month: string): Invoice | undefined {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.cardId, cardId), eq(invoices.month, month)))
    .get();
}

export function findInvoiceByPaymentTransactionId(db: DbOrTx, transactionId: string): Invoice | undefined {
  return db.select().from(invoices).where(eq(invoices.paymentTransactionId, transactionId)).get();
}

/**
 * Busca a fatura (card_id, month) ou cria com status OPEN.
 * Idempotente graças ao índice único (card_id, month).
 */
export function findOrCreateInvoice(
  db: DbOrTx,
  data: Pick<NewInvoice, 'cardId' | 'month' | 'closingDate' | 'dueDate'>,
): Invoice {
  db.insert(invoices)
    .values({ ...data, status: 'OPEN' })
    .onConflictDoNothing({ target: [invoices.cardId, invoices.month] })
    .run();

  const invoice = findInvoiceByCardAndMonth(db, data.cardId, data.month);
  if (!invoice) throw new Error(`Falha ao obter fatura ${data.cardId}/${data.month}`);
  return invoice;
}

export function listInvoiceTransactions(db: DbOrTx, invoiceId: string): Transaction[] {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.invoiceId, invoiceId))
    .orderBy(asc(transactions.date), asc(transactions.createdAt))
    .all();
}

/** Total da fatura em centavos (estornos abatem). */
export function sumInvoiceTotal(db: DbOrTx, invoiceId: string): number {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amountCents} else -${transactions.amountCents} end), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.invoiceId, invoiceId))
    .get();
  return Number(row?.total ?? 0);
}

export function markInvoicePaid(
  db: DbOrTx,
  id: string,
  data: { paidAt: string; paidFromAccountId: string; paymentTransactionId: string },
): Invoice {
  return db
    .update(invoices)
    .set({ status: 'PAID', ...data })
    .where(eq(invoices.id, id))
    .returning()
    .get();
}

export function markInvoiceUnpaid(db: DbOrTx, id: string): Invoice {
  return db
    .update(invoices)
    .set({
      status: 'OPEN',
      paidAt: null,
      paidFromAccountId: null,
      paymentTransactionId: null,
    })
    .where(eq(invoices.id, id))
    .returning()
    .get();
}
