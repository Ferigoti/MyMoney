// ---------------------------------------------------------------------------
// Domínio / Entidades (espelho estrito dos contratos do backend)
// ---------------------------------------------------------------------------

export type AccountType =
  | 'CHECKING'
  | 'CASH'
  | 'BENEFIT'
  | 'SAVINGS'
  | 'checking'
  | 'savings'
  | 'cash'
  | 'benefit'
  | 'other';
export type CategoryKind = 'income' | 'expense';
export type TransactionType = 'income' | 'expense';
export type RecurringType = 'EXPENSE' | 'INCOME' | 'expense' | 'income';
export type RecurringScheduleRule =
  | 'FIXED_DAY'
  | 'FIFTH_BUSINESS_DAY'
  | 'FIRST_BUSINESS_DAY'
  | 'LAST_BUSINESS_DAY';
export type InvoiceStatus = 'OPEN' | 'CLOSED' | 'PAID';
export type DeleteScope = 'single' | 'future';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalanceCents: number;
  isArchived: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  monthlyBudgetCents: number;
  createdAt: string;
}

export interface CreditCard {
  id: string;
  name: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  paymentAccountId: string | null;
  isArchived: boolean;
  createdAt: string;
  /** Retornado em GET /cards */
  usedCents?: number;
  /** Retornado em GET /cards */
  availableCents?: number;
}

export interface Invoice {
  id: string;
  cardId: string;
  /** Competência no formato 'YYYY-MM' */
  month: string;
  /** 'YYYY-MM-DD' */
  closingDate: string;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  status: InvoiceStatus;
  /** 'YYYY-MM-DD' | null */
  paidAt: string | null;
  paidFromAccountId: string | null;
  paymentTransactionId: string | null;
  createdAt: string;
}

export interface Transaction {
  id: string;
  description: string;
  amountCents: number;
  type: TransactionType;
  /** 'YYYY-MM-DD' */
  date: string;
  accountId: string | null;
  invoiceId: string | null;
  categoryId: string | null;
  recurringId?: string | null;
  isPaid: boolean;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  createdAt: string;
}

export interface RecurringTransaction {
  id: string;
  description: string;
  amountCents: number;
  categoryId: string | null;
  accountId: string;
  type: RecurringType;
  scheduleRule?: RecurringScheduleRule;
  dueDay: number;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard / Analytics (GET /dashboard/summary?month=YYYY-MM)
// ---------------------------------------------------------------------------

export interface ExpenseByCategoryItem {
  category_id: string | null;
  category_name: string;
  total_cents: number;
  percentage: number;
  budget_cents: number;
  spent_cents: number;
  remaining_cents: number;
  usage_percentage: number;
}

export interface SixMonthsHistoryItem {
  month: string;
  incomes_cents: number;
  expenses_cents: number;
}

export interface DashboardSummary {
  month: string;
  balances: {
    current_balance_cents: number;
    projected_balance_cents: number;
    available_balance_cents?: number;
    savings_balance_cents?: number;
    benefits_balance_cents?: number;
    projected_benefits_balance_cents?: number;
    free_to_spend_cents?: number;
  };
  month_summary: {
    incomes_cents: number;
    benefits_incomes_cents?: number;
    expenses_cents: number;
    credit_card_cents: number;
    free_to_spend_cents?: number;
  };
  expenses_by_category: ExpenseByCategoryItem[];
  six_months_history: SixMonthsHistoryItem[];
}

// ---------------------------------------------------------------------------
// Envelopes de Resposta e Payloads da API
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
}

export interface CardInvoiceView {
  cardId: string;
  month: string;
  invoice: Invoice | null;
  totalCents: number;
  transactions: Transaction[];
}

export interface CreateTransactionPayload {
  description: string;
  amountCents: number;
  type?: TransactionType;
  date: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  isPaid?: boolean;
  isRecurring?: boolean;
  scheduleRule?: RecurringScheduleRule;
  isInstallment?: boolean;
  installments?: number;
}

export interface UpdateTransactionPayload {
  description?: string;
  amountCents?: number;
  date?: string;
  categoryId?: string | null;
  isPaid?: boolean;
  updateRecurring?: boolean;
}

