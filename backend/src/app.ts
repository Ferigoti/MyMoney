import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { db as defaultDb, type DB } from './db/client.js';
import { accountsRoutes } from './modules/accounts/routes.js';
import { cardsRoutes } from './modules/cards/routes.js';
import { categoriesRoutes } from './modules/categories/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { invoicesRoutes } from './modules/invoices/routes.js';
import { recurringRoutes } from './modules/recurring/routes.js';
import { systemRoutes } from './modules/system/routes.js';
import { transactionsRoutes } from './modules/transactions/routes.js';
import { errorHandler, notFoundHandler } from './shared/error-handler.js';

export interface BuildAppOptions {
  db?: DB;
  staticDir?: string;
}

const allowedOrigins = new Set(
  env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // chamadas diretas (curl, testes, same-origin)
  if (allowedOrigins.has('*') || allowedOrigins.has(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function buildApp(options: BuildAppOptions = {}) {
  const db = options.db ?? defaultDb;
  const app = Fastify({ logger: { level: env.LOG_LEVEL } }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(accountsRoutes, { prefix: '/accounts', db });
  app.register(categoriesRoutes, { prefix: '/categories', db });
  app.register(cardsRoutes, { prefix: '/cards', db });
  app.register(invoicesRoutes, { prefix: '/invoices', db });
  app.register(transactionsRoutes, { prefix: '/transactions', db });
  app.register(recurringRoutes, { prefix: '/recurring', db });
  app.register(dashboardRoutes, { prefix: '/dashboard', db });
  app.register(systemRoutes, { prefix: '/system', db });

  const resolvedStaticDir = options.staticDir ?? env.STATIC_DIR;
  if (resolvedStaticDir && fs.existsSync(path.join(resolvedStaticDir, 'index.html'))) {
    app.register(fastifyStatic, {
      root: path.resolve(resolvedStaticDir),
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return notFoundHandler(request, reply);
    });
  }

  return app;
}
