import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';

describe('Planejamento Mensal (/dashboard/planning)', () => {
  let sqlite: Database.Database;
  let db: DB;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    sqlite = createSqlite(':memory:');
    runMigrations(sqlite);
    db = createDb(sqlite);
    app = buildApp({ db });
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url, payload });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  };

  it('valida as competências informadas', async () => {
    const bad = await app.inject({ method: 'GET', url: '/dashboard/planning?months=2026-13' });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({ method: 'GET', url: '/dashboard/planning?months=' });
    expect(empty.statusCode).toBe(400);
  });

  it('calcula cada mês isoladamente e consolida vários meses', async () => {
    const acc = await post('/accounts', { name: 'Corrente', initialBalanceCents: 100000 });
    const va = await post('/accounts', { name: 'Flash VA', type: 'BENEFIT' });
    const catFood = await post('/categories', { name: 'Alimentação', kind: 'expense' });
    const catHousing = await post('/categories', { name: 'Moradia', kind: 'expense' });
    const catSalary = await post('/categories', { name: 'Salário', kind: 'income' });
    const card = await post('/cards', { name: 'Nubank', limitCents: 500000, closingDay: 10, dueDay: 17 });

    // Outubro (não deve aparecer quando só novembro/dezembro estão selecionados)
    await post('/transactions', { description: 'Salário Out', amountCents: 200000, type: 'income', date: '2026-10-05', accountId: acc.id, categoryId: catSalary.id, isPaid: true });

    // Novembro
    await post('/transactions', { description: 'Salário Nov', amountCents: 300000, type: 'income', date: '2026-11-05', accountId: acc.id, categoryId: catSalary.id, isPaid: true });
    await post('/transactions', { description: 'Aluguel', amountCents: 60000, type: 'expense', date: '2026-11-20', accountId: acc.id, categoryId: catHousing.id, isPaid: false });
    await post('/transactions', { description: 'Mercado', amountCents: 15000, type: 'expense', date: '2026-11-08', accountId: acc.id, categoryId: catFood.id, isPaid: true });
    // Cartão: compra em 05/11 → fatura vence 17/11
    await post('/transactions', { description: 'Restaurante', amountCents: 25000, date: '2026-11-05', cardId: card.id, categoryId: catFood.id });
    // Cartão: compra em 15/11 (após fechamento) → fatura vence 17/12
    await post('/transactions', { description: 'Padaria', amountCents: 10000, date: '2026-11-15', cardId: card.id, categoryId: catFood.id });
    // Cartão parcelado 3x de 100,00 → vencimentos 17/11, 17/12, 17/01
    await post('/transactions', { description: 'Fone', amountCents: 30000, date: '2026-11-05', cardId: card.id, isInstallment: true, installments: 3 });
    // Gasto com Vale (mostrado à parte, não entra nas despesas)
    await post('/transactions', { description: 'Almoço VA', amountCents: 15000, type: 'expense', date: '2026-11-10', accountId: va.id, isPaid: true });

    const res = await app.inject({ method: 'GET', url: '/dashboard/planning?months=2026-12,2026-11,2026-11' });
    expect(res.statusCode).toBe(200);
    const plan = res.json().data;

    expect(plan.months).toEqual(['2026-11', '2026-12']);

    const [nov, dec] = plan.per_month;
    expect(nov).toMatchObject({
      month: '2026-11',
      incomes_cents: 300000,
      account_expenses_cents: 75000,
      card_expenses_cents: 35000,
      total_expenses_cents: 110000,
      balance_cents: 190000,
      installment_expenses_cents: 10000,
      variable_expenses_cents: 100000,
      fixed_expenses_cents: 0,
      benefit_expenses_cents: 15000,
    });
    expect(nov.committed_percentage).toBeCloseTo(36.67, 2);

    // Dezembro isolado: nada de renda, apenas a fatura que vence em dezembro
    expect(dec).toMatchObject({
      month: '2026-12',
      incomes_cents: 0,
      card_expenses_cents: 20000,
      total_expenses_cents: 20000,
      balance_cents: -20000,
    });

    expect(plan.totals).toMatchObject({ incomes_cents: 300000, total_expenses_cents: 130000, balance_cents: 170000 });
    expect(plan.averages).toMatchObject({ incomes_cents: 150000, total_expenses_cents: 65000, balance_cents: 85000 });

    const food = plan.expenses_by_category.find((c: { category_name: string }) => c.category_name === 'Alimentação');
    expect(food).toMatchObject({ total_cents: 50000, average_cents: 25000, by_month: { '2026-11': 40000, '2026-12': 10000 } });
    expect(plan.incomes_by_category).toEqual([
      expect.objectContaining({ category_name: 'Salário', total_cents: 300000, by_month: { '2026-11': 300000, '2026-12': 0 } }),
    ]);
  });
});

