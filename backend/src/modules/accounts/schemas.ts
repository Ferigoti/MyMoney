import { z } from 'zod';
import { ACCOUNT_TYPES } from '../../db/schema.js';
import { nameSchema } from '../../shared/validation.js';

export const createAccountSchema = z.strictObject({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES).default('checking'),
  /** Pode ser negativo (conta iniciando no cheque especial). */
  initialBalanceCents: z.number().int().default(0),
});

export type CreateAccountInput = z.output<typeof createAccountSchema>;
