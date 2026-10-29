import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';

describe('CORS & Dashboard Analytics (/dashboard/summary)', () => {
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

  it('habilita CORS para http://localhost:5173', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/dashboard/summary?month=2026-11',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejeita month inválido com erro 400 padronizado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/summary?month=2026-13',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('consolida balances, month_summary, expenses_by_category e six_months_history', async () => {
    // 1) Conta com saldo inicial de R$ 1.000,00 (100000 centavos)
    const acc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Conta Principal', initialBalanceCents: 100000 },
      })
    ).json().data;

    // 2) Categorias (Alimentação com teto mensal de R$ 500,00 = 50000 centavos)
    const catFood = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Alimentação', kind: 'expense' },
      })
    ).json().data;
    const patchCatRes = await app.inject({
      method: 'PATCH',
      url: `/categories/${catFood.id}`,
      payload: { monthly_budget_cents: 50000 },
    });
    expect(patchCatRes.statusCode).toBe(200);
    expect(patchCatRes.json().data.monthlyBudgetCents).toBe(50000);

    const catHousing = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Moradia', kind: 'expense' },
      })
    ).json().data;
    const catSalary = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Salário', kind: 'income' },
      })
    ).json().data;

    // 3) Cartão com fechamento dia 10 e vencimento dia 17
    const card = (
      await app.inject({
        method: 'POST',
        url: '/cards',
        payload: { name: 'Nubank', limitCents: 500000, closingDay: 10, dueDay: 17 },
      })
    ).json().data;

    // 4) Histórico no mês anterior (2026-10): Receita paga R$ 2.000,00 (200000) e Despesa paga R$ 500,00 (50000)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Salário Outubro',
        amountCents: 200000,
        type: 'income',
        date: '2026-10-05',
        accountId: acc.id,
        categoryId: catSalary.id,
        isPaid: true,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Aluguel Outubro',
        amountCents: 50000,
        type: 'expense',
        date: '2026-10-10',
        accountId: acc.id,
        categoryId: catHousing.id,
        isPaid: true,
      },
    });

    // 5) Mês atual (2026-11):
    // - Receita paga: R$ 3.000,00 (300000)
    // - Boleto Moradia (agendado/não pago): R$ 600,00 (60000)
    // - Despesa Alimentação à vista (paga): R$ 150,00 (15000)
    // - Compra no cartão (Alimentação) em 2026-11-05 (fatura 2026-11, vence 2026-11-17): R$ 250,00 (25000)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Salário Novembro',
        amountCents: 300000,
        type: 'income',
        date: '2026-11-05',
        accountId: acc.id,
        categoryId: catSalary.id,
        isPaid: true,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Aluguel Novembro',
        amountCents: 60000,
        type: 'expense',
        date: '2026-11-20',
        accountId: acc.id,
        categoryId: catHousing.id,
        isPaid: false,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Mercado Débito',
        amountCents: 15000,
        type: 'expense',
        date: '2026-11-08',
        accountId: acc.id,
        categoryId: catFood.id,
        isPaid: true,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Restaurante Cartão',
        amountCents: 25000,
        date: '2026-11-05',
        cardId: card.id,
        categoryId: catFood.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/summary?month=2026-11',
    });

    expect(res.statusCode).toBe(200);
    const summary = res.json().data;

    // Saldo atual: 100000 (inicial) + 200000 - 50000 (outubro) + 300000 - 15000 (novembro pagos) = 535000
    // Saldo projetado fim de 2026-11: 535000 - 60000 (boleto aberto) - 25000 (fatura aberta) = 450000
    // Free to spend: 300000 (receitas CHECKING/CASH) - (75000 despesas CHECKING/CASH + 25000 faturas) = 200000
    expect(summary.balances).toEqual({
      current_balance_cents: 535000,
      projected_balance_cents: 450000,
      available_balance_cents: 535000,
      savings_balance_cents: 0,
      benefits_balance_cents: 0,
      projected_benefits_balance_cents: 0,
      free_to_spend_cents: 200000,
    });

    // Resumo de 2026-11:
    // incomes_cents = 300000
    // expenses_cents (à vista/boletos) = 60000 + 15000 = 75000
    // credit_card_cents (faturas abertas) = 25000
    expect(summary.month_summary).toEqual({
      incomes_cents: 300000,
      benefits_incomes_cents: 0,
      expenses_cents: 75000,
      credit_card_cents: 25000,
      free_to_spend_cents: 200000,
    });

    // Despesas por categoria em 2026-11 (total = 60000 Moradia + 40000 Alimentação = 100000):
    // Moradia: 60000 (60%, sem teto configurado -> budget_cents = 0)
    // Alimentação: 40000 (40%, teto = 50000 -> remaining = 10000, usage = 80%)
    expect(summary.expenses_by_category).toEqual([
      {
        category_id: catHousing.id,
        category_name: 'Moradia',
        total_cents: 60000,
        percentage: 60,
        budget_cents: 0,
        spent_cents: 60000,
        remaining_cents: 0,
        usage_percentage: 0,
      },
      {
        category_id: catFood.id,
        category_name: 'Alimentação',
        total_cents: 40000,
        percentage: 40,
        budget_cents: 50000,
        spent_cents: 40000,
        remaining_cents: 10000,
        usage_percentage: 80,
      },
    ]);

    // Histórico de 6 meses: de 2026-06 a 2026-11
    expect(summary.six_months_history).toEqual([
      { month: '2026-06', incomes_cents: 0, expenses_cents: 0 },
      { month: '2026-07', incomes_cents: 0, expenses_cents: 0 },
      { month: '2026-08', incomes_cents: 0, expenses_cents: 0 },
      { month: '2026-09', incomes_cents: 0, expenses_cents: 0 },
      { month: '2026-10', incomes_cents: 200000, expenses_cents: 50000 },
      { month: '2026-11', incomes_cents: 300000, expenses_cents: 100000 },
    ]);
  });

  it('separa available_balance_cents (CHECKING/CASH), savings_balance_cents (SAVINGS) e benefits_balance_cents (BENEFIT) sem misturar no free_to_spend', async () => {
    const checkingAcc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Conta Corrente', type: 'CHECKING', initialBalanceCents: 100000 },
      })
    ).json().data;

    const benefitAcc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Flash VA/VR', type: 'BENEFIT', initialBalanceCents: 80000 },
      })
    ).json().data;

    const savingsAcc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Caixinha Reserva', type: 'SAVINGS', initialBalanceCents: 500000 },
      })
    ).json().data;

    // Gasto no VA (não deve reduzir available_balance_cents nem free_to_spend de CHECKING/CASH)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Almoço Executivo VA',
        amountCents: 15000,
        type: 'expense',
        date: '2026-11-10',
        accountId: benefitAcc.id,
        isPaid: true,
      },
    });

    // Aporte na Reserva (receita em SAVINGS)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Rendimento Reserva',
        amountCents: 20000,
        type: 'income',
        date: '2026-11-10',
        accountId: savingsAcc.id,
        isPaid: true,
      },
    });

    // Receita de Salário em CHECKING: R$ 4.000,00 (400000) e despesa: R$ 500,00 (50000)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Salário Mensal',
        amountCents: 400000,
        type: 'income',
        date: '2026-11-05',
        accountId: checkingAcc.id,
        isPaid: true,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Luz',
        amountCents: 50000,
        type: 'expense',
        date: '2026-11-12',
        accountId: checkingAcc.id,
        isPaid: true,
      },
    });

    // Receita agendada (não recebida ainda) de Vale no cartão de benefício: R$ 532,00 (53200)
    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Recarga Vale Swile',
        amountCents: 53200,
        type: 'income',
        date: '2026-11-30',
        accountId: benefitAcc.id,
        isPaid: false,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/summary?month=2026-11',
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().data;

    expect(summary.balances).toEqual({
      current_balance_cents: 450000, // 100000 + 400000 - 50000
      projected_balance_cents: 450000, // não mistura com o Vale!
      available_balance_cents: 450000,
      savings_balance_cents: 520000, // 500000 + 20000
      benefits_balance_cents: 65000, // 80000 - 15000 (já pagos)
      projected_benefits_balance_cents: 118200, // 65000 + 53200 (Vale previsto/agendado separado!)
      free_to_spend_cents: 350000, // 400000 - 50000 (estritamente CHECKING/CASH)
    });
    expect(summary.month_summary.benefits_incomes_cents).toBe(53200);
  });
});

