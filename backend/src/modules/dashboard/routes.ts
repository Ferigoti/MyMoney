import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { dashboardSummaryQuerySchema } from './schemas.js';
import { createDashboardService } from './service.js';

export const dashboardRoutes: FastifyPluginAsyncZod<{ db: DB }> = async (app, { db }) => {
  const service = createDashboardService(db);

  app.get(
    '/summary',
    { schema: { querystring: dashboardSummaryQuerySchema } },
    async (request) => ({
      data: service.getSummary(request.query),
    }),
  );
};

