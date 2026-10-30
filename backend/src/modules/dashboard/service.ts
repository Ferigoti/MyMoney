import type { DB } from '../../db/client.js';
import { materializeRecurringForMonth } from '../recurring/service.js';
import { addMonths, daysInMonth } from '../transactions/transactions.service.js';
import {
  queryBalancesAggregate,
  queryExpensesByCategory,
  queryHistoryByMonthRange,
  queryMonthSummaryAggregate,
  queryPlanningRows,
} from './repository.js';
import {
  dashboardPlanningQuerySchema,
  dashboardSummaryQuerySchema,
  type DashboardPlanning,
  type DashboardPlanningQuery,
  type DashboardSummary,
  type DashboardSummaryQuery,
  type PlanningCategoryRow,
  type PlanningIncomeCategoryRow,
  type PlanningMonthTotals,
} from './schemas.js';

function lastDayOfMonthIso(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = String(daysInMonth(y, m)).padStart(2, '0');
  return `${month}-${lastDay}`;
}

function percentage(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 10000) / whole) / 100 : 0;
}

function emptyTotals(): PlanningMonthTotals {
  return {
    incomes_cents: 0,
    account_expenses_cents: 0,
    card_expenses_cents: 0,
    total_expenses_cents: 0,
    balance_cents: 0,
    committed_percentage: 0,
    fixed_expenses_cents: 0,
    installment_expenses_cents: 0,
    variable_expenses_cents: 0,
    benefit_incomes_cents: 0,
    benefit_expenses_cents: 0,
  };
}

/** Recalcula os campos derivados (total, sobra e % comprometido) a partir dos campos base. */
function finalizeTotals(t: PlanningMonthTotals): PlanningMonthTotals {
  const total = t.account_expenses_cents + t.card_expenses_cents;
  return {
    ...t,
    total_expenses_cents: total,
    balance_cents: t.incomes_cents - total,
    committed_percentage: percentage(total, t.incomes_cents),
  };
}

const SUMMABLE_KEYS = [
  'incomes_cents',
  'account_expenses_cents',
  'card_expenses_cents',
  'fixed_expenses_cents',
  'installment_expenses_cents',
  'variable_expenses_cents',
  'benefit_incomes_cents',
  'benefit_expenses_cents',
] as const satisfies readonly (keyof PlanningMonthTotals)[];

export function createDashboardService(db: DB) {
  return {
    getSummary(rawQuery: DashboardSummaryQuery): DashboardSummary {
      const { month } = dashboardSummaryQuerySchema.parse(rawQuery);
      db.transaction((tx) => {
        materializeRecurringForMonth(tx, addMonths(month, -1));
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

      // 2) Month Summary (visão isolada da competência: receitas, despesas em conta e faturas de cartão com vencimento no mês)
      const summaryAgg = queryMonthSummaryAggregate(db, month);
      const totalExpensesCents = summaryAgg.expensesCents + summaryAgg.creditCardCents;
      const freeToSpendCents = summaryAgg.incomesCents - totalExpensesCents;

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
          total_expenses_cents: totalExpensesCents,
          free_to_spend_cents: freeToSpendCents,
        },
        expenses_by_category: expensesByCategory,
        six_months_history: sixMonthsHistory,
      };
    },

    /**
     * Planejamento Mensal: calcula cada competência de forma ISOLADA (renda × despesas
     * apenas daquele mês, sem saldo acumulado de meses anteriores) e consolida o período
     * selecionado com totais, médias e distribuição por categoria.
     */
    getPlanning(rawQuery: DashboardPlanningQuery): DashboardPlanning {
      const { months } = dashboardPlanningQuerySchema.parse(rawQuery);

      // Garante que contas recorrentes e assinaturas existam nas competências analisadas.
      // A competência anterior também é materializada porque assinaturas de cartão
      // podem cair em uma fatura que vence no mês seguinte.
      db.transaction((tx) => {
        const toMaterialize = new Set<string>();
        for (const m of months) {
          toMaterialize.add(addMonths(m, -1));
          toMaterialize.add(m);
        }
        for (const m of [...toMaterialize].sort()) materializeRecurringForMonth(tx, m);
      });

      const rows = queryPlanningRows(db, months);

      const perMonthMap = new Map<string, PlanningMonthTotals>(
        months.map((m) => [m, emptyTotals()]),
      );
      const zeroByMonth = () => Object.fromEntries(months.map((m) => [m, 0])) as Record<string, number>;

      type ExpenseAcc = Omit<PlanningCategoryRow, 'average_cents' | 'income_percentage' | 'expenses_percentage'>;
      const expenseCats = new Map<string, ExpenseAcc>();
      const incomeCats = new Map<string, Omit<PlanningIncomeCategoryRow, 'average_cents'>>();

      for (const r of rows) {
        const t = perMonthMap.get(r.month);
        if (!t) continue;
        const key = r.categoryId ?? '__none__';

        if (r.isBenefit) {
          if (r.type === 'income') t.benefit_incomes_cents += r.amountCents;
          else t.benefit_expenses_cents += r.amountCents;
          continue;
        }

        if (r.type === 'income') {
          if (r.isCard) {
            // Estorno/crédito na fatura: abate do gasto no cartão
            t.card_expenses_cents -= r.amountCents;
            t.variable_expenses_cents -= r.amountCents;
            continue;
          }
          t.incomes_cents += r.amountCents;
          const inc = incomeCats.get(key) ?? {
            category_id: r.categoryId,
            category_name: r.categoryName,
            total_cents: 0,
            by_month: zeroByMonth(),
          };
          inc.total_cents += r.amountCents;
          inc.by_month[r.month] = (inc.by_month[r.month] ?? 0) + r.amountCents;
          incomeCats.set(key, inc);
          continue;
        }

        if (r.isCard) t.card_expenses_cents += r.amountCents;
        else t.account_expenses_cents += r.amountCents;

        const exp = expenseCats.get(key) ?? {
          category_id: r.categoryId,
          category_name: r.categoryName,
          monthly_budget_cents: r.monthlyBudgetCents,
          total_cents: 0,
          fixed_cents: 0,
          installment_cents: 0,
          variable_cents: 0,
          by_month: zeroByMonth(),
        };
        exp.total_cents += r.amountCents;
        exp.by_month[r.month] = (exp.by_month[r.month] ?? 0) + r.amountCents;

        if (r.isRecurring) {
          t.fixed_expenses_cents += r.amountCents;
          exp.fixed_cents += r.amountCents;
        } else if (r.isInstallment) {
          t.installment_expenses_cents += r.amountCents;
          exp.installment_cents += r.amountCents;
        } else {
          t.variable_expenses_cents += r.amountCents;
          exp.variable_cents += r.amountCents;
        }
        expenseCats.set(key, exp);
      }

      const perMonth = months.map((m) => ({ month: m, ...finalizeTotals(perMonthMap.get(m)!) }));

      const totalsBase = emptyTotals();
      for (const pm of perMonth) {
        for (const k of SUMMABLE_KEYS) totalsBase[k] += pm[k];
      }
      const totals = finalizeTotals(totalsBase);

      const count = months.length;
      const averagesBase = emptyTotals();
      for (const k of SUMMABLE_KEYS) averagesBase[k] = Math.round(totals[k] / count);
      const averages = finalizeTotals(averagesBase);

      const expensesByCategory: PlanningCategoryRow[] = [...expenseCats.values()]
        .map((c) => ({
          ...c,
          average_cents: Math.round(c.total_cents / count),
          income_percentage: percentage(c.total_cents, totals.incomes_cents),
          expenses_percentage: percentage(c.total_cents, totals.total_expenses_cents),
        }))
        .sort((a, b) => b.total_cents - a.total_cents);

      const incomesByCategory: PlanningIncomeCategoryRow[] = [...incomeCats.values()]
        .map((c) => ({ ...c, average_cents: Math.round(c.total_cents / count) }))
        .sort((a, b) => b.total_cents - a.total_cents);

      return {
        months,
        per_month: perMonth,
        totals,
        averages,
        expenses_by_category: expensesByCategory,
        incomes_by_category: incomesByCategory,
      };
    },
  };
}

