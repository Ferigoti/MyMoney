import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { db as defaultDb, sqlite as defaultSqlite, type DB } from './client.js';
import { runMigrations } from './migrator.js';
import { accounts, categories, type NewCategory } from './schema.js';

export const DEFAULT_CATEGORIES: NewCategory[] = [
  { name: 'Salário', kind: 'income' },
  { name: 'Renda Extra', kind: 'income' },
  { name: 'Vale', kind: 'income' },
  { name: 'Alimentação', kind: 'expense' },
  { name: 'Moradia', kind: 'expense' },
  { name: 'Transporte', kind: 'expense' },
  { name: 'Lazer', kind: 'expense' },
  { name: 'Saúde', kind: 'expense' },
];

export interface SeedResult {
  categoriesInserted: number;
  accountsInserted: number;
}

/**
 * Garante os dados iniciais do sistema caso as tabelas `categories` ou `accounts`
 * estejam vazias. Idempotente e executada dentro de uma transação SQLite.
 */
export function ensureSeedData(db: DB = defaultDb): SeedResult {
  return db.transaction((tx) => {
    let categoriesInserted = 0;
    let accountsInserted = 0;

    const catCountRow = tx
      .select({ count: sql<number>`count(*)` })
      .from(categories)
      .get();

    if (Number(catCountRow?.count ?? 0) === 0) {
      const inserted = tx
        .insert(categories)
        .values(DEFAULT_CATEGORIES)
        .onConflictDoNothing()
        .returning()
        .all();
      categoriesInserted = inserted.length;
    }

    const accCountRow = tx
      .select({ count: sql<number>`count(*)` })
      .from(accounts)
      .get();

    if (Number(accCountRow?.count ?? 0) === 0) {
      const inserted = tx
        .insert(accounts)
        .values({
          name: 'Conta Principal',
          type: 'checking',
          initialBalanceCents: 0,
        })
        .onConflictDoNothing()
        .returning()
        .all();
      accountsInserted = inserted.length;
    }

    return { categoriesInserted, accountsInserted };
  });
}

// Permite rodar diretamente via `npm run db:seed` (`tsx src/db/seed.ts`)
const isExecutedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isExecutedDirectly) {
  try {
    runMigrations(defaultSqlite);
    const result = ensureSeedData(defaultDb);
    console.log(
      `Seed concluído: ${result.categoriesInserted} categoria(s) e ${result.accountsInserted} conta(s) inserida(s).`,
    );
  } finally {
    defaultSqlite.close();
  }
}

