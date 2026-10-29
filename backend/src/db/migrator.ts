import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { MIGRATIONS_DIR } from '../config/paths.js';
import { createDb } from './client.js';

/**
 * Aplica as migrations pendentes geradas pelo drizzle-kit.
 *
 * As FKs são desligadas durante a migração porque o SQLite ignora
 * `PRAGMA foreign_keys` dentro de transações, e o drizzle-kit recria tabelas
 * (DROP + CREATE) em alterações de coluna — o que dispararia cascatas.
 * Ao final, `foreign_key_check` garante que nenhuma referência ficou órfã
 * e as FKs são religadas.
 */
export function runMigrations(sqlite: Database.Database, migrationsFolder = MIGRATIONS_DIR): void {
  if (!fs.existsSync(path.join(migrationsFolder, 'meta', '_journal.json'))) {
    throw new Error(`Nenhuma migration encontrada em ${migrationsFolder}. Rode "npm run db:generate".`);
  }

  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(createDb(sqlite), { migrationsFolder });

    const violations = sqlite.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(`Migração deixou violações de FK: ${JSON.stringify(violations)}`);
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}

