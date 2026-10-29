import { z } from 'zod';
import { monthSchema } from '../../shared/validation.js';

export const dashboardSummaryQuerySchema = z.strictObject({
  month: monthSchema,
});

export type DashboardSummaryQuery = z.output<typeof dashboardSummaryQuerySchema>;

export interface DashboardExpenseByCategory {
  category_id: string | null;
  category_name: string;
  total_cents: number;
  percentage: number;
  budget_cents: number;
  spent_cents: number;
  remaining_cents: number;
  usage_percentage: number;
}

export interface DashboardSummary {
  month: string;
  balances: {
    current_balance_cents: number;
    projected_balance_cents: number;
    available_balance_cents: number;
    savings_balance_cents: number;
    benefits_balance_cents: number;
    projected_benefits_balance_cents: number;
    free_to_spend_cents: number;
  };
  month_summary: {
    incomes_cents: number;
    benefits_incomes_cents: number;
    expenses_cents: number;
    credit_card_cents: number;
    free_to_spend_cents: number;
  };
  expenses_by_category: DashboardExpenseByCategory[];
  six_months_history: {
    month: string;
    incomes_cents: number;
    expenses_cents: number;
  }[];
}
