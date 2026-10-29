import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { idParamsSchema } from '../../shared/validation.js';
import { payInvoiceSchema } from './schemas.js';
import { createInvoicesService } from './service.js';

export const invoicesRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const service = createInvoicesService(db);

  app.patch('/:id/pay', { schema: { params: idParamsSchema, body: payInvoiceSchema } }, async (request) => ({
    data: service.payInvoice(request.params.id, request.body),
  }));

  app.patch('/:id/unpay', { schema: { params: idParamsSchema } }, async (request) => ({
    data: service.unpayInvoice(request.params.id),
  }));
};
