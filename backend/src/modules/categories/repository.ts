import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { categories, type Category, type NewCategory } from '../../db/schema.js';

export function findCategoryById(db: DbOrTx, id: string): Category | undefined {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export function findCategoryByKindAndName(
  db: DbOrTx,
  kind: Category['kind'],
  name: string,
): Category | undefined {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.kind, kind), eq(categories.name, name)))
    .get();
}

export function listCategories(
  db: DbOrTx,
  filter: { kind?: Category['kind'] | undefined },
): Category[] {
  return db
    .select()
    .from(categories)
    .where(filter.kind ? eq(categories.kind, filter.kind) : undefined)
    .orderBy(asc(categories.kind), asc(categories.name))
    .all();
}

export function insertCategory(db: DbOrTx, data: NewCategory): Category {
  return db.insert(categories).values(data).returning().get();
}

export function updateCategoryById(
  db: DbOrTx,
  id: string,
  data: Partial<Pick<Category, 'name' | 'monthlyBudgetCents'>>,
): Category {
  return db.update(categories).set(data).where(eq(categories.id, id)).returning().get();
}
