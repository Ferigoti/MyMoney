import { z } from 'zod';
import { monthSchema } from '../../shared/validation.js';

export const dashboardSummaryQuerySchema = z.strictObject({
  month: monthSchema,
});

export type DashboardSummaryQuery = z.output<typeof dashboardSummaryQuerySchema>;

/** Máximo de competências que podem ser analisadas juntas no Planejamento Mensal. */
export const MAX_PLANNING_MONTHS = 24;

/**
 * `GET /dashboard/planning?months=2026-11,2026-12`
 * Aceita uma ou várias competências (`YYYY-MM`) separadas por vírgula.
 * Duplicadas são removidas e o resultado é ordenado cronologicamente.
 */
export const dashboardPlanningQuerySchema = z.strictObject({
  months: z
    .string()
    .transform((raw) =>
      [...new Set(raw.split(',').map((m) => m.trim()).filter(Boolean))].sort(),
    )
    .pipe(
      z
        .array(monthSchema)
        .min(1, 'Selecione ao menos uma competência')
        .max(MAX_PLANNING_MONTHS, `Selecione no máximo ${MAX_PLANNING_MONTHS} competências`),
    ),
});

export type DashboardPlanningQuery = z.input<typeof dashboardPlanningQuerySchema>;

export interface PlanningMonthTotals {
  /** Receitas em contas de movimentação/reserva (sem Vale e sem transferências). */
  incomes_cents: number;
  /** Despesas pagas em conta (débito, Pix, dinheiro, boletos), sem Vale e sem pagamento de fatura. */
  account_expenses_cents: number;
  /** Compras no cartão cuja fatura vence na competência (independente de já estar paga). */
  card_expenses_cents: number;
  /** `account_expenses_cents + card_expenses_cents`. */
  total_expenses_cents: number;
  /** Renda − despesas totais da competência (isolada, sem saldo acumulado). */
  balance_cents: number;
  /** Percentual da renda comprometido com despesas (0 quando não há renda). */
  committed_percentage: number;
  /** Despesas fixas: contas recorrentes e assinaturas. */
  fixed_expenses_cents: number;
  /** Parcelas de compras parceladas. */
  installment_expenses_cents: number;
  /** Demais gastos avulsos. */
  variable_expenses_cents: number;
  /** Vale recebido (contas BENEFIT ou categoria "Vale"), mostrado à parte. */
  benefit_incomes_cents: number;
  /** Gastos pagos com Vale, mostrados à parte. */
  benefit_expenses_cents: number;
}

export interface PlanningMonth extends PlanningMonthTotals {
  month: string;
}

export interface PlanningCategoryRow {
  category_id: string | null;
  category_name: string;
  /** Teto mensal configurado na categoria (0 = sem teto). */
  monthly_budget_cents: number;
  total_cents: number;
  average_cents: number;
  fixed_cents: number;
  installment_cents: number;
  variable_cents: number;
  /** Percentual sobre a renda total do período. */
  income_percentage: number;
  /** Percentual sobre as despesas totais do período. */
  expenses_percentage: number;
  /** Valor por competência (todas as competências selecionadas presentes, inclusive com 0). */
  by_month: Record<string, number>;
}

export interface PlanningIncomeCategoryRow {
  category_id: string | null;
  category_name: string;
  total_cents: number;
  average_cents: number;
  by_month: Record<string, number>;
}

export interface DashboardPlanning {
  months: string[];
  per_month: PlanningMonth[];
  totals: PlanningMonthTotals;
  averages: PlanningMonthTotals;
  expenses_by_category: PlanningCategoryRow[];
  incomes_by_category: PlanningIncomeCategoryRow[];
}

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
    total_expenses_cents: number;
    free_to_spend_cents: number;
  };
  expenses_by_category: DashboardExpenseByCategory[];
  six_months_history: {
    month: string;
    incomes_cents: number;
    expenses_cents: number;
  }[];
}
