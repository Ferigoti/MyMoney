import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_DATABASE_PATH, PROJECT_ROOT } from './paths.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  DATABASE_PATH: z
    .string()
    .default(DEFAULT_DATABASE_PATH)
    .transform((p) => (p === ':memory:' ? p : path.resolve(PROJECT_ROOT, p))),
});

export type Env = z.infer<typeof envSchema>;

// Fail-fast: variáveis inválidas derrubam o processo na inicialização.
export const env: Env = envSchema.parse(process.env);

