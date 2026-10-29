import { resolveRecurringDateForMonth } from '@feriados/brasil';
import type { DB, DbOrTx } from '../../db/client.js';
import type { NewTransaction, RecurringTransaction, Transaction } from '../../db/schema.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { findAccountById } from '../accounts/repository.js';
import { findCreditCardById } from '../cards/repository.js';
import { findCategoryById } from '../categories/repository.js';
import { findOrCreateInvoice } from '../invoices/repository.js';
import { insertTransactions } from '../transactions/repository.js';
import { addMonths, invoicePeriodForMonth } from '../transactions/transactions.service.js';
import {
  deleteRecurringById,
  findEarliestRecurringMonths,
  findMaterializedRecurringIdsForMonth,
  findRecurringById,
  insertRecurringTransaction,
  listActiveRecurringTransactions,
  listRecurringTransactions,
} from './repository.js';
import { createRecurringSchema, type CreateRecurringInput } from './schemas.js';

/**
 * Materializa contas recorrentes e assinaturas de cartão ativas que ainda não foram geradas
 * como transações para a competência `month` (`YYYY-MM`), com `isPaid = false`.
 */
export function materializeRecurringForMonth(db: DbOrTx, month: string): Transaction[] {
  const activeRules = listActiveRecurringTransactions(db);
  if (activeRules.length === 0) return [];

  const existingIds = findMaterializedRecurringIdsForMonth(db, month);
  const earliestMonths = findEarliestRecurringMonths(db);
  const pendingRules = activeRules.filter((rule) => {
    if (existingIds.has(rule.id)) return false;
    const earliestMonth = earliestMonths.get(rule.id);
    if (earliestMonth && month < earliestMonth) return false;
    return true;
  });
  if (pendingRules.length === 0) return [];

  const rowsToInsert: NewTransaction[] = [];
  for (const rule of pendingRules) {
    if (rule.cardId) {
      const card = findCreditCardById(db, rule.cardId);
      if (!card || card.isArchived) continue;

      const period = invoicePeriodForMonth(month, card.closingDay, card.dueDay);
      const invoice = findOrCreateInvoice(db, { cardId: card.id, ...period });
      if (invoice.status === 'PAID') continue;

      const chargeMonth = rule.dueDay > card.closingDay ? addMonths(month, -1) : month;
      const cardChargeDate = resolveRecurringDateForMonth(
        chargeMonth,
        rule.scheduleRule,
        rule.dueDay,
      );

      rowsToInsert.push({
        description: rule.description,
        amountCents: rule.amountCents,
        type: 'expense',
        date: cardChargeDate,
        accountId: null,
        invoiceId: invoice.id,
        categoryId: rule.categoryId ?? null,
        recurringId: rule.id,
        isPaid: false,
      });
      continue;
    }

    if (!rule.accountId) continue;
    const account = findAccountById(db, rule.accountId);
    if (!account || account.isArchived) continue;

    const resolvedDate = resolveRecurringDateForMonth(month, rule.scheduleRule, rule.dueDay);

    const normalizedType: 'income' | 'expense' =
      rule.type.toUpperCase() === 'INCOME' ? 'income' : 'expense';

    rowsToInsert.push({
      description: rule.description,
      amountCents: rule.amountCents,
      type: normalizedType,
      date: resolvedDate,
      accountId: rule.accountId,
      invoiceId: null,
      categoryId: rule.categoryId ?? null,
      recurringId: rule.id,
      isPaid: false,
    });
  }

  if (rowsToInsert.length === 0) return [];
  return insertTransactions(db, rowsToInsert);
}

export function createRecurringService(db: DB) {
  return {
    list(): RecurringTransaction[] {
      return listRecurringTransactions(db);
    },

    create(rawInput: CreateRecurringInput): RecurringTransaction {
      const input = createRecurringSchema.parse(rawInput);

      const amountCents = (input.amountCents ?? input.amount_cents)!;
      const accountId = (input.accountId ?? input.account_id)!;
      const scheduleRule = input.scheduleRule ?? input.schedule_rule ?? 'FIXED_DAY';
      const dueDay =
        input.dueDay ?? input.due_day ?? (scheduleRule === 'FIFTH_BUSINESS_DAY' ? 5 : 1);
      const categoryId =
        input.categoryId !== undefined ? input.categoryId : (input.category_id ?? null);
      const isActive = input.isActive ?? input.is_active ?? true;
      const normalizedKind: 'income' | 'expense' =
        input.type.toUpperCase() === 'INCOME' ? 'income' : 'expense';

      return db.transaction((tx) => {
        const account = findAccountById(tx, accountId);
        if (!account) throw new NotFoundError('Conta', accountId);
        if (account.isArchived) {
          throw new BusinessRuleError(`Conta "${account.name}" está arquivada`);
        }

        if (categoryId) {
          const category = findCategoryById(tx, categoryId);
          if (!category) throw new NotFoundError('Categoria', categoryId);
          if (category.kind !== normalizedKind) {
            throw new BusinessRuleError(
              `Categoria "${category.name}" é de ${category.kind}, mas a recorrência é ${normalizedKind}`,
            );
          }
        }

        return insertRecurringTransaction(tx, {
          description: input.description,
          amountCents,
          accountId,
          categoryId,
          type: input.type.toUpperCase() === 'INCOME' ? 'INCOME' : 'EXPENSE',
          scheduleRule,
          dueDay,
          isActive,
        });
      });
    },

    delete(id: string): { deletedId: string } {
      return db.transaction((tx) => {
        const existing = findRecurringById(tx, id);
        if (!existing) throw new NotFoundError('Conta recorrente', id);
        deleteRecurringById(tx, id);
        return { deletedId: id };
      });
    },
  };
}

