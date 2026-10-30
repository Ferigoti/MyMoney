import type { DB, DbOrTx } from '../../db/client.js';
import type { NewTransaction, Transaction } from '../../db/schema.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { findAccountById } from '../accounts/repository.js';
import { findCreditCardById } from '../cards/repository.js';
import { findCategoryById } from '../categories/repository.js';
import {
  findInvoiceById,
  findInvoiceByPaymentTransactionId,
  findOrCreateInvoice,
  markInvoiceUnpaid,
  sumInvoiceTotal,
} from '../invoices/repository.js';
import {
  deleteRecurringById,
  insertRecurringTransaction,
  updateRecurringById,
} from '../recurring/repository.js';
import { materializeRecurringForMonth } from '../recurring/service.js';
import {
  deleteInstallmentsFromNumber,
  deleteTransactionById,
  findTransactionById,
  insertTransactions,
  listInstallmentFromNumber,
  listTransactions,
  listUnpaidByInstallmentGroup,
  listUnpaidByRecurringId,
  updateTransactionById,
  updateTransactionPaid,
} from './repository.js';
import {
  createAccountTransactionSchema,
  createCardPurchaseSchema,
  createTransactionSchema,
  deleteTransactionQuerySchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
  type CreateAccountTransactionInput,
  type CreateCardPurchaseInput,
  type CreateTransactionInput,
  type DeleteScope,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Funções puras (datas e centavos)
// ---------------------------------------------------------------------------

export interface InvoicePeriod {
  /** Competência 'YYYY-MM'. */
  month: string;
  /** 'YYYY-MM-DD' */
  closingDate: string;
  /** 'YYYY-MM-DD' */
  dueDate: string;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

function parseYearMonth(month: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Competência inválida: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Data inválida: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Soma `n` meses a uma competência 'YYYY-MM' (com virada de ano). */
export function addMonths(month: string, n: number): string {
  const { year, month: m } = parseYearMonth(month);
  const index = year * 12 + (m - 1) + n;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** Monta 'YYYY-MM-DD' limitando o dia ao último dia do mês (ex.: dia 31 em fevereiro → 28/29). */
function dateInMonth(month: string, day: number): string {
  const { year, month: m } = parseYearMonth(month);
  return `${month}-${pad(Math.min(day, daysInMonth(year, m)))}`;
}

/**
 * Datas de fechamento e vencimento da fatura de uma competência.
 * A competência é o mês do fechamento; se o vencimento (dia) não for
 * posterior ao fechamento, ele cai no mês seguinte.
 */
export function invoicePeriodForMonth(month: string, closingDay: number, dueDay: number): InvoicePeriod {
  const dueMonth = dueDay > closingDay ? month : addMonths(month, 1);
  return {
    month,
    closingDate: dateInMonth(month, closingDay),
    dueDate: dateInMonth(dueMonth, dueDay),
  };
}

/**
 * Determina a fatura de uma compra no cartão.
 * - dia da compra <= closing_day → competência do próprio mês
 * - dia da compra >  closing_day → competência do mês seguinte
 */
export function resolveInvoicePeriod(purchaseDate: string, closingDay: number, dueDay: number): InvoicePeriod {
  const { year, month, day } = parseIsoDate(purchaseDate);
  const currentMonth = `${pad(year, 4)}-${pad(month)}`;
  const effectiveClosingDay = Math.min(closingDay, daysInMonth(year, month));
  const target = day <= effectiveClosingDay ? currentMonth : addMonths(currentMonth, 1);
  return invoicePeriodForMonth(target, closingDay, dueDay);
}

/**
 * Divide o total em parcelas inteiras; o resto vai para a 1ª parcela.
 * Ex.: 10000 em 3x → [3334, 3333, 3333].
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents deve ser um inteiro positivo');
  }
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count deve ser um inteiro >= 1');
  if (totalCents < count) throw new RangeError('Cada parcela deve ter ao menos 1 centavo');

  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function assertCategory(db: DbOrTx, categoryId: string | undefined, type: 'income' | 'expense'): void {
  if (categoryId === undefined) return;
  const category = findCategoryById(db, categoryId);
  if (!category) throw new NotFoundError('Categoria', categoryId);
  if (category.kind !== type) {
    throw new BusinessRuleError(`Categoria "${category.name}" é de ${category.kind}, mas a transação é ${type}`);
  }
}

function assertInvoiceNotPaid(db: DbOrTx, invoiceId: string | null): void {
  if (!invoiceId) return;
  const invoice = findInvoiceById(db, invoiceId);
  if (invoice?.status === 'PAID') {
    throw new BusinessRuleError(`Fatura ${invoice.month} já está paga e não pode ser alterada`);
  }
}

export function createTransactionsService(db: DB) {
  const service = {
    /**
     * Registra uma compra no cartão (à vista ou parcelada).
     * Tudo roda em uma única transação SQLite: se qualquer parcela falhar,
     * nenhuma transação ou fatura criada é persistida.
     */
    createCardPurchase(rawInput: CreateCardPurchaseInput): Transaction[] {
      const input = createCardPurchaseSchema.parse(rawInput);

      return db.transaction((tx) => {
        const card = findCreditCardById(tx, input.cardId);
        if (!card) throw new NotFoundError('Cartão', input.cardId);
        if (card.isArchived) throw new BusinessRuleError(`Cartão "${card.name}" está arquivado`);
        assertCategory(tx, input.categoryId, 'expense');

        const count = input.isInstallment ? (input.installments ?? 1) : 1;
        const amounts = splitInstallments(input.amountCents, count);
        const firstMonth = resolveInvoicePeriod(input.date, card.closingDay, card.dueDay).month;
        const groupId = input.isInstallment ? crypto.randomUUID() : null;

        let recurringId: string | null = null;
        if (input.isRecurring) {
          const { day } = parseIsoDate(input.date);
          const createdRecurring = insertRecurringTransaction(tx, {
            description: input.description,
            amountCents: input.amountCents,
            accountId: null,
            cardId: card.id,
            categoryId: input.categoryId ?? null,
            type: 'EXPENSE',
            scheduleRule: input.scheduleRule ?? 'FIXED_DAY',
            dueDay: day,
            isActive: true,
          });
          recurringId = createdRecurring.id;
        }

        const rows: NewTransaction[] = amounts.map((amountCents, i) => {
          const period = invoicePeriodForMonth(addMonths(firstMonth, i), card.closingDay, card.dueDay);
          const invoice = findOrCreateInvoice(tx, { cardId: card.id, ...period });
          if (invoice.status === 'PAID') {
            throw new BusinessRuleError(`A fatura ${invoice.month} do cartão "${card.name}" já está paga`);
          }

          return {
            description: input.description,
            amountCents,
            type: 'expense',
            date: input.date,
            accountId: null,
            invoiceId: invoice.id,
            categoryId: input.categoryId ?? null,
            recurringId,
            isPaid: false,
            installmentGroupId: groupId,
            installmentNumber: groupId ? i + 1 : null,
            installmentTotal: groupId ? count : null,
          };
        });

        return insertTransactions(tx, rows);
      });
    },

    /** Transação à vista (débito, dinheiro, boleto): sempre em conta, nunca em fatura. */
    createAccountTransaction(rawInput: CreateAccountTransactionInput): Transaction {
      const input = createAccountTransactionSchema.parse(rawInput);

      return db.transaction((tx) => {
        const account = findAccountById(tx, input.accountId);
        if (!account) throw new NotFoundError('Conta', input.accountId);
        if (account.isArchived) throw new BusinessRuleError(`Conta "${account.name}" está arquivada`);
        assertCategory(tx, input.categoryId, input.type);

        let recurringId: string | null = null;
        if (input.isRecurring) {
          const { day } = parseIsoDate(input.date);
          const createdRecurring = insertRecurringTransaction(tx, {
            description: input.description,
            amountCents: input.amountCents,
            accountId: account.id,
            categoryId: input.categoryId ?? null,
            type: input.type === 'income' ? 'INCOME' : 'EXPENSE',
            scheduleRule: input.scheduleRule ?? 'FIXED_DAY',
            dueDay: day,
            isActive: true,
          });
          recurringId = createdRecurring.id;
        }

        const [created] = insertTransactions(tx, [
          {
            description: input.description,
            amountCents: input.amountCents,
            type: input.type,
            date: input.date,
            accountId: account.id,
            invoiceId: null,
            categoryId: input.categoryId ?? null,
            recurringId,
            isPaid: input.isPaid,
          },
        ]);
        if (!created) throw new Error('Falha ao inserir transação');
        return created;
      });
    },

    /**
     * Entrada unificada para `POST /transactions`: delega para `createAccountTransaction`
     * ou `createCardPurchase` e sempre retorna a lista de transações criadas.
     */
    create(rawInput: CreateTransactionInput): Transaction[] {
      const input = createTransactionSchema.parse(rawInput);

      if (input.accountId !== undefined) {
        const created = service.createAccountTransaction({
          description: input.description,
          amountCents: input.amountCents,
          type: input.type!,
          date: input.date,
          accountId: input.accountId,
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.isPaid !== undefined ? { isPaid: input.isPaid } : {}),
          isRecurring: input.isRecurring,
          scheduleRule: input.scheduleRule,
        });
        return [created];
      }

      return service.createCardPurchase({
        description: input.description,
        amountCents: input.amountCents,
        date: input.date,
        cardId: input.cardId!,
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        isRecurring: input.isRecurring,
        scheduleRule: input.scheduleRule,
        isInstallment: input.isInstallment,
        ...(input.installments !== undefined ? { installments: input.installments } : {}),
      });
    },

    /** Lista transações com filtros opcionais de competência, status, categoria, conta e cartão. */
    list(rawQuery: Partial<ListTransactionsQuery> = {}): Transaction[] {
      const query = listTransactionsQuerySchema.parse(rawQuery);
      if (query.month) {
        db.transaction((tx) => {
          materializeRecurringForMonth(tx, query.month!);
        });
      }
      return listTransactions(db, query);
    },

    /**
     * Atualiza descrição, valor, data e/ou categoria de uma transação (`PUT /transactions/:id`).
     * Se a transação pertencer a uma fatura já paga (`PAID`), bloqueia a alteração do valor
     * para preservar a conciliação histórica.
     */
    update(id: string, rawInput: UpdateTransactionInput): Transaction {
      const input = updateTransactionSchema.parse(rawInput);

      return db.transaction((tx) => {
        const current = findTransactionById(tx, id);
        if (!current) throw new NotFoundError('Transação', id);

        if (findInvoiceByPaymentTransactionId(tx, id)) {
          throw new BusinessRuleError(
            'Transação de pagamento de fatura não pode ser editada diretamente',
          );
        }

        const nextAmountCents = input.amountCents ?? input.amount_cents;

        if (current.invoiceId !== null) {
          const invoice = findInvoiceById(tx, current.invoiceId);
          if (
            invoice?.status === 'PAID' &&
            nextAmountCents !== undefined &&
            nextAmountCents !== current.amountCents
          ) {
            throw new BusinessRuleError(
              `Não é permitido alterar o valor de uma transação vinculada a uma fatura já paga (${invoice.month})`,
            );
          }
          if (input.isPaid !== undefined) {
            throw new BusinessRuleError(
              'Compras no cartão são quitadas pelo pagamento da fatura (não use isPaid)',
            );
          }
        }

        const hasCategoryUpdate =
          input.categoryId !== undefined || input.category_id !== undefined;
        const nextCategoryId =
          input.categoryId !== undefined ? input.categoryId : input.category_id;

        if (hasCategoryUpdate && nextCategoryId !== null && nextCategoryId !== undefined) {
          assertCategory(tx, nextCategoryId, current.type);
        }

        const updated = updateTransactionById(tx, id, {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(nextAmountCents !== undefined ? { amountCents: nextAmountCents } : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(hasCategoryUpdate ? { categoryId: nextCategoryId ?? null } : {}),
          ...(input.isPaid !== undefined ? { isPaid: input.isPaid } : {}),
        });

        // Se for uma parcela de cartão (installmentGroupId !== null), propaga descrição, valor, dia da data e categoria
        // para todas as demais parcelas em faturas ainda não pagas (todos os meses).
        if (current.installmentGroupId !== null) {
          const nextDay = input.date !== undefined ? parseIsoDate(input.date).day : undefined;
          const unpaidInstallments = listUnpaidByInstallmentGroup(tx, current.installmentGroupId);
          for (const sibling of unpaidInstallments) {
            if (sibling.id === id) continue;
            const siblingMonth = sibling.date.slice(0, 7);
            updateTransactionById(tx, sibling.id, {
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(nextAmountCents !== undefined ? { amountCents: nextAmountCents } : {}),
              ...(nextDay !== undefined ? { date: dateInMonth(siblingMonth, nextDay) } : {}),
              ...(hasCategoryUpdate ? { categoryId: nextCategoryId ?? null } : {}),
            });
          }
        }

        // Se for uma transação recorrente / assinatura e updateRecurring não foi desativado,
        // propaga as alterações para a regra fixa e para todos os meses já materializados não pagos.
        if (current.recurringId !== null && input.updateRecurring !== false) {
          const nextDueDay = input.date !== undefined ? parseIsoDate(input.date).day : undefined;

          updateRecurringById(tx, current.recurringId, {
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(nextAmountCents !== undefined ? { amountCents: nextAmountCents } : {}),
            ...(hasCategoryUpdate ? { categoryId: nextCategoryId ?? null } : {}),
            ...(nextDueDay !== undefined ? { dueDay: nextDueDay } : {}),
          });

          const unpaidOccurrences = listUnpaidByRecurringId(tx, current.recurringId);
          for (const occurrence of unpaidOccurrences) {
            if (occurrence.id === id) continue;
            const occurrenceMonth = occurrence.date.slice(0, 7);
            updateTransactionById(tx, occurrence.id, {
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(nextAmountCents !== undefined ? { amountCents: nextAmountCents } : {}),
              ...(hasCategoryUpdate ? { categoryId: nextCategoryId ?? null } : {}),
              ...(nextDueDay !== undefined
                ? { date: dateInMonth(occurrenceMonth, nextDueDay) }
                : {}),
            });
          }
        }

        return updated;
      });
    },

    /** Alterna `is_paid` para transações fora do cartão (contas à vista/boletos). */
    togglePaid(id: string): Transaction {
      return db.transaction((tx) => {
        const current = findTransactionById(tx, id);
        if (!current) throw new NotFoundError('Transação', id);
        if (current.invoiceId !== null) {
          throw new BusinessRuleError(
            'Transações de cartão de crédito são quitadas pelo pagamento da fatura (PATCH /invoices/:id/pay)',
          );
        }
        if (findInvoiceByPaymentTransactionId(tx, id)) {
          throw new BusinessRuleError('Transação de pagamento de fatura não pode ter seu status alterado');
        }
        return updateTransactionPaid(tx, id, !current.isPaid);
      });
    },

    /**
     * Remove uma transação. Se for parcela de cartão e `scope = 'future'`,
     * remove esta parcela e todas as parcelas subsequentes do mesmo grupo,
     * recalculando os totais das faturas afetadas.
     */
    delete(
      id: string,
      rawScope: DeleteScope = 'single',
    ): {
      deletedIds: string[];
      deletedCount: number;
      affectedInvoices: { invoiceId: string; totalCents: number }[];
    } {
      const { scope } = deleteTransactionQuerySchema.parse({ scope: rawScope });

      return db.transaction((tx) => {
        const target = findTransactionById(tx, id);
        if (!target) throw new NotFoundError('Transação', id);

        const linkedPaidInvoice = findInvoiceByPaymentTransactionId(tx, id);
        if (linkedPaidInvoice) {
          markInvoiceUnpaid(tx, linkedPaidInvoice.id);
        }

        if (
          scope === 'future' &&
          target.installmentGroupId !== null &&
          target.installmentNumber !== null
        ) {
          const candidates = listInstallmentFromNumber(
            tx,
            target.installmentGroupId,
            target.installmentNumber,
          );
          for (const item of candidates) {
            assertInvoiceNotPaid(tx, item.invoiceId);
          }
          const deleted = deleteInstallmentsFromNumber(
            tx,
            target.installmentGroupId,
            target.installmentNumber,
          );
          const uniqueInvoiceIds = Array.from(
            new Set(deleted.map((d) => d.invoiceId).filter((invId): invId is string => invId !== null)),
          );
          const affectedInvoices = uniqueInvoiceIds.map((invoiceId) => ({
            invoiceId,
            totalCents: sumInvoiceTotal(tx, invoiceId),
          }));

          return {
            deletedIds: deleted.map((d) => d.id),
            deletedCount: deleted.length,
            affectedInvoices,
          };
        }

        assertInvoiceNotPaid(tx, target.invoiceId);
        if (target.recurringId !== null && scope === 'future') {
          const unpaidOccurrences = listUnpaidByRecurringId(tx, target.recurringId);
          for (const occ of unpaidOccurrences) {
            if (occ.id !== id && occ.date >= target.date) {
              deleteTransactionById(tx, occ.id);
            }
          }
          deleteRecurringById(tx, target.recurringId);
        }
        const deleted = deleteTransactionById(tx, id);
        const affectedInvoices =
          target.invoiceId !== null
            ? [{ invoiceId: target.invoiceId, totalCents: sumInvoiceTotal(tx, target.invoiceId) }]
            : [];

        return {
          deletedIds: deleted.map((d) => d.id),
          deletedCount: deleted.length,
          affectedInvoices,
        };
      });
    },
  };

  return service;
}

export type TransactionsService = ReturnType<typeof createTransactionsService>;
