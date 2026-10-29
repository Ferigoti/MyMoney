import { z } from 'zod';
import { CATEGORY_KINDS } from '../../db/schema.js';

const budgetCentsSchema = z.number().int().nonnegative();

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(CATEGORY_KINDS),
  monthlyBudgetCents: budgetCentsSchema.optional(),
  monthly_budget_cents: budgetCentsSchema.optional(),
});

export const updateCategorySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(60).optional(),
    monthlyBudgetCents: budgetCentsSchema.optional(),
    monthly_budget_cents: budgetCentsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.name === undefined &&
      data.monthlyBudgetCents === undefined &&
      data.monthly_budget_cents === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['monthlyBudgetCents'],
        message: 'Informe ao menos um campo para atualizar (name ou monthly_budget_cents)',
      });
    }
  });

export const listCategoriesQuerySchema = z.strictObject({
  kind: z.enum(CATEGORY_KINDS).optional(),
});

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.output<typeof listCategoriesQuerySchema>;
