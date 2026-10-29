import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';
import { accounts, categories, creditCards, invoices, transactions } from '../src/db/schema.js';

let sqlite: Database.Database;
let db: DB;

beforeEach(() => {
  sqlite = createSqlite(':memory:');
  runMigrations(sqlite);
  db = createDb(sqlite);
});

function seedCardWithInvoice() {
  const [card] = db
    .insert(creditCards)
    .values({ name: 'Nubank', limitCents: 500000, closingDay: 5, dueDay: 12 })
    .returning()
    .all();
  const [invoice] = db
    .insert(invoices)
    .values({ cardId: card!.id, month: '2026-11', closingDate: '2026-11-05', dueDate: '2026-11-12' })
    .returning()
    .all();
  return { card: card!, invoice: invoice! };
}

describe('schema', () => {
  it('mantém foreign_keys ligado após migrar', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('cria os índices exigidos', () => {
    const names = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['transactions_date_idx', 'transactions_invoice_idx', 'invoices_card_month_unique']),
    );
  });

  it('impede fatura duplicada para o mesmo cartão/mês', () => {
    const { card } = seedCardWithInvoice();
    expect(() =>
      db
        .insert(invoices)
        .values({ cardId: card.id, month: '2026-11', closingDate: '2026-11-05', dueDate: '2026-11-12' })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('exige exatamente um destino (conta OU fatura)', () => {
    const { invoice } = seedCardWithInvoice();
    const [acc] = db.insert(accounts).values({ name: 'Corrente' }).returning().all();
    const base = { description: 'x', amountCents: 100, type: 'expense' as const, date: '2026-11-01' };

    expect(() => db.insert(transactions).values(base).run()).toThrow(/CHECK/);
    expect(() =>
      db.insert(transactions).values({ ...base, accountId: acc!.id, invoiceId: invoice.id }).run(),
    ).toThrow(/CHECK/);
  });

  it('rejeita valores e datas inválidos', () => {
    const [acc] = db.insert(accounts).values({ name: 'Corrente' }).returning().all();
    const base = { description: 'x', type: 'expense' as const, accountId: acc!.id };
    expect(() => db.insert(transactions).values({ ...base, amountCents: 0, date: '2026-11-01' }).run()).toThrow(/CHECK/);
    expect(() => db.insert(transactions).values({ ...base, amountCents: 10, date: '01/11/2026' }).run()).toThrow(/CHECK/);
  });

  it('remove cartão → faturas → compras em cascata', () => {
    const { card, invoice } = seedCardWithInvoice();
    db.insert(transactions)
      .values({ description: 'Mercado', amountCents: 3334, type: 'expense', date: '2026-11-01', invoiceId: invoice.id })
      .run();

    db.delete(creditCards).where(eq(creditCards.id, card.id)).run();

    expect(db.select().from(invoices).all()).toHaveLength(0);
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('remover categoria zera category_id; conta com histórico não pode ser removida', () => {
    const [acc] = db.insert(accounts).values({ name: 'Corrente' }).returning().all();
    const [cat] = db.insert(categories).values({ name: 'Mercado', kind: 'expense' }).returning().all();
    db.insert(transactions)
      .values({ description: 'x', amountCents: 100, type: 'expense', date: '2026-11-01', accountId: acc!.id, categoryId: cat!.id })
      .run();

    db.delete(categories).where(eq(categories.id, cat!.id)).run();
    expect(db.select().from(transactions).get()?.categoryId).toBeNull();

    expect(() => db.delete(accounts).where(eq(accounts.id, acc!.id)).run()).toThrow(/FOREIGN KEY/);
  });

  it('carrega relations via query API', async () => {
    const { invoice } = seedCardWithInvoice();
    db.insert(transactions)
      .values({ description: 'x', amountCents: 100, type: 'expense', date: '2026-11-01', invoiceId: invoice.id })
      .run();

    const result = await db.query.invoices.findFirst({ with: { card: true, transactions: true } });
    expect(result?.card.name).toBe('Nubank');
    expect(result?.transactions).toHaveLength(1);
  });
});

