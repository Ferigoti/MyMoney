import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Convenções (ver agents.md):
// - Dinheiro: INTEGER em centavos (nunca float).
// - Datas: TEXT ISO-8601 — 'YYYY-MM-DD' (compras/vencimentos) e 'YYYY-MM' (competência de fatura).
// - IDs: TEXT gerados com crypto.randomUUID().

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

const DATE_GLOB = `'[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`;
const MONTH_GLOB = `'[0-9][0-9][0-9][0-9]-[0-1][0-9]'`;

export const ACCOUNT_TYPES = [
  'CHECKING',
  'CASH',
  'BENEFIT',
  'SAVINGS',
  'checking',
  'savings',
  'cash',
  'benefit',
  'other',
] as const;
export const CATEGORY_KINDS = ['income', 'expense'] as const;
export const TRANSACTION_TYPES = ['income', 'expense'] as const;
export const RECURRING_TYPES = ['EXPENSE', 'INCOME', 'expense', 'income'] as const;
export const RECURRING_SCHEDULE_RULES = [
  'FIXED_DAY',
  'FIFTH_BUSINESS_DAY',
  'FIRST_BUSINESS_DAY',
  'LAST_BUSINESS_DAY',
] as const;
export const INVOICE_STATUSES = ['OPEN', 'CLOSED', 'PAID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type RecurringType = (typeof RECURRING_TYPES)[number];
export type RecurringScheduleRule = (typeof RECURRING_SCHEDULE_RULES)[number];

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------
export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull().default('checking'),
    initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('accounts_name_unique').on(t.name),
    check(
      'accounts_type_check',
      sql.raw(
        `"type" IN ('CHECKING', 'CASH', 'BENEFIT', 'SAVINGS', 'checking', 'savings', 'cash', 'benefit', 'other')`,
      ),
    ),
  ],
);

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------
export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('categories_kind_name_unique').on(t.kind, t.name),
    check('categories_kind_check', sql.raw(`"kind" IN ('income', 'expense')`)),
    check('categories_monthly_budget_check', sql`${t.monthlyBudgetCents} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// credit_cards
// ---------------------------------------------------------------------------
export const creditCards = sqliteTable(
  'credit_cards',
  {
    id: id(),
    name: text('name').notNull(),
    limitCents: integer('limit_cents').notNull(),
    closingDay: integer('closing_day').notNull(),
    dueDay: integer('due_day').notNull(),
    // Conta padrão de onde a fatura é paga. Se a conta for removida, o cartão permanece.
    paymentAccountId: text('payment_account_id').references(() => accounts.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_cards_name_unique').on(t.name),
    index('credit_cards_payment_account_idx').on(t.paymentAccountId),
    check('credit_cards_limit_check', sql`${t.limitCents} >= 0`),
    check('credit_cards_closing_day_check', sql`${t.closingDay} BETWEEN 1 AND 31`),
    check('credit_cards_due_day_check', sql`${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

// ---------------------------------------------------------------------------
// invoices (faturas)
// ---------------------------------------------------------------------------
export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    // Fatura não existe sem cartão: remover o cartão remove suas faturas (e, em cascata, as compras).
    cardId: text('card_id')
      .notNull()
      .references(() => creditCards.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    month: text('month').notNull(), // 'YYYY-MM' (competência)
    closingDate: text('closing_date').notNull(), // 'YYYY-MM-DD'
    dueDate: text('due_date').notNull(), // 'YYYY-MM-DD'
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('OPEN'),
    paidAt: text('paid_at'), // 'YYYY-MM-DD'
    paidFromAccountId: text('paid_from_account_id').references(() => accounts.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Débito gerado na conta ao pagar a fatura. RESTRICT: não se apaga o débito de uma fatura paga.
    paymentTransactionId: text('payment_transaction_id').references((): AnySQLiteColumn => transactions.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_card_month_unique').on(t.cardId, t.month),
    uniqueIndex('invoices_payment_transaction_unique').on(t.paymentTransactionId),
    index('invoices_due_date_idx').on(t.dueDate),
    index('invoices_paid_from_account_idx').on(t.paidFromAccountId),
    check('invoices_month_format_check', sql.raw(`"month" GLOB ${MONTH_GLOB}`)),
    check('invoices_closing_date_format_check', sql.raw(`"closing_date" GLOB ${DATE_GLOB}`)),
    check('invoices_due_date_format_check', sql.raw(`"due_date" GLOB ${DATE_GLOB}`)),
    check('invoices_status_check', sql.raw(`"status" IN ('OPEN', 'CLOSED', 'PAID')`)),
    check(
      'invoices_paid_consistency_check',
      sql`(${t.status} = 'PAID' AND ${t.paidAt} IS NOT NULL) OR (${t.status} <> 'PAID' AND ${t.paidAt} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// recurring_transactions (contas fixas / recorrentes mensais)
// ---------------------------------------------------------------------------
export const recurringTransactions = sqliteTable(
  'recurring_transactions',
  {
    id: id(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    accountId: text('account_id').references(() => accounts.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    cardId: text('card_id').references(() => creditCards.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    type: text('type', { enum: RECURRING_TYPES }).notNull().default('EXPENSE'),
    scheduleRule: text('schedule_rule', { enum: RECURRING_SCHEDULE_RULES })
      .notNull()
      .default('FIXED_DAY'),
    dueDay: integer('due_day').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('recurring_transactions_account_idx').on(t.accountId),
    index('recurring_transactions_card_idx').on(t.cardId),
    index('recurring_transactions_category_idx').on(t.categoryId),
    check('recurring_transactions_amount_positive_check', sql`${t.amountCents} > 0`),
    check(
      'recurring_transactions_target_check',
      sql`(${t.accountId} IS NOT NULL AND ${t.cardId} IS NULL) OR (${t.accountId} IS NULL AND ${t.cardId} IS NOT NULL)`,
    ),
    check(
      'recurring_transactions_type_check',
      sql.raw(`"type" IN ('EXPENSE', 'INCOME', 'expense', 'income')`),
    ),
    check(
      'recurring_transactions_schedule_rule_check',
      sql.raw(
        `"schedule_rule" IN ('FIXED_DAY', 'FIFTH_BUSINESS_DAY', 'FIRST_BUSINESS_DAY', 'LAST_BUSINESS_DAY')`,
      ),
    ),
    check('recurring_transactions_due_day_check', sql`${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------
// Uma transação pertence a EXATAMENTE um destino:
//   - account_id  → conta à vista/boleto (usa is_paid)
//   - invoice_id  → compra no cartão (vinculada à fatura da competência)
export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD'

    // Conta com histórico não pode ser apagada (arquive-a). Evita perda silenciosa de dados.
    accountId: text('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    invoiceId: text('invoice_id').references(() => invoices.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    recurringId: text('recurring_id').references(() => recurringTransactions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    isPaid: integer('is_paid', { mode: 'boolean' }).notNull().default(false),

    // Parcelamento: todas as parcelas de uma compra compartilham o mesmo group_id.
    installmentGroupId: text('installment_group_id'),
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),

    createdAt: createdAt(),
  },
  (t) => [
    index('transactions_date_idx').on(t.date),
    index('transactions_invoice_idx').on(t.invoiceId),
    index('transactions_account_date_idx').on(t.accountId, t.date),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_installment_group_idx').on(t.installmentGroupId),
    index('transactions_recurring_idx').on(t.recurringId),
    check('transactions_amount_positive_check', sql`${t.amountCents} > 0`),
    check('transactions_type_check', sql.raw(`"type" IN ('income', 'expense')`)),
    check('transactions_date_format_check', sql.raw(`"date" GLOB ${DATE_GLOB}`)),
    check(
      'transactions_single_target_check',
      sql`(${t.accountId} IS NOT NULL AND ${t.invoiceId} IS NULL) OR (${t.accountId} IS NULL AND ${t.invoiceId} IS NOT NULL)`,
    ),
    check(
      'transactions_installment_check',
      sql`(${t.installmentGroupId} IS NULL AND ${t.installmentNumber} IS NULL AND ${t.installmentTotal} IS NULL)
        OR (${t.installmentGroupId} IS NOT NULL AND ${t.installmentTotal} >= 1
            AND ${t.installmentNumber} BETWEEN 1 AND ${t.installmentTotal})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------
export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
  creditCards: many(creditCards),
  paidInvoices: many(invoices),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  transactions: many(transactions),
}));

export const creditCardsRelations = relations(creditCards, ({ one, many }) => ({
  paymentAccount: one(accounts, {
    fields: [creditCards.paymentAccountId],
    references: [accounts.id],
  }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  card: one(creditCards, { fields: [invoices.cardId], references: [creditCards.id] }),
  paidFromAccount: one(accounts, {
    fields: [invoices.paidFromAccountId],
    references: [accounts.id],
  }),
  transactions: many(transactions, { relationName: 'invoice_items' }),
  paymentTransaction: one(transactions, {
    fields: [invoices.paymentTransactionId],
    references: [transactions.id],
    relationName: 'invoice_payment',
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  invoice: one(invoices, {
    fields: [transactions.invoiceId],
    references: [invoices.id],
    relationName: 'invoice_items',
  }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  recurring: one(recurringTransactions, {
    fields: [transactions.recurringId],
    references: [recurringTransactions.id],
  }),
}));

export const recurringTransactionsRelations = relations(recurringTransactions, ({ one, many }) => ({
  account: one(accounts, {
    fields: [recurringTransactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [recurringTransactions.categoryId],
    references: [categories.id],
  }),
  transactions: many(transactions),
}));

// ---------------------------------------------------------------------------
// tipos inferidos
// ---------------------------------------------------------------------------
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type CreditCard = typeof creditCards.$inferSelect;
export type NewCreditCard = typeof creditCards.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type RecurringTransaction = typeof recurringTransactions.$inferSelect;
export type NewRecurringTransaction = typeof recurringTransactions.$inferInsert;
