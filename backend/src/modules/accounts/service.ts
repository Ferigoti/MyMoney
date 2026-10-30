import type { DB } from '../../db/client.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import {
  countTransactionsByAccountId,
  deleteAccountById,
  findAccountById,
  findAccountByName,
  insertAccount,
  listAccounts,
  sumPaidNetByAccountId,
  updateAccountById,
  type AccountWithBalance,
} from './repository.js';
import type { CreateAccountInput, UpdateAccountInput } from './schemas.js';

export function createAccountsService(db: DB) {
  return {
    list(): AccountWithBalance[] {
      return listAccounts(db);
    },

    create(input: CreateAccountInput): AccountWithBalance {
      if (findAccountByName(db, input.name)) {
        throw new ConflictError(`Já existe uma conta chamada "${input.name}"`);
      }
      const created = insertAccount(db, input);
      return {
        ...created,
        currentBalanceCents: created.initialBalanceCents,
      };
    },

    update(id: string, input: UpdateAccountInput): AccountWithBalance {
      return db.transaction((tx) => {
        const current = findAccountById(tx, id);
        if (!current) throw new NotFoundError('Conta', id);

        if (input.name !== undefined && input.name !== current.name) {
          if (findAccountByName(tx, input.name)) {
            throw new ConflictError(`Já existe uma conta chamada "${input.name}"`);
          }
        }

        const paidNetCents = sumPaidNetByAccountId(tx, id);
        const nextInitialBalanceCents =
          input.currentBalanceCents !== undefined
            ? input.currentBalanceCents - paidNetCents
            : input.initialBalanceCents;

        const updated = updateAccountById(tx, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(nextInitialBalanceCents !== undefined
            ? { initialBalanceCents: nextInitialBalanceCents }
            : {}),
        });

        return {
          ...updated,
          currentBalanceCents: updated.initialBalanceCents + paidNetCents,
        };
      });
    },

    delete(id: string): { deletedId: string } {
      return db.transaction((tx) => {
        const account = findAccountById(tx, id);
        if (!account) throw new NotFoundError('Conta', id);

        const txCount = countTransactionsByAccountId(tx, id);
        if (txCount > 0) {
          throw new ConflictError(
            `Não é possível excluir a conta "${account.name}" pois existem ${txCount} transação(ões) vinculada(s)`,
          );
        }

        deleteAccountById(tx, id);
        return { deletedId: id };
      });
    },
  };
}
