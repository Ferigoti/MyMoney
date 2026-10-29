import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';
import { accounts, categories } from '../src/db/schema.js';
import { DEFAULT_CATEGORIES, ensureSeedData } from '../src/db/seed.js';

describe('Database Seed (ensureSeedData)', () => {
  let sqlite: Database.Database;
  let db: DB;

  beforeEach(() => {
    sqlite = createSqlite(':memory:');
    runMigrations(sqlite);
    db = createDb(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('insere categorias padrão e Conta Principal quando o banco está vazio e é idempotente', () => {
    const firstRun = ensureSeedData(db);
    expect(firstRun.categoriesInserted).toBe(DEFAULT_CATEGORIES.length);
    expect(firstRun.accountsInserted).toBe(1);

    const allCats = db.select().from(categories).all();
    const allAccs = db.select().from(accounts).all();
    expect(allCats.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Salário', 'Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde']),
    );
    expect(allAccs[0]).toMatchObject({
      name: 'Conta Principal',
      initialBalanceCents: 0,
    });

    // Segunda chamada não duplica registros
    const secondRun = ensureSeedData(db);
    expect(secondRun).toEqual({ categoriesInserted: 0, accountsInserted: 0 });
  });
});

