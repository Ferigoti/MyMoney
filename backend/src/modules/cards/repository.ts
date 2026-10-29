import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import {
  creditCards,
  invoices,
  transactions,
  type CreditCard,
  type NewCreditCard,
} from '../../db/schema.js';
import { todayIso } from '../../shared/validation.js';

export function findCreditCardById(db: DbOrTx, id: string): CreditCard | undefined {
  return db.select().from(creditCards).where(eq(creditCards.id, id)).get();
}

export function findCreditCardByName(db: DbOrTx, name: string): CreditCard | undefined {
  return db.select().from(creditCards).where(eq(creditCards.name, name)).get();
}

export function listCreditCards(db: DbOrTx): CreditCard[] {
  return db.select().from(creditCards).orderBy(asc(creditCards.name)).all();
}

export function insertCreditCard(db: DbOrTx, data: NewCreditCard): CreditCard {
  return db.insert(creditCards).values(data).returning().get();
}

export function updateCreditCardById(
  db: DbOrTx,
  id: string,
  data: Partial<
    Pick<CreditCard, 'name' | 'limitCents' | 'closingDay' | 'dueDay' | 'paymentAccountId'>
  >,
): CreditCard {
  return db.update(creditCards).set(data).where(eq(creditCards.id, id)).returning().get();
}

/**
 * Valor comprometido do limite por cartão: soma das transações em faturas
 * ainda não pagas (inclui parcelas futuras). Estornos (income) abatem.
 * Para assinaturas recorrentes (recurringId IS NOT NULL), só contabiliza no limite
 * quando chega o dia da cobrança (date <= asOfDate).
 */
export function sumUsedLimitByCard(db: DbOrTx, asOfDate: string = todayIso()): Map<string, number> {
  const rows = db
    .select({
      cardId: invoices.cardId,
      usedCents: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amountCents} else -${transactions.amountCents} end), 0)`,
    })
    .from(transactions)
    .innerJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        ne(invoices.status, 'PAID'),
        or(isNull(transactions.recurringId), lte(transactions.date, asOfDate)),
      ),
    )
    .groupBy(invoices.cardId)
    .all();
  return new Map(rows.map((r) => [r.cardId, Number(r.usedCents)]));
}
