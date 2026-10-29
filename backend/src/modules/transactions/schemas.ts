import { z } from 'zod';
import { RECURRING_SCHEDULE_RULES, TRANSACTION_TYPES } from '../../db/schema.js';
import { idSchema, isoDateSchema, monthSchema, positiveCentsSchema } from '../../shared/validation.js';

export const MAX_INSTALLMENTS = 48;

const descriptionSchema = z.string().trim().min(1).max(200);

/** Compra no cartão de crédito. `amountCents` é o valor TOTAL da compra. */
export const createCardPurchaseSchema = z
  .strictObject({
    description: descriptionSchema,
    amountCents: positiveCentsSchema,
    date: isoDateSchema,
    cardId: idSchema,
    categoryId: idSchema.optional(),
    isRecurring: z.boolean().default(false),
    scheduleRule: z.enum(RECURRING_SCHEDULE_RULES).default('FIXED_DAY'),
    isInstallment: z.boolean().default(false),
    installments: z.number().int().min(2).max(MAX_INSTALLMENTS).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isRecurring && data.isInstallment) {
      ctx.addIssue({
        code: 'custom',
        path: ['isRecurring'],
        message: 'Assinatura recorrente no cartão não pode ser parcelada',
      });
    }
    if (data.isInstallment && data.installments === undefined) {
      ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Informe o número de parcelas' });
    }
    if (!data.isInstallment && data.installments !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Parcelas exigem isInstallment = true' });
    }
    if (data.installments !== undefined && data.amountCents < data.installments) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountCents'],
        message: 'Valor insuficiente: cada parcela deve ter ao menos 1 centavo',
      });
    }
  });

/**
 * Transação à vista (débito, dinheiro, boleto). Sempre vinculada a uma conta;
 * `invoiceId` é proibido (strictObject rejeita chaves extras).
 */
export const createAccountTransactionSchema = z.strictObject({
  description: descriptionSchema,
  amountCents: positiveCentsSchema,
  type: z.enum(TRANSACTION_TYPES),
  date: isoDateSchema,
  accountId: idSchema,
  categoryId: idSchema.optional(),
  isPaid: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  scheduleRule: z.enum(RECURRING_SCHEDULE_RULES).default('FIXED_DAY'),
});

/**
 * Schema unificado para `POST /transactions`: aceita transação à vista (`accountId`)
 * OU compra no cartão (`cardId`), mas nunca ambos.
 */
export const createTransactionSchema = z
  .strictObject({
    description: descriptionSchema,
    amountCents: positiveCentsSchema,
    type: z.enum(TRANSACTION_TYPES).optional(),
    date: isoDateSchema,
    accountId: idSchema.optional(),
    cardId: idSchema.optional(),
    categoryId: idSchema.optional(),
    isPaid: z.boolean().optional(),
    isRecurring: z.boolean().default(false),
    scheduleRule: z.enum(RECURRING_SCHEDULE_RULES).default('FIXED_DAY'),
    isInstallment: z.boolean().default(false),
    installments: z.number().int().min(2).max(MAX_INSTALLMENTS).optional(),
  })
  .superRefine((data, ctx) => {
    const hasAccount = data.accountId !== undefined;
    const hasCard = data.cardId !== undefined;

    if (hasAccount === hasCard) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Informe exatamente um destino: accountId (à vista) ou cardId (cartão)',
      });
      return;
    }

    if (hasAccount) {
      if (data.type === undefined) {
        ctx.addIssue({ code: 'custom', path: ['type'], message: 'Transação em conta exige type (income | expense)' });
      }
      if (data.isInstallment || data.installments !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['isInstallment'],
          message: 'Parcelamento só é permitido em compras no cartão',
        });
      }
    } else {
      if (data.type !== undefined && data.type !== 'expense') {
        ctx.addIssue({ code: 'custom', path: ['type'], message: 'Compras no cartão devem ser do tipo expense' });
      }
      if (data.isPaid !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['isPaid'],
          message: 'Compras no cartão são quitadas pelo pagamento da fatura (não use isPaid)',
        });
      }
      if (data.isRecurring && data.isInstallment) {
        ctx.addIssue({
          code: 'custom',
          path: ['isRecurring'],
          message: 'Assinatura recorrente no cartão não pode ser parcelada',
        });
      }
      if (data.isInstallment && data.installments === undefined) {
        ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Informe o número de parcelas' });
      }
      if (!data.isInstallment && data.installments !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Parcelas exigem isInstallment = true' });
      }
      if (data.installments !== undefined && data.amountCents < data.installments) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountCents'],
          message: 'Valor insuficiente: cada parcela deve ter ao menos 1 centavo',
        });
      }
    }
  });

export const listTransactionsQuerySchema = z.strictObject({
  /** Competência 'YYYY-MM' (data da transação em conta OU competência da fatura no cartão). */
  month: monthSchema.optional(),
  status: z.enum(['paid', 'pending']).optional(),
  categoryId: idSchema.optional(),
  accountId: idSchema.optional(),
  cardId: idSchema.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
});

export const DELETE_SCOPES = ['single', 'future'] as const;
export type DeleteScope = (typeof DELETE_SCOPES)[number];

export const deleteTransactionQuerySchema = z.strictObject({
  /** Para parcelas de cartão: 'single' remove só esta; 'future' remove esta e as futuras. */
  scope: z.enum(DELETE_SCOPES).default('single'),
});

/**
 * Atualização de uma transação (`PUT /transactions/:id`).
 * Permite editar descrição, valor em centavos, data e categoria.
 */
export const updateTransactionSchema = z
  .strictObject({
    description: descriptionSchema.optional(),
    amountCents: positiveCentsSchema.optional(),
    amount_cents: positiveCentsSchema.optional(),
    date: isoDateSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    category_id: idSchema.nullable().optional(),
    isPaid: z.boolean().optional(),
    updateRecurring: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasAnyField =
      data.description !== undefined ||
      data.amountCents !== undefined ||
      data.amount_cents !== undefined ||
      data.date !== undefined ||
      data.categoryId !== undefined ||
      data.category_id !== undefined ||
      data.isPaid !== undefined;

    if (!hasAnyField) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Informe ao menos um campo para atualizar',
      });
    }
  });

export type CreateCardPurchaseInput = z.input<typeof createCardPurchaseSchema>;
export type CreateAccountTransactionInput = z.input<typeof createAccountTransactionSchema>;
export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.output<typeof listTransactionsQuerySchema>;
export type DeleteTransactionQuery = z.output<typeof deleteTransactionQuerySchema>;
