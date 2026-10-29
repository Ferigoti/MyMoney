import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db, sqlite } from './db/client.js';
import { runMigrations } from './db/migrator.js';
import { ensureSeedData } from './db/seed.js';

runMigrations(sqlite);
const seeded = ensureSeedData(db);

const app = buildApp({ db });

if (seeded.categoriesInserted > 0 || seeded.accountsInserted > 0) {
  app.log.info(
    seeded,
    'Seed inicial aplicado automaticamente (categorias/conta padrão criadas)',
  );
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} recebido, encerrando...`);
  await app.close();
  sqlite.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  sqlite.close();
  process.exit(1);
}
