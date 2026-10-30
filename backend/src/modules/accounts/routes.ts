import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { idParamsSchema } from '../../shared/validation.js';
import { createAccountSchema, updateAccountSchema } from './schemas.js';
import { createAccountsService } from './service.js';

export const accountsRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const service = createAccountsService(db);

  app.get('/', async () => ({ data: service.list() }));

  app.post('/', { schema: { body: createAccountSchema } }, async (request, reply) =>
    reply.status(201).send({ data: service.create(request.body) }),
  );

  app.put(
    '/:id',
    { schema: { params: idParamsSchema, body: updateAccountSchema } },
    async (request) => ({
      data: service.update(request.params.id, request.body),
    }),
  );

  app.delete('/:id', { schema: { params: idParamsSchema } }, async (request) => ({
    data: service.delete(request.params.id),
  }));
};
