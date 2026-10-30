import { z } from 'zod';
import { ACCOUNT_TYPES } from '../../db/schema.js';
import { nameSchema } from '../../shared/validation.js';

export const createAccountSchema = z.strictObject({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES).default('checking'),
  /** Pode ser negativo (conta iniciando no cheque especial). */
  initialBalanceCents: z.number().int().default(0),
});

export const updateAccountSchema = z
  .strictObject({
    name: nameSchema.optional(),
    type: z.enum(ACCOUNT_TYPES).optional(),
    initialBalanceCents: z.number().int().optional(),
    /** Quando informado, ajusta automaticamente o saldo inicial para que o saldo atual da conta passe a ser exatamente este valor. */
    currentBalanceCents: z.number().int().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Informe ao menos um campo para atualizar a conta',
  });

export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
