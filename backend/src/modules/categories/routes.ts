import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { idParamsSchema } from '../../shared/validation.js';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './schemas.js';
import { createCategoriesService } from './service.js';

export const categoriesRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const service = createCategoriesService(db);

  app.get('/', { schema: { querystring: listCategoriesQuerySchema } }, async (request) => ({
    data: service.list(request.query),
  }));

  app.post('/', { schema: { body: createCategorySchema } }, async (request, reply) =>
    reply.status(201).send({ data: service.create(request.body) }),
  );

  app.put(
    '/:id',
    { schema: { params: idParamsSchema, body: updateCategorySchema } },
    async (request) => ({
      data: service.update(request.params.id, request.body),
    }),
  );

  app.patch(
    '/:id',
    { schema: { params: idParamsSchema, body: updateCategorySchema } },
    async (request) => ({
      data: service.update(request.params.id, request.body),
    }),
  );
};
