import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { DB } from '../../db/client.js';
import {
  accounts,
  categories,
  creditCards,
  invoices,
  recurringTransactions,
  transactions,
} from '../../db/schema.js';

const backupQuerySchema = z.strictObject({
  format: z.enum(['json', 'sqlite']).optional().default('json'),
});

export const systemRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/backup',
    {
      schema: {
        querystring: backupQuerySchema,
      },
    },
    async (req, reply) => {
      const { format } = req.query;
      const dateStamp = new Date().toISOString().slice(0, 10);

      if (format === 'sqlite') {
        const sqliteClient = (db as unknown as { $client?: Database.Database }).$client;

        try {
          sqliteClient?.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          // Ignora se estiver em memória ou se o checkpoint falhar
        }

        reply
          .header('Content-Type', 'application/x-sqlite3')
          .header(
            'Content-Disposition',
            `attachment; filename="mymoney-backup-${dateStamp}.db"`,
          );

        if (env.DATABASE_PATH !== ':memory:' && fs.existsSync(env.DATABASE_PATH)) {
          return reply.send(fs.createReadStream(env.DATABASE_PATH));
        }

        if (sqliteClient && typeof sqliteClient.serialize === 'function') {
          return reply.send(sqliteClient.serialize());
        }
      }

      const [
        allAccounts,
        allCategories,
        allCards,
        allInvoices,
        allTransactions,
        allRecurring,
      ] = [
        db.select().from(accounts).all(),
        db.select().from(categories).all(),
        db.select().from(creditCards).all(),
        db.select().from(invoices).all(),
        db.select().from(transactions).all(),
        db.select().from(recurringTransactions).all(),
      ];

      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        tables: {
          accounts: allAccounts,
          categories: allCategories,
          creditCards: allCards,
          invoices: allInvoices,
          transactions: allTransactions,
          recurringTransactions: allRecurring,
        },
      };

      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="mymoney-backup-${dateStamp}.json"`,
        )
        .send(payload);
    },
  );
};

