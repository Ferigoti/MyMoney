import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';
import { accounts, categories, creditCards, invoices, transactions } from '../src/db/schema.js';
import {
  addMonths,
  createTransactionsService,
  invoicePeriodForMonth,
  resolveInvoicePeriod,
  splitInstallments,
  type TransactionsService,
} from '../src/modules/transactions/transactions.service.js';
import { BusinessRuleError, NotFoundError } from '../src/shared/errors.js';

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------
describe('resolveInvoicePeriod', () => {
  it('compra NO dia do fechamento fica na competência atual', () => {
    expect(resolveInvoicePeriod('2026-11-10', 10, 17)).toEqual({
      month: '2026-11',
      closingDate: '2026-11-10',
      dueDate: '2026-11-17',
    });
  });

  it('compra no dia SEGUINTE ao fechamento vai para a competência do mês seguinte', () => {
    expect(resolveInvoicePeriod('2026-11-11', 10, 17)).toEqual({
      month: '2026-12',
      closingDate: '2026-12-10',
      dueDate: '2026-12-17',
    });
  });

  it('vira o ano quando a compra é após o fechamento de dezembro', () => {
    expect(resolveInvoicePeriod('2026-12-25', 20, 28).month).toBe('2027-01');
  });

  it('vencimento antes do dia de fechamento cai no mês seguinte', () => {
    expect(resolveInvoicePeriod('2026-11-01', 28, 5)).toEqual({
      month: '2026-11',
      closingDate: '2026-11-28',
      dueDate: '2026-12-05',
    });
  });

  it('limita closing_day ao último dia de meses curtos', () => {
    expect(resolveInvoicePeriod('2027-02-28', 31, 10)).toEqual({
      month: '2027-02',
      closingDate: '2027-02-28',
      dueDate: '2027-03-10',
    });
    expect(invoicePeriodForMonth('2028-02', 30, 31).closingDate).toBe('2028-02-29');
  });
});

describe('addMonths', () => {
  it('soma meses com virada de ano', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', 24)).toBe('2028-01');
  });
});

describe('splitInstallments', () => {
  it('10000 centavos em 3x → resto na 1ª parcela', () => {
    const parts = splitInstallments(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('resto maior que 1 centavo vai inteiro para a 1ª parcela', () => {
    expect(splitInstallments(1000, 7)).toEqual([148, 142, 142, 142, 142, 142, 142]);
  });

  it('divisão exata e parcela única', () => {
    expect(splitInstallments(9000, 3)).toEqual([3000, 3000, 3000]);
    expect(splitInstallments(12345, 1)).toEqual([12345]);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => splitInstallments(2, 3)).toThrow(RangeError);
    expect(() => splitInstallments(10.5, 2)).toThrow(RangeError);
    expect(() => splitInstallments(100, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Service (SQLite em memória)
// ---------------------------------------------------------------------------
describe('TransactionsService', () => {
  let sqlite: Database.Database;
  let db: DB;
  let service: TransactionsService;
  let cardId: string;
  let accountId: string;

  beforeEach(() => {
    sqlite = createSqlite(':memory:');
    runMigrations(sqlite);
    db = createDb(sqlite);
    service = createTransactionsService(db);

    cardId = db
      .insert(creditCards)
      .values({ name: 'Nubank', limitCents: 1_000_000, closingDay: 10, dueDay: 17 })
      .returning()
      .get().id;
    accountId = db.insert(accounts).values({ name: 'Corrente' }).returning().get().id;
  });

  const invoiceMonthOf = (invoiceId: string | null) =>
    db.select().from(invoices).where(eq(invoices.id, invoiceId!)).get()?.month;

  describe('createCardPurchase', () => {
    it('compra no dia do fechamento vs. dia seguinte cai em faturas diferentes', () => {
      const [onClosing] = service.createCardPurchase({
        description: 'No fechamento',
        amountCents: 5000,
        date: '2026-11-10',
        cardId,
      });
      const [afterClosing] = service.createCardPurchase({
        description: 'Dia seguinte',
        amountCents: 5000,
        date: '2026-11-11',
        cardId,
      });

      expect(invoiceMonthOf(onClosing!.invoiceId)).toBe('2026-11');
      expect(invoiceMonthOf(afterClosing!.invoiceId)).toBe('2026-12');
    });

    it('cria a fatura automaticamente com status OPEN e reaproveita a existente', () => {
      const [a] = service.createCardPurchase({ description: 'A', amountCents: 100, date: '2026-11-01', cardId });
      const [b] = service.createCardPurchase({ description: 'B', amountCents: 200, date: '2026-11-05', cardId });

      const all = db.select().from(invoices).all();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        month: '2026-11',
        status: 'OPEN',
        closingDate: '2026-11-10',
        dueDate: '2026-11-17',
        paidAt: null,
      });
      expect(a!.invoiceId).toBe(b!.invoiceId);
    });

    it('compra não parcelada gera 1 transação sem dados de parcela', () => {
      const created = service.createCardPurchase({ description: 'TV', amountCents: 10000, date: '2026-11-01', cardId });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        amountCents: 10000,
        type: 'expense',
        accountId: null,
        installmentGroupId: null,
        installmentNumber: null,
        installmentTotal: null,
      });
    });

    it('10000 centavos em 3x → 3334/3333/3333 em faturas consecutivas (com virada de ano)', () => {
      const created = service.createCardPurchase({
        description: 'Notebook',
        amountCents: 10000,
        date: '2026-11-20', // após o fechamento → 1ª parcela em 2026-12
        cardId,
        isInstallment: true,
        installments: 3,
      });

      expect(created.map((t) => t.amountCents)).toEqual([3334, 3333, 3333]);
      expect(created.reduce((sum, t) => sum + t.amountCents, 0)).toBe(10000);
      expect(created.map((t) => invoiceMonthOf(t.invoiceId))).toEqual(['2026-12', '2027-01', '2027-02']);
      expect(created.map((t) => t.installmentNumber)).toEqual([1, 2, 3]);
      expect(new Set(created.map((t) => t.installmentTotal))).toEqual(new Set([3]));
      expect(new Set(created.map((t) => t.installmentGroupId)).size).toBe(1);
      expect(created[0]!.installmentGroupId).not.toBeNull();
      expect(db.select().from(invoices).all().every((i) => i.status === 'OPEN')).toBe(true);
    });

    it('faz rollback de tudo se uma parcela cair em fatura já paga', () => {
      db.insert(invoices)
        .values({ cardId, month: '2027-01', closingDate: '2027-01-10', dueDate: '2027-01-17', status: 'PAID', paidAt: '2027-01-15' })
        .run();

      expect(() =>
        service.createCardPurchase({
          description: 'Geladeira',
          amountCents: 10000,
          date: '2026-11-01',
          cardId,
          isInstallment: true,
          installments: 3, // 2026-11, 2026-12, 2027-01 (paga)
        }),
      ).toThrow(BusinessRuleError);

      expect(db.select().from(transactions).all()).toHaveLength(0);
      expect(db.select().from(invoices).all().map((i) => i.month)).toEqual(['2027-01']);
    });

    it('valida entrada (fail-fast)', () => {
      const base = { description: 'X', amountCents: 100, date: '2026-11-01', cardId };
      expect(() => service.createCardPurchase({ ...base, isInstallment: true })).toThrow(ZodError);
      expect(() => service.createCardPurchase({ ...base, installments: 3 })).toThrow(ZodError);
      expect(() => service.createCardPurchase({ ...base, amountCents: 2, isInstallment: true, installments: 3 })).toThrow(ZodError);
      expect(() => service.createCardPurchase({ ...base, amountCents: 10.5 })).toThrow(ZodError);
      expect(() => service.createCardPurchase({ ...base, date: '2026-02-30' })).toThrow(ZodError);
      expect(() => service.createCardPurchase({ ...base, cardId: 'nao-existe' })).toThrow(NotFoundError);
    });

    it('rejeita categoria de receita em compra no cartão', () => {
      const income = db.insert(categories).values({ name: 'Salário', kind: 'income' }).returning().get();
      expect(() =>
        service.createCardPurchase({ description: 'X', amountCents: 100, date: '2026-11-01', cardId, categoryId: income.id }),
      ).toThrow(BusinessRuleError);
    });
  });

  describe('createAccountTransaction', () => {
    it('cria transação à vista vinculada à conta, sem fatura', () => {
      const created = service.createAccountTransaction({
        description: 'Padaria',
        amountCents: 1250,
        type: 'expense',
        date: '2026-11-01',
        accountId,
        isPaid: true,
      });
      expect(created).toMatchObject({ accountId, invoiceId: null, isPaid: true, amountCents: 1250 });
      expect(db.select().from(invoices).all()).toHaveLength(0);
    });

    it('boleto agendado: is_paid padrão é false', () => {
      const created = service.createAccountTransaction({
        description: 'Boleto luz',
        amountCents: 18990,
        type: 'expense',
        date: '2026-11-25',
        accountId,
      });
      expect(created.isPaid).toBe(false);
    });

    it('exige account_id e proíbe invoice_id', () => {
      const base = { description: 'X', amountCents: 100, type: 'expense' as const, date: '2026-11-01' };
      // @ts-expect-error accountId obrigatório
      expect(() => service.createAccountTransaction(base)).toThrow(ZodError);
      expect(() =>
        // @ts-expect-error invoiceId não faz parte do contrato
        service.createAccountTransaction({ ...base, accountId, invoiceId: 'qualquer' }),
      ).toThrow(ZodError);
      expect(() => service.createAccountTransaction({ ...base, accountId: 'nao-existe' })).toThrow(NotFoundError);
    });
  });

  describe('update installment siblings', () => {
    it('atualização de dia em parcela preserva os meses das parcelas seguintes', () => {
      const installments = service.createCardPurchase({
        description: 'Sofá',
        amountCents: 90000,
        date: '2026-10-15',
        cardId,
        isInstallment: true,
        installments: 3,
      });

      expect(installments).toHaveLength(3);
      // Atualiza a primeira parcela mudando a data para dia 20 (2026-10-20) e valor para 350,00
      service.update(installments[0].id, {
        date: '2026-10-20',
        amountCents: 35000,
      });

      const updated1 = service.list().find((t) => t.id === installments[0].id)!;
      const updated2 = service.list().find((t) => t.id === installments[1].id)!;
      const updated3 = service.list().find((t) => t.id === installments[2].id)!;

      expect(updated1.date).toBe('2026-10-20');
      expect(updated1.amountCents).toBe(35000);

      // As parcelas irmãs devem ter o valor atualizado e o dia atualizado para 20, preservando seus meses originais
      expect(updated2.amountCents).toBe(35000);
      expect(updated2.date.endsWith('-20')).toBe(true);
      expect(updated3.amountCents).toBe(35000);
      expect(updated3.date.endsWith('-20')).toBe(true);
    });
  });
});

