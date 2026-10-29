import type { DB } from '../../db/client.js';
import type { Account } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import {
  countTransactionsByAccountId,
  deleteAccountById,
  findAccountById,
  findAccountByName,
  insertAccount,
  listAccounts,
} from './repository.js';
import type { CreateAccountInput } from './schemas.js';

export function createAccountsService(db: DB) {
  return {
    list(): Account[] {
      return listAccounts(db);
    },

    create(input: CreateAccountInput): Account {
      if (findAccountByName(db, input.name)) {
        throw new ConflictError(`Já existe uma conta chamada "${input.name}"`);
      }
      return insertAccount(db, input);
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
