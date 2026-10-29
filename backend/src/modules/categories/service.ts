import type { DB } from '../../db/client.js';
import type { Category } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import {
  findCategoryById,
  findCategoryByKindAndName,
  insertCategory,
  listCategories,
  updateCategoryById,
} from './repository.js';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './schemas.js';

export function createCategoriesService(db: DB) {
  return {
    list(query: ListCategoriesQuery): Category[] {
      return listCategories(db, query);
    },

    create(input: CreateCategoryInput): Category {
      if (findCategoryByKindAndName(db, input.kind, input.name)) {
        throw new ConflictError(`Já existe a categoria "${input.name}" (${input.kind})`);
      }
      const monthlyBudgetCents = input.monthlyBudgetCents ?? input.monthly_budget_cents ?? 0;
      return insertCategory(db, {
        name: input.name,
        kind: input.kind,
        monthlyBudgetCents,
      });
    },

    update(id: string, input: UpdateCategoryInput): Category {
      const existing = findCategoryById(db, id);
      if (!existing) throw new NotFoundError('Categoria', id);

      if (input.name !== undefined && input.name !== existing.name) {
        if (findCategoryByKindAndName(db, existing.kind, input.name)) {
          throw new ConflictError(`Já existe a categoria "${input.name}" (${existing.kind})`);
        }
      }

      const nextBudget = input.monthlyBudgetCents ?? input.monthly_budget_cents;

      return updateCategoryById(db, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(nextBudget !== undefined ? { monthlyBudgetCents: nextBudget } : {}),
      });
    },
  };
}
