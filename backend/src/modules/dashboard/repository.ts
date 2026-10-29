import { and, desc, eq, gte, isNotNull, isNull, like, lte, ne, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { accounts, categories, invoices, transactions } from '../../db/schema.js';

/**
 * Exclui transações que representam a quitação de uma fatura de cartão
 * nas métricas de despesas do mês/categoria/histórico (para não duplicar
 * com as compras de cartão já contabilizadas pela fatura).
 * No cálculo de `balances` de caixa, o pagamento da fatura É considerado
 * normalmente pois é uma saída real da conta bancária.
 */
const notInvoicePayment = sql`NOT EXISTS (
  SELECT 1 FROM ${invoices}
  WHERE ${invoices.paymentTransactionId} = ${transactions.id}
)`;

const isMovementAccount = sql`UPPER(${accounts.type}) IN ('CHECKING', 'CASH', 'OTHER')`;
const isSavingsAccount = sql`UPPER(${accounts.type}) = 'SAVINGS'`;
const isBenefitAccount = sql`UPPER(${accounts.type}) = 'BENEFIT'`;
const isValeCategory = sql`LOWER(COALESCE(${categories.name}, '')) = 'vale'`;
const isBenefitTx = sql`(${isBenefitAccount} OR ${isValeCategory})`;
const isMovementTx = sql`(${isMovementAccount} AND NOT ${isValeCategory})`;

export interface BalancesAggregate {
  initialBalanceCents: number;
  paidNetUpToTodayCents: number;
  projectedNetUpToMonthEndCents: number;
  openInvoicesDueUpToMonthEndCents: number;
  savingsBalanceCents: number;
  benefitsBalanceCents: number;
  projectedBenefitsBalanceCents: number;
}

/**
 * Calcula saldos consolidados e segregados por categoria de conta via SQL:
 * - `initialBalanceCents` / `paidNetUpToTodayCents` / `projectedNetUpToMonthEndCents`:
 *   estritamente sobre contas de movimentação (`CHECKING`, `CASH`), sem misturar Vale.
 * - `savingsBalanceCents`: saldo atual consolidado de contas `SAVINGS` (guardado/reserva).
 * - `benefitsBalanceCents`: saldo atual pago de contas `BENEFIT` (VA/VR) ou categoria `Vale`.
 * - `projectedBenefitsBalanceCents`: saldo projetado de `BENEFIT` / `Vale` até o fim do mês selecionado.
 * - `openInvoicesDueUpToMonthEndCents`: total de faturas abertas (status != 'PAID')
 *   cujo vencimento (`due_date`) ocorre até o fim do mês selecionado.
 */
export function queryBalancesAggregate(
  db: DbOrTx,
  monthEndDate: string,
): BalancesAggregate {
  const initRow = db
    .select({
      movementInit: sql<number>`coalesce(sum(case when ${isMovementAccount} then ${accounts.initialBalanceCents} else 0 end), 0)`,
      savingsInit: sql<number>`coalesce(sum(case when ${isSavingsAccount} then ${accounts.initialBalanceCents} else 0 end), 0)`,
      benefitInit: sql<number>`coalesce(sum(case when ${isBenefitAccount} then ${accounts.initialBalanceCents} else 0 end), 0)`,
    })
    .from(accounts)
    .where(eq(accounts.isArchived, false))
    .get();

  const txRow = db
    .select({
      movementPaidNet: sql<number>`coalesce(sum(
        case
          when ${isMovementTx} and ${transactions.isPaid} = 1 then
            case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
          else 0
        end
      ), 0)`,
      movementProjectedNet: sql<number>`coalesce(sum(
        case
          when ${isMovementTx} and (${transactions.isPaid} = 1 or ${transactions.date} <= ${monthEndDate}) then
            case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
          else 0
        end
      ), 0)`,
      savingsPaidNet: sql<number>`coalesce(sum(
        case
          when ${isSavingsAccount} and ${transactions.isPaid} = 1 then
            case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
          else 0
        end
      ), 0)`,
      benefitPaidNet: sql<number>`coalesce(sum(
        case
          when ${isBenefitTx} and ${transactions.isPaid} = 1 then
            case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
          else 0
        end
      ), 0)`,
      benefitProjectedNet: sql<number>`coalesce(sum(
        case
          when ${isBenefitTx} and (${transactions.isPaid} = 1 or ${transactions.date} <= ${monthEndDate}) then
            case when ${transactions.type} = 'income' then ${transactions.amountCents} else -${transactions.amountCents} end
          else 0
        end
      ), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(isNull(transactions.invoiceId), eq(accounts.isArchived, false)))
    .get();

  const openInvRow = db
    .select({
      total: sql<number>`coalesce(sum(
        case when ${transactions.type} = 'expense' then ${transactions.amountCents} else -${transactions.amountCents} end
      ), 0)`,
    })
    .from(transactions)
    .innerJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(and(ne(invoices.status, 'PAID'), lte(invoices.dueDate, monthEndDate)))
    .get();

  const savingsBalanceCents =
    Number(initRow?.savingsInit ?? 0) + Number(txRow?.savingsPaidNet ?? 0);
  const benefitsBalanceCents =
    Number(initRow?.benefitInit ?? 0) + Number(txRow?.benefitPaidNet ?? 0);
  const projectedBenefitsBalanceCents =
    Number(initRow?.benefitInit ?? 0) + Number(txRow?.benefitProjectedNet ?? 0);

  return {
    initialBalanceCents: Number(initRow?.movementInit ?? 0),
    paidNetUpToTodayCents: Number(txRow?.movementPaidNet ?? 0),
    projectedNetUpToMonthEndCents: Number(txRow?.movementProjectedNet ?? 0),
    openInvoicesDueUpToMonthEndCents: Number(openInvRow?.total ?? 0),
    savingsBalanceCents,
    benefitsBalanceCents,
    projectedBenefitsBalanceCents,
  };
}

export interface MonthSummaryAggregate {
  incomesCents: number;
  benefitsIncomesCents: number;
  expensesCents: number;
  creditCardCents: number;
}

/**
 * Resumo do mês selecionado (`YYYY-MM`) estritamente para contas de movimentação (`CHECKING`/`CASH`):
 * - `incomesCents`: receitas em contas de movimentação naquele mês (`date LIKE 'YYYY-MM-%'`), sem Vale.
 * - `benefitsIncomesCents`: receitas de Vale / contas `BENEFIT` naquele mês (`date LIKE 'YYYY-MM-%'`).
 * - `expensesCents`: despesas à vista/boletos em contas de movimentação naquele mês (pagas e a pagar),
 *   excluindo lançamentos de pagamento de fatura para não duplicar com `creditCardCents`.
 * - `creditCardCents`: total consolidado de faturas abertas (`status != 'PAID'`)
 *   com vencimento no mês (`due_date LIKE 'YYYY-MM-%'`) ou competência no mês.
 */
export function queryMonthSummaryAggregate(db: DbOrTx, month: string): MonthSummaryAggregate {
  const monthPrefix = `${month}-%`;

  const accountRow = db
    .select({
      incomes: sql<number>`coalesce(sum(case when ${isMovementTx} and ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end), 0)`,
      benefitsIncomes: sql<number>`coalesce(sum(case when ${isBenefitTx} and ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end), 0)`,
      expenses: sql<number>`coalesce(sum(case when ${isMovementTx} and ${transactions.type} = 'expense' then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        isNull(transactions.invoiceId),
        eq(accounts.isArchived, false),
        like(transactions.date, monthPrefix),
        notInvoicePayment,
      ),
    )
    .get();

  // Faturas abertas com vencimento no mês (ou competência `month` caso o vencimento caia no próprio mês).
  const cardRow = db
    .select({
      total: sql<number>`coalesce(sum(
        case when ${transactions.type} = 'expense' then ${transactions.amountCents} else -${transactions.amountCents} end
      ), 0)`,
    })
    .from(transactions)
    .innerJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        ne(invoices.status, 'PAID'),
        or(like(invoices.dueDate, monthPrefix), eq(invoices.month, month)),
      ),
    )
    .get();

  return {
    incomesCents: Number(accountRow?.incomes ?? 0),
    benefitsIncomesCents: Number(accountRow?.benefitsIncomes ?? 0),
    expensesCents: Number(accountRow?.expenses ?? 0),
    creditCardCents: Number(cardRow?.total ?? 0),
  };
}

export interface CategoryExpenseRow {
  categoryId: string | null;
  categoryName: string;
  budgetCents: number;
  totalCents: number;
}

/**
 * Agrupa via SQL (`GROUP BY category_id`) todas as despesas da competência `month`
 * (despesas em conta com `date LIKE 'YYYY-MM-%'` + compras no cartão cuja fatura
 * tem competência `month`), ordenando do maior para o menor valor.
 */
export function queryExpensesByCategory(db: DbOrTx, month: string): CategoryExpenseRow[] {
  const monthPrefix = `${month}-%`;
  const totalExpr = sql<number>`coalesce(sum(${transactions.amountCents}), 0)`;

  const rows = db
    .select({
      categoryId: transactions.categoryId,
      categoryName: sql<string>`coalesce(${categories.name}, 'Sem categoria')`,
      budgetCents: sql<number>`coalesce(${categories.monthlyBudgetCents}, 0)`,
      totalCents: totalExpr,
    })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.type, 'expense'),
        notInvoicePayment,
        or(
          and(isNull(transactions.invoiceId), like(transactions.date, monthPrefix)),
          and(isNotNull(transactions.invoiceId), eq(invoices.month, month)),
        ),
      ),
    )
    .groupBy(transactions.categoryId, categories.name, categories.monthlyBudgetCents)
    .orderBy(desc(totalExpr))
    .all();

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    budgetCents: Number(r.budgetCents),
    totalCents: Number(r.totalCents),
  }));
}

export interface MonthHistoryRow {
  month: string;
  incomesCents: number;
  expensesCents: number;
}

/**
 * Agrega em uma única query SQL (`GROUP BY effective_month`) as receitas e despesas
 * do intervalo `[startMonth, endMonth]` (formato `YYYY-MM`).
 * Para transações em conta, o mês efetivo é `substr(date, 1, 7)`;
 * para compras de cartão, é a competência da fatura (`invoices.month`).
 */
export function queryHistoryByMonthRange(
  db: DbOrTx,
  startMonth: string,
  endMonth: string,
): Map<string, MonthHistoryRow> {
  const effectiveMonth = sql<string>` coalesce(${invoices.month}, substr(${transactions.date}, 1, 7))`;

  const rows = db
    .select({
      month: effectiveMonth,
      incomesCents: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end), 0)`,
      expensesCents: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .where(
      and(
        notInvoicePayment,
        gte(effectiveMonth, startMonth),
        lte(effectiveMonth, endMonth),
      ),
    )
    .groupBy(effectiveMonth)
    .all();

  return new Map(
    rows.map((r) => [
      r.month,
      {
        month: r.month,
        incomesCents: Number(r.incomesCents),
        expensesCents: Number(r.expensesCents),
      },
    ]),
  );
}

