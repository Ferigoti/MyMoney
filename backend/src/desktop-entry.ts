import type { AddressInfo } from 'node:net';
import { buildApp } from './app.js';
import { db, sqlite } from './db/client.js';
import { runMigrations } from './db/migrator.js';
import { ensureSeedData } from './db/seed.js';

export interface StartDesktopServerOptions {
  staticDir: string;
  migrationsDir?: string;
  host?: string;
  port?: number;
}

export interface DesktopServerHandle {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Inicializa o servidor Fastify + SQLite embutido para o aplicativo desktop (Electron).
 * IMPORTANTE: defina `process.env.DATABASE_PATH` antes de importar este módulo.
 */
export async function startDesktopServer(
  options: StartDesktopServerOptions,
): Promise<DesktopServerHandle> {
  runMigrations(sqlite, options.migrationsDir);
  ensureSeedData(db);

  const app = buildApp({ db, staticDir: options.staticDir });
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;

  await app.listen({ host, port });

  const address = app.server.address() as AddressInfo | null;
  const boundPort = address?.port ?? port;
  const url = `http://${host}:${boundPort}`;

  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await app.close();
    sqlite.close();
  };

  return { url, port: boundPort, stop };
}
