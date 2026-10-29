import { env } from '../config/env.js';
import { sqlite } from './client.js';
import { runMigrations } from './migrator.js';

try {
  runMigrations(sqlite);
  console.log(`Migrations aplicadas em ${env.DATABASE_PATH}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
