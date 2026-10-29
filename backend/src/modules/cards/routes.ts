import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { idParamsSchema } from '../../shared/validation.js';
import { createInvoicesService } from '../invoices/service.js';
import { cardInvoiceQuerySchema, createCardSchema, updateCardSchema } from './schemas.js';
import { createCardsService } from './service.js';

export const cardsRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const cards = createCardsService(db);
  const invoices = createInvoicesService(db);

  app.get('/', async () => ({ data: cards.list() }));

  app.post('/', { schema: { body: createCardSchema } }, async (request, reply) =>
    reply.status(201).send({ data: cards.create(request.body) }),
  );

  app.put(
    '/:id',
    { schema: { params: idParamsSchema, body: updateCardSchema } },
    async (request) => ({
      data: cards.update(request.params.id, request.body),
    }),
  );

  app.get(
    '/:id/invoices',
    { schema: { params: idParamsSchema, querystring: cardInvoiceQuerySchema } },
    async (request) => ({ data: invoices.getCardInvoice(request.params.id, request.query.month) }),
  );
};
