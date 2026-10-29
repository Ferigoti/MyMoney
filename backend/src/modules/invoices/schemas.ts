import { z } from 'zod';
import { idSchema, isoDateSchema } from '../../shared/validation.js';

export const payInvoiceSchema = z.strictObject({
  /** Conta de onde sai o dinheiro. */
  accountId: idSchema,
  /** Data do pagamento; padrão: hoje (horário local). */
  paidAt: isoDateSchema.optional(),
});

export type PayInvoiceInput = z.output<typeof payInvoiceSchema>;
