import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { env } from '../config/env.js';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema>;
/** Conexão ou transação ativa — repositórios aceitam ambos. */
export type DbOrTx = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

export function createSqlite(filePath: string = env.DATABASE_PATH): Database.Database {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const sqlite = new Database(filePath);

  // Obrigatório: SQLite vem com FKs desligadas por padrão, por conexão.
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');

  const fkEnabled = sqlite.pragma('foreign_keys', { simple: true });
  if (fkEnabled !== 1) {
    sqlite.close();
    throw new Error('Falha ao habilitar PRAGMA foreign_keys no SQLite.');
  }

  return sqlite;
}

export function createDb(sqlite: Database.Database): DB {
  return drizzle(sqlite, { schema });
}

export const sqlite = createSqlite();
export const db: DB = createDb(sqlite);

