import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DB } from '../../db/client.js';
import { dashboardPlanningQuerySchema, dashboardSummaryQuerySchema } from './schemas.js';
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

  // Planejamento Mensal: uma ou várias competências calculadas de forma isolada
  app.get(
    '/planning',
    { schema: { querystring: dashboardPlanningQuerySchema } },
    async (request) => ({
      data: service.getPlanning({ months: request.query.months.join(',') }),
    }),
  );
};

