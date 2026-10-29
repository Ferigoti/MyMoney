import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { sqlite } from '../src/db/client.js';

describe('bootstrap', () => {
  it('responde /health', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('habilita foreign_keys no SQLite', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
