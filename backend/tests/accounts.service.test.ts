import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createSqlite, type DB } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';
import { accounts, transactions } from '../src/db/schema.js';
import { createAccountsService } from '../src/modules/accounts/service.js';
import { updateAccountSchema } from '../src/modules/accounts/schemas.js';

describe('accounts service — ajuste manual do saldo atual', () => {
  let db: DB;
  let accountId: string;

  beforeEach(() => {
    const sqlite = createSqlite(':memory:');
    runMigrations(sqlite);
    db = createDb(sqlite);
    accountId = db
      .insert(accounts)
      .values({ name: 'Corrente', initialBalanceCents: 10_000 })
      .returning()
      .get().id;

    // +5.000 recebido, -3.000 pago, -1.000 pendente (não entra no saldo atual)
    db.insert(transactions)
      .values([
        { description: 'Salário', amountCents: 5_000, type: 'income', date: '2026-10-05', accountId, isPaid: true },
        { description: 'Mercado', amountCents: 3_000, type: 'expense', date: '2026-10-06', accountId, isPaid: true },
        { description: 'Luz', amountCents: 1_000, type: 'expense', date: '2026-10-20', accountId, isPaid: false },
      ])
      .run();
  });

  it('lista o saldo atual = saldo inicial + líquido pago', () => {
    const [acc] = createAccountsService(db).list();
    expect(acc?.currentBalanceCents).toBe(12_000);
  });

  it('recalcula o saldo inicial para atingir exatamente o saldo atual informado', () => {
    const service = createAccountsService(db);
    const updated = service.update(accountId, { currentBalanceCents: 20_000 });
    expect(updated.currentBalanceCents).toBe(20_000);
    expect(updated.initialBalanceCents).toBe(18_000);
    expect(service.list()[0]?.currentBalanceCents).toBe(20_000);
  });

  it('aceita saldo atual negativo (cheque especial)', () => {
    const updated = createAccountsService(db).update(accountId, { currentBalanceCents: -500 });
    expect(updated.currentBalanceCents).toBe(-500);
  });

  it('rejeita payload vazio', () => {
    expect(updateAccountSchema.safeParse({}).success).toBe(false);
  });
});

