import axios from 'axios';
import type {
  Account,
  AccountType,
  ApiResponse,
  CardInvoiceView,
  Category,
  CreateTransactionPayload,
  CreditCard,
  DashboardSummary,
  DeleteScope,
  Invoice,
  RecurringTransaction,
  RecurringType,
  Transaction,
  UpdateTransactionPayload,
} from '../types';

export const API_BASE_URL =
  import.meta.env.VITE_API_URL?.toString().trim() || 'http://localhost:3333';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ---------------------------------------------------------------------------
// Chamadas tipadas da API
// ---------------------------------------------------------------------------

export async function fetchDashboardSummary(month: string): Promise<DashboardSummary> {
  const { data } = await api.get<ApiResponse<DashboardSummary>>('/dashboard/summary', {
    params: { month },
  });
  return data.data;
}

export async function fetchTransactions(params?: {
  month?: string;
  status?: 'paid' | 'pending';
  categoryId?: string;
  accountId?: string;
  cardId?: string;
}): Promise<Transaction[]> {
  const { data } = await api.get<ApiResponse<Transaction[]>>('/transactions', { params });
  return data.data;
}

export async function createTransaction(payload: CreateTransactionPayload): Promise<Transaction[]> {
  const { data } = await api.post<ApiResponse<Transaction[]>>('/transactions', payload);
  return data.data;
}

export async function updateTransaction(
  id: string,
  payload: UpdateTransactionPayload,
): Promise<Transaction> {
  const { data } = await api.put<ApiResponse<Transaction>>(`/transactions/${id}`, payload);
  return data.data;
}

export async function createCreditCard(payload: {
  name: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  paymentAccountId?: string;
}): Promise<CreditCard> {
  const { data } = await api.post<ApiResponse<CreditCard>>('/cards', payload);
  return data.data;
}

export async function toggleTransactionPaid(id: string): Promise<Transaction> {
  const { data } = await api.patch<ApiResponse<Transaction>>(`/transactions/${id}/toggle-paid`);
  return data.data;
}

export async function deleteTransaction(
  id: string,
  scope: DeleteScope = 'single',
): Promise<{ deletedIds: string[]; deletedCount: number }> {
  const { data } = await api.delete<ApiResponse<{ deletedIds: string[]; deletedCount: number }>>(
    `/transactions/${id}`,
    { params: { scope } },
  );
  return data.data;
}

export async function fetchCategories(): Promise<Category[]> {
  const { data } = await api.get<ApiResponse<Category[]>>('/categories');
  return data.data;
}

export async function updateCategoryBudget(
  categoryId: string,
  monthlyBudgetCents: number,
): Promise<Category> {
  const { data } = await api.patch<ApiResponse<Category>>(`/categories/${categoryId}`, {
    monthly_budget_cents: monthlyBudgetCents,
  });
  return data.data;
}

export async function createCategory(payload: {
  name: string;
  kind: 'income' | 'expense';
  monthlyBudgetCents?: number;
}): Promise<Category> {
  const { data } = await api.post<ApiResponse<Category>>('/categories', payload);
  return data.data;
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data } = await api.get<ApiResponse<Account[]>>('/accounts');
  return data.data;
}

export async function createAccount(payload: {
  name: string;
  type: AccountType;
  initialBalanceCents: number;
}): Promise<Account> {
  const { data } = await api.post<ApiResponse<Account>>('/accounts', payload);
  return data.data;
}

export async function deleteAccount(id: string): Promise<{ deletedId: string }> {
  const { data } = await api.delete<ApiResponse<{ deletedId: string }>>(`/accounts/${id}`);
  return data.data;
}

export async function fetchRecurringTransactions(): Promise<RecurringTransaction[]> {
  const { data } = await api.get<ApiResponse<RecurringTransaction[]>>('/recurring');
  return data.data;
}

export async function createRecurringTransaction(payload: {
  description: string;
  amountCents: number;
  categoryId?: string | null;
  accountId: string;
  type: RecurringType;
  dueDay: number;
  isActive?: boolean;
}): Promise<RecurringTransaction> {
  const { data } = await api.post<ApiResponse<RecurringTransaction>>('/recurring', payload);
  return data.data;
}

export async function deleteRecurringTransaction(id: string): Promise<{ deletedId: string }> {
  const { data } = await api.delete<ApiResponse<{ deletedId: string }>>(`/recurring/${id}`);
  return data.data;
}

export async function fetchCards(): Promise<CreditCard[]> {
  const { data } = await api.get<ApiResponse<CreditCard[]>>('/cards');
  return data.data;
}

export async function updateCreditCard(
  id: string,
  payload: {
    name?: string;
    limitCents?: number;
    closingDay?: number;
    dueDay?: number;
    paymentAccountId?: string | null;
  },
): Promise<CreditCard> {
  const { data } = await api.put<ApiResponse<CreditCard>>(`/cards/${id}`, payload);
  return data.data;
}

export async function downloadDatabaseBackup(format: 'json' | 'sqlite' = 'sqlite'): Promise<void> {
  const response = await api.get('/system/backup', {
    params: { format },
    responseType: 'blob',
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const ext = format === 'sqlite' ? 'db' : 'json';
  const filename = `mymoney-backup-${dateStamp}.${ext}`;

  const blob = new Blob([response.data], {
    type: format === 'sqlite' ? 'application/x-sqlite3' : 'application/json',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function fetchCardInvoice(cardId: string, month: string): Promise<CardInvoiceView> {
  const { data } = await api.get<ApiResponse<CardInvoiceView>>(`/cards/${cardId}/invoices`, {
    params: { month },
  });
  return data.data;
}

export async function payInvoice(
  invoiceId: string,
  payload: { accountId: string; paidAt?: string },
): Promise<{ invoice: Invoice; paymentTransaction: Transaction }> {
  const { data } = await api.patch<
    ApiResponse<{ invoice: Invoice; paymentTransaction: Transaction }>
  >(`/invoices/${invoiceId}/pay`, payload);
  return data.data;
}

export async function unpayInvoice(
  invoiceId: string,
): Promise<{ invoice: Invoice; deletedPaymentTransactionId: string | null }> {
  const { data } = await api.patch<
    ApiResponse<{ invoice: Invoice; deletedPaymentTransactionId: string | null }>
  >(`/invoices/${invoiceId}/unpay`);
  return data.data;
}


