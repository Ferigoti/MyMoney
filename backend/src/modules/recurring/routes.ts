import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DB } from '../../db/client.js';
import { idSchema } from '../../shared/validation.js';
import { createRecurringSchema } from './schemas.js';
import { createRecurringService } from './service.js';

const recurringIdParamsSchema = z.strictObject({
  id: idSchema,
});

export const recurringRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const service = createRecurringService(db);

  typed.get('/', async () => ({
    data: service.list(),
  }));

  typed.post(
    '/',
    {
      schema: {
        body: createRecurringSchema,
      },
    },
    async (req, reply) => reply.status(201).send({ data: service.create(req.body) }),
  );

  typed.delete(
    '/:id',
    {
      schema: {
        params: recurringIdParamsSchema,
      },
    },
    async (req) => ({
      data: service.delete(req.params.id),
    }),
  );
};

