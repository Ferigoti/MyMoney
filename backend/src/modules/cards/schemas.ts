import { z } from 'zod';
import { idSchema, monthSchema, nameSchema } from '../../shared/validation.js';

const daySchema = z.number().int().min(1).max(31);
const limitSchema = z.number().int().nonnegative();

export const createCardSchema = z.strictObject({
  name: nameSchema,
  limitCents: limitSchema,
  closingDay: daySchema,
  dueDay: daySchema,
  paymentAccountId: idSchema.optional(),
});

export const updateCardSchema = z
  .strictObject({
    name: nameSchema.optional(),
    limitCents: limitSchema.optional(),
    limit_cents: limitSchema.optional(),
    closingDay: daySchema.optional(),
    closing_day: daySchema.optional(),
    dueDay: daySchema.optional(),
    due_day: daySchema.optional(),
    paymentAccountId: idSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasField =
      data.name !== undefined ||
      data.limitCents !== undefined ||
      data.limit_cents !== undefined ||
      data.closingDay !== undefined ||
      data.closing_day !== undefined ||
      data.dueDay !== undefined ||
      data.due_day !== undefined ||
      data.paymentAccountId !== undefined;

    if (!hasField) {
      ctx.addIssue({
        code: 'custom',
        path: ['limitCents'],
        message: 'Informe ao menos um campo para atualizar no cartão',
      });
    }
  });

export const cardInvoiceQuerySchema = z.strictObject({
  month: monthSchema,
});

export type CreateCardInput = z.output<typeof createCardSchema>;
export type UpdateCardInput = z.output<typeof updateCardSchema>;
