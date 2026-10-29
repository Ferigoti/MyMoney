import type { DB } from '../../db/client.js';
import type { CreditCard } from '../../db/schema.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors.js';
import { findAccountById } from '../accounts/repository.js';
import {
  findCreditCardById,
  findCreditCardByName,
  insertCreditCard,
  listCreditCards,
  sumUsedLimitByCard,
  updateCreditCardById,
} from './repository.js';
import type { CreateCardInput, UpdateCardInput } from './schemas.js';

export interface CreditCardWithLimit extends CreditCard {
  usedCents: number;
  /** Pode ficar negativo se o limite foi estourado. */
  availableCents: number;
}

export function createCardsService(db: DB) {
  return {
    list(): CreditCardWithLimit[] {
      const used = sumUsedLimitByCard(db);
      return listCreditCards(db).map((card) => {
        const usedCents = used.get(card.id) ?? 0;
        return { ...card, usedCents, availableCents: card.limitCents - usedCents };
      });
    },

    create(input: CreateCardInput): CreditCard {
      if (findCreditCardByName(db, input.name)) {
        throw new ConflictError(`Já existe um cartão chamado "${input.name}"`);
      }
      if (input.paymentAccountId !== undefined) {
        const account = findAccountById(db, input.paymentAccountId);
        if (!account) throw new NotFoundError('Conta', input.paymentAccountId);
        if (account.isArchived) throw new BusinessRuleError(`Conta "${account.name}" está arquivada`);
      }
      return insertCreditCard(db, { ...input, paymentAccountId: input.paymentAccountId ?? null });
    },

    update(id: string, input: UpdateCardInput): CreditCardWithLimit {
      return db.transaction((tx) => {
        const existing = findCreditCardById(tx, id);
        if (!existing) throw new NotFoundError('Cartão', id);

        if (input.name !== undefined && input.name !== existing.name) {
          if (findCreditCardByName(tx, input.name)) {
            throw new ConflictError(`Já existe um cartão chamado "${input.name}"`);
          }
        }

        if (input.paymentAccountId !== undefined && input.paymentAccountId !== null) {
          const account = findAccountById(tx, input.paymentAccountId);
          if (!account) throw new NotFoundError('Conta', input.paymentAccountId);
          if (account.isArchived) {
            throw new BusinessRuleError(`Conta "${account.name}" está arquivada`);
          }
        }

        const nextLimit = input.limitCents ?? input.limit_cents;
        const nextClosing = input.closingDay ?? input.closing_day;
        const nextDue = input.dueDay ?? input.due_day;

        const updated = updateCreditCardById(tx, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(nextLimit !== undefined ? { limitCents: nextLimit } : {}),
          ...(nextClosing !== undefined ? { closingDay: nextClosing } : {}),
          ...(nextDue !== undefined ? { dueDay: nextDue } : {}),
          ...(input.paymentAccountId !== undefined
            ? { paymentAccountId: input.paymentAccountId }
            : {}),
        });

        const usedCents = sumUsedLimitByCard(tx).get(updated.id) ?? 0;
        return {
          ...updated,
          usedCents,
          availableCents: updated.limitCents - usedCents,
        };
      });
    },
  };
}
