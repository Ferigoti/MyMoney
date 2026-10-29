import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { idParamsSchema } from '../../shared/validation.js';
import {
  createTransactionSchema,
  deleteTransactionQuerySchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './schemas.js';
import { createTransactionsService } from './transactions.service.js';

export const transactionsRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const service = createTransactionsService(db);

  app.get('/', { schema: { querystring: listTransactionsQuerySchema } }, async (request) => ({
    data: service.list(request.query),
  }));

  app.post('/', { schema: { body: createTransactionSchema } }, async (request, reply) =>
    reply.status(201).send({ data: service.create(request.body) }),
  );

  app.put(
    '/:id',
    { schema: { params: idParamsSchema, body: updateTransactionSchema } },
    async (request) => ({
      data: service.update(request.params.id, request.body),
    }),
  );

  app.patch('/:id/toggle-paid', { schema: { params: idParamsSchema } }, async (request) => ({
    data: service.togglePaid(request.params.id),
  }));

  app.delete(
    '/:id',
    { schema: { params: idParamsSchema, querystring: deleteTransactionQuerySchema } },
    async (request) => ({
      data: service.delete(request.params.id, request.query.scope),
    }),
  );
};
