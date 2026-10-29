import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Funciona tanto em src/config (tsx) quanto em dist/config (build).
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DEFAULT_DATABASE_PATH = path.join(DATA_DIR, 'finance.db');
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'src', 'db', 'migrations');

