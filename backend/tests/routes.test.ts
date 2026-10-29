import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';

describe('HTTP routes & Zod validation', () => {
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

  it('rejeita payloads inválidos com status 400 padronizado (VALIDATION_ERROR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { name: '', initialBalanceCents: 12.34, extraField: true },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Requisição inválida',
    });
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('cria e lista categorias e contas (/categories, /accounts)', async () => {
    const catRes = await app.inject({
      method: 'POST',
      url: '/categories',
      payload: { name: 'Mercado', kind: 'expense' },
    });
    expect(catRes.statusCode).toBe(201);
    const category = catRes.json().data;
    expect(category).toMatchObject({ name: 'Mercado', kind: 'expense' });

    const listCat = await app.inject({ method: 'GET', url: '/categories?kind=expense' });
    expect(listCat.statusCode).toBe(200);
    expect(listCat.json().data).toHaveLength(1);

    const accRes = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { name: 'Conta Principal', type: 'checking', initialBalanceCents: 250000 },
    });
    expect(accRes.statusCode).toBe(201);
    expect(accRes.json().data.initialBalanceCents).toBe(250000);

    const listAcc = await app.inject({ method: 'GET', url: '/accounts' });
    expect(listAcc.statusCode).toBe(200);
    expect(listAcc.json().data).toHaveLength(1);
  });

  it('fluxo completo de cartão, faturas, limite disponível e pagamento (/cards, /invoices)', async () => {
    const acc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Nubank Conta', initialBalanceCents: 500000 },
      })
    ).json().data;

    const cardRes = await app.inject({
      method: 'POST',
      url: '/cards',
      payload: { name: 'Nubank Roxinho', limitCents: 100000, closingDay: 10, dueDay: 17 },
    });
    expect(cardRes.statusCode).toBe(201);
    const card = cardRes.json().data;

    // Compra parcelada de R$ 100,00 (10000 centavos) em 3x no dia 2026-11-10 (no fechamento -> 2026-11, 2026-12, 2027-01)
    const txRes = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Fone Bluetooth',
        amountCents: 10000,
        date: '2026-11-10',
        cardId: card.id,
        isInstallment: true,
        installments: 3,
      },
    });
    expect(txRes.statusCode).toBe(201);
    expect(txRes.json().data.map((t: { amountCents: number }) => t.amountCents)).toEqual([3334, 3333, 3333]);

    // Limite disponível deve descontar todas as parcelas em aberto (100000 - 10000 = 90000)
    const cardsBeforePay = (await app.inject({ method: 'GET', url: '/cards' })).json().data;
    expect(cardsBeforePay[0]).toMatchObject({
      id: card.id,
      limitCents: 100000,
      usedCents: 10000,
      availableCents: 90000,
    });

    // Busca a fatura de 2026-11
    const invViewRes = await app.inject({
      method: 'GET',
      url: `/cards/${card.id}/invoices?month=2026-11`,
    });
    expect(invViewRes.statusCode).toBe(200);
    const invView = invViewRes.json().data;
    expect(invView.totalCents).toBe(3334);
    expect(invView.transactions).toHaveLength(1);
    expect(invView.invoice.status).toBe('OPEN');

    // Paga a fatura de 2026-11 usando a conta
    const payRes = await app.inject({
      method: 'PATCH',
      url: `/invoices/${invView.invoice.id}/pay`,
      payload: { accountId: acc.id, paidAt: '2026-11-15' },
    });
    expect(payRes.statusCode).toBe(200);
    const paidData = payRes.json().data;
    expect(paidData.invoice.status).toBe('PAID');
    expect(paidData.paymentTransaction).toMatchObject({
      accountId: acc.id,
      invoiceId: null,
      amountCents: 3334,
      type: 'expense',
      isPaid: true,
    });

    // Após pagar 3334, o limite comprometido cai para 6666 e o disponível sobe para 93334
    const cardsAfterPay = (await app.inject({ method: 'GET', url: '/cards' })).json().data;
    expect(cardsAfterPay[0]).toMatchObject({
      usedCents: 6666,
      availableCents: 93334,
    });

    // Cancela o pagamento da fatura (PATCH /invoices/:id/unpay)
    const unpayRes = await app.inject({
      method: 'PATCH',
      url: `/invoices/${invView.invoice.id}/unpay`,
    });
    expect(unpayRes.statusCode).toBe(200);
    expect(unpayRes.json().data.invoice.status).toBe('OPEN');

    // O limite comprometido volta a 10000 e o disponível a 90000
    const cardsAfterUnpay = (await app.inject({ method: 'GET', url: '/cards' })).json().data;
    expect(cardsAfterUnpay[0]).toMatchObject({
      usedCents: 10000,
      availableCents: 90000,
    });
  });

  it('transações: filtros por competência/status/categoria, toggle-paid e delete de parcelas', async () => {
    const acc = (
      await app.inject({ method: 'POST', url: '/accounts', payload: { name: 'Itaú' } })
    ).json().data;
    const cat = (
      await app.inject({ method: 'POST', url: '/categories', payload: { name: 'Contas', kind: 'expense' } })
    ).json().data;
    const card = (
      await app.inject({
        method: 'POST',
        url: '/cards',
        payload: { name: 'Itaú Click', limitCents: 200000, closingDay: 5, dueDay: 12 },
      })
    ).json().data;

    // Boleto a vencer em conta (isPaid = false)
    const billRes = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Energia',
        amountCents: 15000,
        type: 'expense',
        date: '2026-11-20',
        accountId: acc.id,
        categoryId: cat.id,
        isPaid: false,
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = billRes.json().data[0];
    expect(bill.isPaid).toBe(false);

    // Alterna is_paid via PATCH /:id/toggle-paid
    const toggled = await app.inject({
      method: 'PATCH',
      url: `/transactions/${bill.id}/toggle-paid`,
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().data.isPaid).toBe(true);

    // Compra parcelada em 4x no dia 2026-11-01 (faturas: 2026-11, 2026-12, 2027-01, 2027-02)
    const installments = (
      await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: {
          description: 'Curso',
          amountCents: 40000,
          date: '2026-11-01',
          cardId: card.id,
          categoryId: cat.id,
          isInstallment: true,
          installments: 4,
        },
      })
    ).json().data;
    expect(installments).toHaveLength(4);

    // toggle-paid em transação de cartão deve falhar com 422
    const invalidToggle = await app.inject({
      method: 'PATCH',
      url: `/transactions/${installments[0].id}/toggle-paid`,
    });
    expect(invalidToggle.statusCode).toBe(422);

    // Filtro por competência 2026-11 e status=paid traz apenas o boleto pago
    const paidNov = (
      await app.inject({ method: 'GET', url: '/transactions?month=2026-11&status=paid' })
    ).json().data;
    expect(paidNov.map((t: { id: string }) => t.id)).toEqual([bill.id]);

    // Filtro por competência 2026-12 traz a 2ª parcela (mesmo com date = 2026-11-01)
    const decTx = (await app.inject({ method: 'GET', url: '/transactions?month=2026-12' })).json().data;
    expect(decTx).toHaveLength(1);
    expect(decTx[0].installmentNumber).toBe(2);

    // DELETE da 2ª parcela com scope=future remove parcelas 2, 3 e 4 e preserva a 1ª
    const delFuture = await app.inject({
      method: 'DELETE',
      url: `/transactions/${installments[1].id}?scope=future`,
    });
    expect(delFuture.statusCode).toBe(200);
    expect(delFuture.json().data.deletedCount).toBe(3);

    // Resta a 1ª parcela (e o boleto)
    const remainingCardTx = (
      await app.inject({ method: 'GET', url: `/transactions?cardId=${card.id}` })
    ).json().data;
    expect(remainingCardTx).toHaveLength(1);
    expect(remainingCardTx[0].installmentNumber).toBe(1);
  });

  it('PUT /transactions/:id edita transação e bloqueia alteração de valor em fatura já paga (PAID)', async () => {
    const acc = (
      await app.inject({ method: 'POST', url: '/accounts', payload: { name: 'Bradesco' } })
    ).json().data;
    const cat = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Saúde', kind: 'expense' },
      })
    ).json().data;
    const card = (
      await app.inject({
        method: 'POST',
        url: '/cards',
        payload: { name: 'Bradesco Visa', limitCents: 300000, closingDay: 10, dueDay: 17 },
      })
    ).json().data;

    // 1) Edita transação avulsa em conta
    const accTx = (
      await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: {
          description: 'Farmácia',
          amountCents: 5000,
          type: 'expense',
          date: '2026-11-05',
          accountId: acc.id,
        },
      })
    ).json().data[0];

    const updatedAccTx = await app.inject({
      method: 'PUT',
      url: `/transactions/${accTx.id}`,
      payload: {
        description: 'Farmácia Popular',
        amountCents: 6500,
        date: '2026-11-06',
        categoryId: cat.id,
      },
    });
    expect(updatedAccTx.statusCode).toBe(200);
    expect(updatedAccTx.json().data).toMatchObject({
      description: 'Farmácia Popular',
      amountCents: 6500,
      date: '2026-11-06',
      categoryId: cat.id,
    });

    // 2) Compra no cartão e pagamento da fatura
    const cardTx = (
      await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: {
          description: 'Consulta',
          amountCents: 20000,
          date: '2026-11-02',
          cardId: card.id,
        },
      })
    ).json().data[0];

    await app.inject({
      method: 'PATCH',
      url: `/invoices/${cardTx.invoiceId}/pay`,
      payload: { accountId: acc.id, paidAt: '2026-11-15' },
    });

    // Tentativa de alterar valor de transação em fatura PAID deve falhar com 422
    const blockedAmountRes = await app.inject({
      method: 'PUT',
      url: `/transactions/${cardTx.id}`,
      payload: { amountCents: 25000 },
    });
    expect(blockedAmountRes.statusCode).toBe(422);

    // Mas alterar apenas descrição ou categoria mantendo o mesmo valor é permitido
    const allowedDescRes = await app.inject({
      method: 'PUT',
      url: `/transactions/${cardTx.id}`,
      payload: { description: 'Consulta Médica', categoryId: cat.id },
    });
    expect(allowedDescRes.statusCode).toBe(200);
    expect(allowedDescRes.json().data).toMatchObject({
      description: 'Consulta Médica',
      amountCents: 20000,
      categoryId: cat.id,
    });
  });

  it('DELETE /accounts/:id bloqueia conta com transações (409) e remove conta vazia; PUT /cards/:id atualiza limite e datas; GET /system/backup exporta dados', async () => {
    const emptyAcc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Carteira Reserva', type: 'cash', initialBalanceCents: 5000 },
      })
    ).json().data;

    const busyAcc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Conta Principal', type: 'checking', initialBalanceCents: 100000 },
      })
    ).json().data;

    await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Supermercado',
        amountCents: 15000,
        type: 'expense',
        date: '2026-11-10',
        accountId: busyAcc.id,
      },
    });

    // Bloqueia exclusão de conta com transação vinculada
    const conflictRes = await app.inject({
      method: 'DELETE',
      url: `/accounts/${busyAcc.id}`,
    });
    expect(conflictRes.statusCode).toBe(409);

    // Permite exclusão de conta sem transações
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/accounts/${emptyAcc.id}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().data.deletedId).toBe(emptyAcc.id);

    // Cria e atualiza cartão via PUT /cards/:id
    const card = (
      await app.inject({
        method: 'POST',
        url: '/cards',
        payload: { name: 'Inter Gold', limitCents: 200000, closingDay: 5, dueDay: 12 },
      })
    ).json().data;

    const updateCardRes = await app.inject({
      method: 'PUT',
      url: `/cards/${card.id}`,
      payload: {
        name: 'Inter Black',
        limit_cents: 800000,
        closing_day: 8,
        due_day: 15,
      },
    });
    expect(updateCardRes.statusCode).toBe(200);
    expect(updateCardRes.json().data).toMatchObject({
      id: card.id,
      name: 'Inter Black',
      limitCents: 800000,
      closingDay: 8,
      dueDay: 15,
      availableCents: 800000,
    });

    // Exporta backup JSON
    const backupJsonRes = await app.inject({
      method: 'GET',
      url: '/system/backup?format=json',
    });
    expect(backupJsonRes.statusCode).toBe(200);
    expect(backupJsonRes.headers['content-disposition']).toContain('attachment; filename="mymoney-backup-');
    const backupBody = backupJsonRes.json();
    expect(backupBody.tables.accounts).toHaveLength(1);
    expect(backupBody.tables.creditCards).toHaveLength(1);
    expect(backupBody.tables.transactions).toHaveLength(1);

    // Exporta backup SQLite binário
    const backupSqliteRes = await app.inject({
      method: 'GET',
      url: '/system/backup?format=sqlite',
    });
    expect(backupSqliteRes.statusCode).toBe(200);
    expect(backupSqliteRes.headers['content-type']).toContain('application/x-sqlite3');
    expect(backupSqliteRes.rawPayload.length).toBeGreaterThan(0);
  });

  it('CRUD /recurring e geração automática de transações pendentes em GET /transactions?month=YYYY-MM', async () => {
    const acc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        payload: { name: 'Conta Corrente', type: 'CHECKING', initialBalanceCents: 200000 },
      })
    ).json().data;

    const cat = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Educação', kind: 'expense' },
      })
    ).json().data;

    const createRecRes = await app.inject({
      method: 'POST',
      url: '/recurring',
      payload: {
        description: 'Mensalidade Faculdade',
        amountCents: 89000,
        categoryId: cat.id,
        accountId: acc.id,
        type: 'EXPENSE',
        dueDay: 10,
        isActive: true,
      },
    });
    expect(createRecRes.statusCode).toBe(201);
    const rec = createRecRes.json().data;
    expect(rec).toMatchObject({
      description: 'Mensalidade Faculdade',
      amountCents: 89000,
      dueDay: 10,
      isActive: true,
    });

    const listRecRes = await app.inject({ method: 'GET', url: '/recurring' });
    expect(listRecRes.statusCode).toBe(200);
    expect(listRecRes.json().data).toHaveLength(1);

    // Ao buscar transações de 2026-11, deve materializar automaticamente 1 vez com isPaid = false
    const txNovFirst = await app.inject({
      method: 'GET',
      url: '/transactions?month=2026-11',
    });
    expect(txNovFirst.statusCode).toBe(200);
    expect(txNovFirst.json().data).toHaveLength(1);
    expect(txNovFirst.json().data[0]).toMatchObject({
      description: 'Mensalidade Faculdade',
      amountCents: 89000,
      date: '2026-11-10',
      isPaid: false,
      recurringId: rec.id,
    });

    // Segunda chamada para o mesmo mês NÃO duplica a transação
    const txNovSecond = await app.inject({
      method: 'GET',
      url: '/transactions?month=2026-11',
    });
    expect(txNovSecond.json().data).toHaveLength(1);

    // Remove recorrência
    const delRecRes = await app.inject({
      method: 'DELETE',
      url: `/recurring/${rec.id}`,
    });
    expect(delRecRes.statusCode).toBe(200);
    expect(delRecRes.json().data.deletedId).toBe(rec.id);

    // Criação direta de despesa fixa pelo modal (POST /transactions com isRecurring: true) e edição no extrato
    const txFixedRes = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Internet Fibra',
        amountCents: 12000,
        type: 'expense',
        date: '2026-11-15',
        accountId: acc.id,
        categoryId: cat.id,
        isPaid: false,
        isRecurring: true,
      },
    });
    expect(txFixedRes.statusCode).toBe(201);
    const createdFixedTx = txFixedRes.json().data[0];
    expect(createdFixedTx.recurringId).toBeTruthy();

    // Edita o valor no extrato (PUT /transactions/:id) e propaga para os meses seguintes
    const editedFixedRes = await app.inject({
      method: 'PUT',
      url: `/transactions/${createdFixedTx.id}`,
      payload: {
        amountCents: 13500,
        updateRecurring: true,
      },
    });
    expect(editedFixedRes.statusCode).toBe(200);
    expect(editedFixedRes.json().data.amountCents).toBe(13500);

    // No mês seguinte (2026-12), a conta recorrente é gerada já com o novo valor (13500)
    const txDecRes = await app.inject({
      method: 'GET',
      url: '/transactions?month=2026-12',
    });
    expect(txDecRes.statusCode).toBe(200);
    expect(txDecRes.json().data[0]).toMatchObject({
      description: 'Internet Fibra',
      amountCents: 13500,
      date: '2026-12-15',
      recurringId: createdFixedTx.recurringId,
    });

    // Criação de receita fixa (Salário) com regra 5º dia útil (@feriados/brasil)
    const salaryCat = (
      await app.inject({
        method: 'POST',
        url: '/categories',
        payload: { name: 'Salário', kind: 'income' },
      })
    ).json().data;

    const salaryRes = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Salário Mensal CLT',
        amountCents: 850000,
        type: 'income',
        date: '2026-10-07', // 5º dia útil de Outubro/2026
        accountId: acc.id,
        categoryId: salaryCat.id,
        isPaid: true,
        isRecurring: true,
        scheduleRule: 'FIFTH_BUSINESS_DAY',
      },
    });
    expect(salaryRes.statusCode).toBe(201);
    const createdSalaryTx = salaryRes.json().data[0];
    expect(createdSalaryTx.recurringId).toBeTruthy();

    // Em Novembro/2026: 01/11 é domingo e 02/11 é Finados (feriado nacional).
    // Os dias úteis são 03, 04, 05, 06 e o 5º dia útil cai em 09/11/2026!
    const txNovSalaryRes = await app.inject({
      method: 'GET',
      url: '/transactions?month=2026-11',
    });
    expect(txNovSalaryRes.statusCode).toBe(200);
    const novSalary = txNovSalaryRes
      .json()
      .data.find((t: { description: string }) => t.description === 'Salário Mensal CLT');
    expect(novSalary).toBeDefined();
    expect(novSalary.date).toBe('2026-11-09');

    // Criação de assinatura fixa no cartão de crédito (isRecurring: true com cardId)
    const cardSub = (
      await app.inject({
        method: 'POST',
        url: '/cards',
        payload: { name: 'Nubank Ultravioleta', limitCents: 1000000, closingDay: 15, dueDay: 22 },
      })
    ).json().data;

    const subRes = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: {
        description: 'Netflix Premium',
        amountCents: 5990,
        date: '2026-11-08',
        cardId: cardSub.id,
        categoryId: cat.id,
        isRecurring: true,
      },
    });
    expect(subRes.statusCode).toBe(201);
    const createdSubTx = subRes.json().data[0];
    expect(createdSubTx.recurringId).toBeTruthy();

    // Consultando a fatura do cartão no mês seguinte (2026-12), a assinatura é gerada automaticamente
    const decInvRes = await app.inject({
      method: 'GET',
      url: `/cards/${cardSub.id}/invoices?month=2026-12`,
    });
    expect(decInvRes.statusCode).toBe(200);
    expect(decInvRes.json().data.totalCents).toBe(5990);
    expect(decInvRes.json().data.transactions[0]).toMatchObject({
      description: 'Netflix Premium',
      amountCents: 5990,
      date: '2026-12-08',
      recurringId: createdSubTx.recurringId,
    });
  });
});

