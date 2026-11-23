import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('serve frontend estático (modo desktop) sem conflito de notFoundHandler', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymoney-static-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html><body>MyMoney</body></html>');
      const app = buildApp({ staticDir: tmpDir });

      const homeRes = await app.inject({ method: 'GET', url: '/' });
      expect(homeRes.statusCode).toBe(200);
      expect(homeRes.body).toContain('MyMoney');

      const healthRes = await app.inject({ method: 'GET', url: '/health' });
      expect(healthRes.statusCode).toBe(200);

      const post404 = await app.inject({ method: 'POST', url: '/rota-inexistente' });
      expect(post404.statusCode).toBe(404);

      await app.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
