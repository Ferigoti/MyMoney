import { z } from 'zod';
import { RECURRING_SCHEDULE_RULES, RECURRING_TYPES } from '../../db/schema.js';
import {
  idSchema,
  nameSchema,
  positiveCentsSchema,
} from '../../shared/validation.js';

const daySchema = z.number().int().min(1).max(31);

export const createRecurringSchema = z
  .strictObject({
    description: nameSchema,
    amountCents: positiveCentsSchema.optional(),
    amount_cents: positiveCentsSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    category_id: idSchema.nullable().optional(),
    accountId: idSchema.optional(),
    account_id: idSchema.optional(),
    type: z.enum(RECURRING_TYPES).default('EXPENSE'),
    scheduleRule: z.enum(RECURRING_SCHEDULE_RULES).optional(),
    schedule_rule: z.enum(RECURRING_SCHEDULE_RULES).optional(),
    dueDay: daySchema.optional(),
    due_day: daySchema.optional(),
    isActive: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.amountCents === undefined && val.amount_cents === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountCents'],
        message: 'Informe amountCents (ou amount_cents) maior que zero.',
      });
    }
    if (val.accountId === undefined && val.account_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Informe accountId (ou account_id).',
      });
    }
    const rule = val.scheduleRule ?? val.schedule_rule ?? 'FIXED_DAY';
    if (rule === 'FIXED_DAY' && val.dueDay === undefined && val.due_day === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueDay'],
        message: 'Informe dueDay (ou due_day) entre 1 e 31.',
      });
    }
  });

export type CreateRecurringInput = z.output<typeof createRecurringSchema>;
