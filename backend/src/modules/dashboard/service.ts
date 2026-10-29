import type { DB } from '../../db/client.js';
import { materializeRecurringForMonth } from '../recurring/service.js';
import { addMonths, daysInMonth } from '../transactions/transactions.service.js';
import {
  queryBalancesAggregate,
  queryExpensesByCategory,
  queryHistoryByMonthRange,
  queryMonthSummaryAggregate,
} from './repository.js';
import {
  dashboardSummaryQuerySchema,
  type DashboardSummary,
  type DashboardSummaryQuery,
} from './schemas.js';

function lastDayOfMonthIso(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = String(daysInMonth(y, m)).padStart(2, '0');
  return `${month}-${lastDay}`;
}

export function createDashboardService(db: DB) {
  return {
    getSummary(rawQuery: DashboardSummaryQuery): DashboardSummary {
      const { month } = dashboardSummaryQuerySchema.parse(rawQuery);
      db.transaction((tx) => {
        materializeRecurringForMonth(tx, month);
      });
      const monthEndDate = lastDayOfMonthIso(month);

      // 1) Balances (saldo real atual vs. saldo projetado ao fim do mês selecionado e saldos segregados)
      const balancesAgg = queryBalancesAggregate(db, monthEndDate);
      const availableBalanceCents =
        balancesAgg.initialBalanceCents + balancesAgg.paidNetUpToTodayCents;
      const currentBalanceCents = availableBalanceCents;
      const projectedBalanceCents =
        balancesAgg.initialBalanceCents +
        balancesAgg.projectedNetUpToMonthEndCents -
        balancesAgg.openInvoicesDueUpToMonthEndCents;

      // 2) Month Summary (receitas, despesas à vista/boletos e faturas abertas do mês estritamente sobre CHECKING/CASH)
      const summaryAgg = queryMonthSummaryAggregate(db, month);
      const freeToSpendCents =
        summaryAgg.incomesCents - (summaryAgg.expensesCents + summaryAgg.creditCardCents);

      // 3) Expenses by Category (com percentual do total e métricas de orçamento/teto)
      const categoryRows = queryExpensesByCategory(db, month);
      const totalCategoryExpenses = categoryRows.reduce((acc, r) => acc + r.totalCents, 0);
      const expensesByCategory = categoryRows.map((r) => {
        const budgetCents = r.budgetCents;
        const spentCents = r.totalCents;
        const remainingCents = budgetCents > 0 ? budgetCents - spentCents : 0;
        const usagePercentage =
          budgetCents > 0 ? Math.round((spentCents * 10000) / budgetCents) / 100 : 0;

        return {
          category_id: r.categoryId,
          category_name: r.categoryName,
          total_cents: r.totalCents,
          percentage:
            totalCategoryExpenses > 0
              ? Math.round((r.totalCents * 10000) / totalCategoryExpenses) / 100
              : 0,
          budget_cents: budgetCents,
          spent_cents: spentCents,
          remaining_cents: remainingCents,
          usage_percentage: usagePercentage,
        };
      });

      // 4) Six Months History (de month - 5 até month, sempre com 6 posições ordenadas)
      const monthsWindow = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
      const startMonth = monthsWindow[0]!;
      const historyMap = queryHistoryByMonthRange(db, startMonth, month);
      const sixMonthsHistory = monthsWindow.map((m) => {
        const found = historyMap.get(m);
        return {
          month: m,
          incomes_cents: found?.incomesCents ?? 0,
          expenses_cents: found?.expensesCents ?? 0,
        };
      });

      return {
        month,
        balances: {
          current_balance_cents: currentBalanceCents,
          projected_balance_cents: projectedBalanceCents,
          available_balance_cents: availableBalanceCents,
          savings_balance_cents: balancesAgg.savingsBalanceCents,
          benefits_balance_cents: balancesAgg.benefitsBalanceCents,
          projected_benefits_balance_cents: balancesAgg.projectedBenefitsBalanceCents,
          free_to_spend_cents: freeToSpendCents,
        },
        month_summary: {
          incomes_cents: summaryAgg.incomesCents,
          benefits_incomes_cents: summaryAgg.benefitsIncomesCents,
          expenses_cents: summaryAgg.expensesCents,
          credit_card_cents: summaryAgg.creditCardCents,
          free_to_spend_cents: freeToSpendCents,
        },
        expenses_by_category: expensesByCategory,
        six_months_history: sixMonthsHistory,
      };
    },
  };
}

