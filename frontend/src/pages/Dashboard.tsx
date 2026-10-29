import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard as CreditCardIcon,
  LayoutDashboard,
  ListFilter,
  PiggyBank,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Settings as SettingsIcon,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TransactionModal } from '../components/TransactionModal';
import { Budgets } from './Budgets';
import { Cards } from './Cards';
import { Settings } from './Settings';
import { Transactions } from './Transactions';
import {
  fetchAccounts,
  fetchCards,
  fetchCategories,
  fetchDashboardSummary,
  fetchTransactions,
  toggleTransactionPaid,
} from '../services/api';
import type {
  Account,
  Category,
  CreditCard,
  DashboardSummary,
  Transaction,
} from '../types';
import {
  applyTheme,
  formatCurrency,
  formatIsoDate,
  formatMonthLabel,
  getCurrentYearMonth,
  getStoredTheme,
  getTodayIsoDate,
  shiftYearMonth,
  type AppTheme,
} from '../utils/formatters';

const DONUT_COLORS_LIGHT = [
  '#2563eb', // blue-600
  '#0d9488', // teal-600
  '#7c3aed', // violet-600
  '#d97706', // amber-600
  '#e11d48', // rose-600
  '#059669', // emerald-600
  '#4f46e5', // indigo-600
  '#0284c7', // sky-600
];

const DONUT_COLORS_DARK = [
  '#60a5fa', // blue-400
  '#2dd4bf', // teal-400
  '#a78bfa', // violet-400
  '#fbbf24', // amber-400
  '#fb7185', // rose-400
  '#34d399', // emerald-400
  '#818cf8', // indigo-400
  '#38bdf8', // sky-400
];

export function Dashboard() {
  const [activeView, setActiveView] = useState<
    'overview' | 'transactions' | 'cards' | 'budgets' | 'settings'
  >('overview');
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentYearMonth());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextMonthTransactions, setNextMonthTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isDark = theme === 'dark';
  const donutColors = isDark ? DONUT_COLORS_DARK : DONUT_COLORS_LIGHT;

  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleThemeChange = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  const fetchAllForMonth = useCallback(async (month: string) => {
    // Busca primeiro as transações do mês e do próximo mês para materializar recorrências e assinaturas futuras
    const nextMonth = shiftYearMonth(month, 1);
    const [txList, nextTxList] = await Promise.all([
      fetchTransactions({ month }),
      fetchTransactions({ month: nextMonth }),
    ]);
    const [summaryData, catList, accList, cardList] = await Promise.all([
      fetchDashboardSummary(month),
      fetchCategories(),
      fetchAccounts(),
      fetchCards(),
    ]);
    return { summaryData, txList, nextTxList, catList, accList, cardList };
  }, []);

  const loadDashboardData = useCallback(
    async (month: string) => {
      setLoading(true);
      setError(null);
      try {
        const { summaryData, txList, nextTxList, catList, accList, cardList } =
          await fetchAllForMonth(month);
        setSummary(summaryData);
        setTransactions(txList);
        setNextMonthTransactions(nextTxList);
        setCategories(catList);
        setAccounts(accList);
        setCards(cardList);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Não foi possível conectar ao servidor em http://localhost:3333.';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [fetchAllForMonth],
  );

  useEffect(() => {
    let cancelled = false;

    fetchAllForMonth(selectedMonth)
      .then(({ summaryData, txList, nextTxList, catList, accList, cardList }) => {
        if (cancelled) return;
        setSummary(summaryData);
        setTransactions(txList);
        setNextMonthTransactions(nextTxList);
        setCategories(catList);
        setAccounts(accList);
        setCards(cardList);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Não foi possível conectar ao servidor em http://localhost:3333.';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMonth, fetchAllForMonth]);

  const changeMonth = (nextMonth: string) => {
    if (!nextMonth || nextMonth === selectedMonth) return;
    setLoading(true);
    setSelectedMonth(nextMonth);
  };

  const handleTogglePaid = async (tx: Transaction) => {
    if (tx.invoiceId !== null || togglingId) return;
    setTogglingId(tx.id);
    try {
      await toggleTransactionPaid(tx.id);
      await loadDashboardData(selectedMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar status da transação.');
    } finally {
      setTogglingId(null);
    }
  };

  const barChartData = useMemo(() => {
    if (!summary) return [];
    return summary.six_months_history.map((item) => ({
      monthLabel: formatMonthLabel(item.month, 'short'),
      incomesCents: item.incomes_cents,
      expensesCents: item.expenses_cents,
    }));
  }, [summary]);

  const totalCategoryExpensesCents = useMemo(() => {
    if (!summary) return 0;
    return summary.expenses_by_category.reduce((acc, item) => acc + item.total_cents, 0);
  }, [summary]);

  const todayIso = getTodayIsoDate();

  // Transações em conta (débito, Pix, dinheiro, boletos e pagamentos de fatura — exclui compras de cartão)
  const accountTransactions = useMemo(
    () => transactions.filter((tx) => tx.invoiceId === null),
    [transactions],
  );

  // Seleciona os lançamentos futuros do próximo mês em conta (receitas/despesas recorrentes e agendados avulsos)
  const upcomingFutureTransactions = useMemo(() => {
    const currentIds = new Set(accountTransactions.map((t) => t.id));
    const currentFutureRecurringIds = new Set(
      accountTransactions
        .filter((t) => t.recurringId && t.date > todayIso && !t.isPaid)
        .map((t) => t.recurringId),
    );

    return nextMonthTransactions.filter((tx) => {
      if (tx.invoiceId !== null) return false;
      if (currentIds.has(tx.id)) return false;
      if (tx.installmentGroupId !== null) return false;
      if (tx.recurringId && currentFutureRecurringIds.has(tx.recurringId)) return false;
      return Boolean(tx.recurringId) || tx.date > todayIso;
    });
  }, [accountTransactions, nextMonthTransactions, todayIso]);

  // Ordena priorizando pendências do mês (próximos vencimentos), lançamentos futuros recorrentes e depois mais recentes
  const sortedTransactions = useMemo(() => {
    return [...accountTransactions, ...upcomingFutureTransactions]
      .sort((a, b) => {
        const aPending = !a.isPaid ? 0 : 1;
        const bPending = !b.isPaid ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return b.date.localeCompare(a.date);
      })
      .slice(0, 12);
  }, [accountTransactions, upcomingFutureTransactions]);

  const currentBalance =
    summary?.balances.available_balance_cents ?? summary?.balances.current_balance_cents ?? 0;
  const projectedBalance = summary?.balances.projected_balance_cents ?? 0;
  const savingsBalance = summary?.balances.savings_balance_cents ?? 0;
  const benefitsBalance = summary?.balances.benefits_balance_cents ?? 0;
  const projectedBenefitsBalance =
    summary?.balances.projected_benefits_balance_cents ?? benefitsBalance;
  const expensesCents = summary?.month_summary.expenses_cents ?? 0;
  const incomesCents = summary?.month_summary.incomes_cents ?? 0;
  const creditCardCents = summary?.month_summary.credit_card_cents ?? 0;
  // Livre para Gastar no Mês = estritamente sobre contas de movimentação (CHECKING/CASH)
  const freeToSpendCents =
    summary?.balances.free_to_spend_cents ?? incomesCents - (expensesCents + creditCardCents);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between xl:justify-start xl:gap-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs sm:h-10 sm:w-10">
                  <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                    MyMoney
                  </h1>
                  <p className="text-[11px] text-slate-500 sm:text-xs">
                    Gestão Financeira Pessoal
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 sm:hidden"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo
              </button>
            </div>

            {/* Navegação principal responsiva com rolagem horizontal suave no celular */}
            <nav
              aria-label="Navegação principal"
              className="no-scrollbar flex w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1 lg:w-auto"
            >
              <button
                type="button"
                onClick={() => setActiveView('overview')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  activeView === 'overview'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Visão Geral
              </button>
              <button
                type="button"
                onClick={() => setActiveView('transactions')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  activeView === 'transactions'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListFilter className="h-3.5 w-3.5" />
                Extrato
              </button>
              <button
                type="button"
                onClick={() => setActiveView('cards')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  activeView === 'cards'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CreditCardIcon className="h-3.5 w-3.5" />
                Cartões & Faturas
              </button>
              <button
                type="button"
                onClick={() => setActiveView('budgets')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  activeView === 'budgets'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Target className="h-3.5 w-3.5" />
                Orçamento & Tetos
              </button>
              <button
                type="button"
                onClick={() => setActiveView('settings')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  activeView === 'settings'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Configurações
              </button>
            </nav>
          </div>

          {/* Seletor de Competência (YYYY-MM) + Ações */}
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <div className="inline-flex flex-1 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-2xs sm:flex-initial">
              <button
                type="button"
                onClick={() => changeMonth(shiftYearMonth(selectedMonth, -1))}
                className="rounded-md p-1.5 text-slate-600 transition hover:bg-white hover:text-slate-900"
                title="Mês anterior"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1.5 px-2 py-1 sm:gap-2 sm:px-3">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500 sm:h-4 sm:w-4" />
                <span className="min-w-28 text-center text-xs font-medium text-slate-800 sm:min-w-36 sm:text-sm">
                  {formatMonthLabel(selectedMonth, 'long')}
                </span>
                <input
                  type="month"
                  aria-label="Selecionar mês de competência"
                  value={selectedMonth}
                  onChange={(e) => {
                    if (e.target.value) changeMonth(e.target.value);
                  }}
                  className="sr-only"
                />
              </div>

              <button
                type="button"
                onClick={() => changeMonth(shiftYearMonth(selectedMonth, 1))}
                className="rounded-md p-1.5 text-slate-600 transition hover:bg-white hover:text-slate-900"
                title="Próximo mês"
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => changeMonth(getCurrentYearMonth())}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 sm:px-3"
              >
                Mês atual
              </button>

              <button
                type="button"
                onClick={() => void loadDashboardData(selectedMonth)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:px-3"
                title="Atualizar dados"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Atualizar</span>
              </button>

              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="hidden items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 sm:inline-flex"
              >
                <Plus className="h-4 w-4" />
                Novo Lançamento
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
        {/* Banner de erro caso o backend esteja offline */}
        {error && (
          <div className="flex flex-col justify-between gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:text-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboardData(selectedMonth)}
              className="self-start rounded-lg bg-rose-100 px-3 py-1 text-xs font-medium text-rose-900 transition hover:bg-rose-200 sm:self-auto"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Cards de Resumo (Alinhamento Vertical Uniforme) */}
        <section
          aria-label="Indicadores financeiros do mês"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5"
        >
          {/* Card 1: Saldo Disponível (CHECKING / CASH) */}
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5">
            <div>
              <div className="flex min-h-9 items-start justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:text-xs">
                  Saldo Disponível (Caixa)
                </span>
                <div className="shrink-0 rounded-lg bg-slate-100 p-2 text-slate-700">
                  <Wallet className="h-4 w-4" />
                </div>
              </div>
              <p
                className={`mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl ${
                  currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'
                }`}
              >
                {loading && !summary ? '...' : formatCurrency(currentBalance)}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                Guardado/Reserva: {loading && !summary ? '...' : formatCurrency(savingsBalance)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                Vale: {loading && !summary ? '...' : formatCurrency(benefitsBalance)}
              </span>
            </div>
          </div>

          {/* Card 2: Saldo Previsto / Projetado */}
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5">
            <div>
              <div className="flex min-h-9 items-start justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:text-xs">
                  Saldo Projetado
                </span>
                <div className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </div>
              <p
                className={`mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl ${
                  projectedBalance < 0 ? 'text-rose-600' : 'text-slate-900'
                }`}
              >
                {loading && !summary ? '...' : formatCurrency(projectedBalance)}
              </p>
            </div>
            <div className="mt-3 space-y-0.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
              <p className="flex items-center justify-between gap-1">
                <span>Receitas do mês:</span>
                <span className="font-semibold text-emerald-700 tabular-nums">
                  {formatCurrency(incomesCents)}
                </span>
              </p>
              <p className="flex items-center justify-between gap-1">
                <span>Vale projetado:</span>
                <span className="font-semibold text-amber-700 tabular-nums">
                  {loading && !summary ? '...' : formatCurrency(projectedBenefitsBalance)}
                </span>
              </p>
            </div>
          </div>

          {/* Card 3: Livre para Gastar no Mês */}
          <button
            type="button"
            onClick={() => setActiveView('budgets')}
            className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-2xs transition hover:border-teal-300 sm:p-5"
          >
            <div className="w-full">
              <div className="flex min-h-9 items-start justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:text-xs">
                  Livre para Gastar no Mês
                </span>
                <div
                  className={`shrink-0 rounded-lg p-2 ${
                    freeToSpendCents < 0
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-teal-50 text-teal-700'
                  }`}
                >
                  <PiggyBank className="h-4 w-4" />
                </div>
              </div>
              <p
                className={`mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl ${
                  freeToSpendCents < 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {loading && !summary ? '...' : formatCurrency(freeToSpendCents)}
              </p>
            </div>
            <div className="mt-3 w-full border-t border-slate-100 pt-2.5">
              <p className="text-xs font-medium text-teal-700">
                Receitas - despesas e faturas • Ver tetos →
              </p>
            </div>
          </button>

          {/* Card 4: Total a Pagar (Boletos / Contas à vista) */}
          <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5">
            <div>
              <div className="flex min-h-9 items-start justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:text-xs">
                  Contas & Boletos do Mês
                </span>
                <div className="shrink-0 rounded-lg bg-amber-50 p-2 text-amber-700">
                  <Receipt className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">
                {loading && !summary ? '...' : formatCurrency(expensesCents)}
              </p>
            </div>
            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <p className="text-xs text-slate-500">
                Despesas à vista e boletos na competência
              </p>
            </div>
          </div>

          {/* Card 5: Total em Faturas de Cartão */}
          <button
            type="button"
            onClick={() => setActiveView('cards')}
            className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-2xs transition hover:border-indigo-300 sm:col-span-2 lg:col-span-1 sm:p-5"
          >
            <div className="w-full">
              <div className="flex min-h-9 items-start justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:text-xs">
                  Faturas de Cartão
                </span>
                <div className="shrink-0 rounded-lg bg-indigo-50 p-2 text-indigo-700">
                  <CreditCardIcon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">
                {loading && !summary ? '...' : formatCurrency(creditCardCents)}
              </p>
            </div>
            <div className="mt-3 w-full border-t border-slate-100 pt-2.5">
              <p className="text-xs font-medium text-indigo-600">
                Faturas abertas no mês • Gerir faturas →
              </p>
            </div>
          </button>
        </section>

        {activeView === 'transactions' ? (
          <Transactions
            transactions={accountTransactions}
            futureTransactions={upcomingFutureTransactions}
            categories={categories}
            accounts={accounts}
            selectedMonth={selectedMonth}
            onRefreshAll={() => loadDashboardData(selectedMonth)}
          />
        ) : activeView === 'cards' ? (
          <Cards
            cards={cards}
            accounts={accounts}
            categories={categories}
            initialMonth={selectedMonth}
            onRefreshAll={() => loadDashboardData(selectedMonth)}
          />
        ) : activeView === 'budgets' ? (
          <Budgets
            categories={categories}
            summary={summary}
            selectedMonth={selectedMonth}
            onRefreshAll={() => loadDashboardData(selectedMonth)}
          />
        ) : activeView === 'settings' ? (
          <Settings
            accounts={accounts}
            theme={theme}
            onThemeChange={handleThemeChange}
            onRefreshAll={() => loadDashboardData(selectedMonth)}
          />
        ) : (
          <>
            {/* Seção de Gráficos */}
            <section className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
              {/* Gráfico Donut: Despesas por Categoria */}
              <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5 lg:col-span-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Despesas por Categoria</h2>
                    <p className="text-xs text-slate-500">
                      Distribuição em {formatMonthLabel(selectedMonth, 'short')}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-600 tabular-nums">
                    Total: {formatCurrency(totalCategoryExpensesCents)}
                  </span>
                </div>

                {!summary || summary.expenses_by_category.length === 0 ? (
                  <div className="flex min-h-56 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center sm:min-h-64">
                    <p className="text-sm font-medium text-slate-600">
                      Nenhuma despesa registrada neste mês
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      As compras e boletos lançados aparecerão aqui agrupados por categoria.
                    </p>
                  </div>
                ) : (
                  <div className="grid flex-1 grid-cols-1 items-center gap-4 sm:grid-cols-2">
                    <div className="h-52 w-full sm:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={summary.expenses_by_category}
                            dataKey="total_cents"
                            nameKey="category_name"
                            innerRadius={48}
                            outerRadius={76}
                            paddingAngle={2}
                            stroke={isDark ? '#111827' : '#ffffff'}
                          >
                            {summary.expenses_by_category.map((entry, idx) => (
                              <Cell
                                key={entry.category_id ?? `uncategorized-${idx}`}
                                fill={donutColors[idx % donutColors.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => formatCurrency(Number(value ?? 0))}
                            contentStyle={{
                              backgroundColor: isDark ? '#1e293b' : '#ffffff',
                              borderColor: isDark ? '#334155' : '#e2e8f0',
                              color: isDark ? '#f8fafc' : '#0f172a',
                              borderRadius: '0.5rem',
                              fontSize: '0.75rem',
                            }}
                            itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                            labelStyle={{ color: isDark ? '#cbd5e1' : '#475569' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <ul className="max-h-56 space-y-2.5 overflow-y-auto pr-1 text-xs">
                      {summary.expenses_by_category.map((item, idx) => (
                        <li
                          key={item.category_id ?? `cat-${idx}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: donutColors[idx % donutColors.length],
                              }}
                            />
                            <span className="truncate font-medium text-slate-700">
                              {item.category_name}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-right tabular-nums">
                            <span className="font-semibold text-slate-900">
                              {formatCurrency(item.total_cents)}
                            </span>
                            <span className="w-11 text-slate-400">
                              {item.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Gráfico de Barras: Histórico de 6 Meses */}
              <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5 lg:col-span-7">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Evolução nos Últimos 6 Meses
                    </h2>
                    <p className="text-xs text-slate-500">
                      Comparativo mensal de Receitas vs Despesas
                    </p>
                  </div>
                </div>

                <div className="h-60 w-full flex-1 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barChartData}
                      margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={isDark ? '#1e293b' : '#e2e8f0'}
                      />
                      <XAxis
                        dataKey="monthLabel"
                        tick={{ fontSize: 11, fill: isDark ? '#cbd5e1' : '#64748b' }}
                        axisLine={{ stroke: isDark ? '#334155' : '#cbd5e1' }}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(val: number) =>
                          `R$ ${(val / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
                        }
                        tick={{ fontSize: 10, fill: isDark ? '#cbd5e1' : '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        width={68}
                      />
                      <Tooltip
                        formatter={(value) => formatCurrency(Number(value ?? 0))}
                        cursor={{
                          fill: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)',
                        }}
                        contentStyle={{
                          backgroundColor: isDark ? '#1e293b' : '#ffffff',
                          borderColor: isDark ? '#334155' : '#e2e8f0',
                          color: isDark ? '#f8fafc' : '#0f172a',
                          borderRadius: '0.5rem',
                          fontSize: '0.75rem',
                        }}
                        itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                        labelStyle={{ color: isDark ? '#cbd5e1' : '#475569', fontWeight: 600 }}
                      />
                      <Legend
                        wrapperStyle={{
                          fontSize: '0.75rem',
                          paddingTop: '0.5rem',
                          color: isDark ? '#e2e8f0' : '#334155',
                        }}
                        iconType="circle"
                      />
                      <Bar
                        dataKey="incomesCents"
                        name="Receitas"
                        fill={isDark ? '#34d399' : '#059669'}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      />
                      <Bar
                        dataKey="expensesCents"
                        name="Despesas"
                        fill={isDark ? '#fb7185' : '#e11d48'}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Tabela Rápida: Próximos Vencimentos / Lançamentos do Mês */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex flex-col justify-between gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5 sm:py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Próximos Vencimentos e Lançamentos do Mês
                  </h2>
                  <p className="text-xs text-slate-500">
                    Marque a caixa ou clique no status para dar baixa rápida e recalcular o saldo
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
                  <span className="text-xs font-medium text-slate-500">
                    {accountTransactions.length} lançamento(s) na competência
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveView('transactions')}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Ver Extrato Completo →
                  </button>
                </div>
              </div>

              {sortedTransactions.length === 0 ? (
                <div className="p-6 text-center sm:p-8">
                  <p className="text-sm font-medium text-slate-600">
                    Nenhuma transação encontrada em {formatMonthLabel(selectedMonth, 'long')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Clique em "+ Novo Lançamento" no topo para registrar sua primeira receita ou
                    despesa.
                  </p>
                </div>
              ) : (
                <>
                  {/* Visão Mobile em Cards (< 768px) */}
                  <div className="divide-y divide-slate-200 md:hidden">
                    {sortedTransactions.map((tx) => {
                      const category = tx.categoryId ? categoriesMap.get(tx.categoryId) : undefined;
                      const account = tx.accountId ? accountsMap.get(tx.accountId) : undefined;
                      const isCardTx = tx.invoiceId !== null;
                      const isIncome = tx.type === 'income';
                      const isToggling = togglingId === tx.id;

                      return (
                        <div key={tx.id} className="flex flex-col gap-2.5 p-3.5 sm:p-4">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex min-w-0 items-start gap-2.5">
                              {!isCardTx ? (
                                <input
                                  type="checkbox"
                                  checked={tx.isPaid}
                                  disabled={isToggling}
                                  onChange={() => void handleTogglePaid(tx)}
                                  aria-label={`Marcar "${tx.description}" como ${tx.isPaid ? 'pendente' : 'pago'}`}
                                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50"
                                />
                              ) : (
                                <span
                                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700`}
                                >
                                  <CreditCardIcon className="h-3.5 w-3.5" />
                                </span>
                              )}

                              <div className="min-w-0">
                                <p
                                  className={`text-sm font-medium break-words ${
                                    !isCardTx && tx.isPaid
                                      ? 'text-slate-500 line-through decoration-slate-300'
                                      : 'text-slate-900'
                                  }`}
                                >
                                  {tx.description}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                  <span>{formatIsoDate(tx.date)}</span>
                                  <span>•</span>
                                  <span>{category ? category.name : 'Sem categoria'}</span>
                                  <span>•</span>
                                  <span>
                                    {isCardTx ? 'Cartão de Crédito' : (account?.name ?? 'Conta')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <span
                              className={`shrink-0 text-sm font-semibold tabular-nums ${
                                isIncome ? 'text-emerald-700' : 'text-slate-900'
                              }`}
                            >
                              {isIncome ? '+ ' : '- '}
                              {formatCurrency(tx.amountCents)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(tx.date > todayIso || !tx.date.startsWith(selectedMonth)) &&
                                !tx.isPaid && (
                                  <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
                                    <Calendar className="h-2.5 w-2.5" />
                                    Lançamento Futuro
                                  </span>
                                )}
                              {tx.recurringId && (
                                <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                  <Repeat className="h-2.5 w-2.5" />
                                  {isCardTx
                                    ? 'Assinatura'
                                    : isIncome
                                      ? 'Receita Recorrente'
                                      : 'Conta Recorrente'}
                                </span>
                              )}
                              {tx.installmentNumber && tx.installmentTotal && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                  {tx.installmentNumber}/{tx.installmentTotal}
                                </span>
                              )}
                            </div>

                            {isCardTx ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700">
                                Na fatura
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleTogglePaid(tx)}
                                disabled={isToggling}
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                                  tx.isPaid
                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                                }`}
                              >
                                {tx.isPaid ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3" />
                                    Pago
                                  </>
                                ) : (
                                  <>
                                    <Clock className="h-3 w-3" />
                                    Pendente
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Visão Desktop em Tabela (>= 768px) */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
                          <th className="w-10 px-4 py-3 text-center">Baixa</th>
                          <th className="px-4 py-3">Data</th>
                          <th className="px-4 py-3">Descrição</th>
                          <th className="px-4 py-3">Categoria</th>
                          <th className="px-4 py-3">Origem</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-5 py-3 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sortedTransactions.map((tx) => {
                          const category = tx.categoryId
                            ? categoriesMap.get(tx.categoryId)
                            : undefined;
                          const account = tx.accountId ? accountsMap.get(tx.accountId) : undefined;
                          const isCardTx = tx.invoiceId !== null;
                          const isIncome = tx.type === 'income';
                          const isToggling = togglingId === tx.id;

                          return (
                            <tr key={tx.id} className="transition hover:bg-slate-50/80">
                              <td className="px-4 py-3.5 text-center">
                                {isCardTx ? (
                                  <span
                                    className="inline-block h-4 w-4 text-slate-300"
                                    title="Quitado via fatura do cartão"
                                  >
                                    —
                                  </span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={tx.isPaid}
                                    disabled={isToggling}
                                    onChange={() => void handleTogglePaid(tx)}
                                    aria-label={`Marcar "${tx.description}" como ${tx.isPaid ? 'pendente' : 'pago'}`}
                                    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50"
                                  />
                                )}
                              </td>

                              <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                                {formatIsoDate(tx.date)}
                              </td>

                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2.5">
                                  <span
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                      isIncome
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {isIncome ? (
                                      <ArrowUpRight className="h-4 w-4" />
                                    ) : (
                                      <ArrowDownRight className="h-4 w-4" />
                                    )}
                                  </span>
                                  <div>
                                    <p
                                      className={`font-medium ${
                                        !isCardTx && tx.isPaid
                                          ? 'text-slate-500 line-through decoration-slate-300'
                                          : 'text-slate-900'
                                      }`}
                                    >
                                      {tx.description}
                                      {(tx.date > todayIso || !tx.date.startsWith(selectedMonth)) &&
                                        !tx.isPaid && (
                                          <span className="ml-2 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70 no-underline">
                                            <Calendar className="h-3 w-3" />
                                            Lançamento Futuro
                                          </span>
                                        )}
                                      {tx.recurringId && (
                                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 no-underline">
                                          <Repeat className="h-3 w-3" />
                                          {isCardTx
                                            ? 'Assinatura'
                                            : isIncome
                                              ? 'Receita Recorrente'
                                              : 'Conta Recorrente'}
                                        </span>
                                      )}
                                      {tx.installmentNumber && tx.installmentTotal && (
                                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 no-underline">
                                          {tx.installmentNumber}/{tx.installmentTotal}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                                {category ? category.name : 'Sem categoria'}
                              </td>

                              <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                                {isCardTx ? (
                                  <span className="inline-flex items-center gap-1 text-indigo-700">
                                    <CreditCardIcon className="h-3.5 w-3.5" />
                                    Cartão de Crédito
                                  </span>
                                ) : (
                                  <span>{account ? account.name : 'Conta'}</span>
                                )}
                              </td>

                              <td className="whitespace-nowrap px-4 py-3.5">
                                {isCardTx ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                                    Na fatura
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleTogglePaid(tx)}
                                    disabled={isToggling}
                                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                                      tx.isPaid
                                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                                    }`}
                                    title="Clique para alternar entre Pago e Pendente"
                                  >
                                    {tx.isPaid ? (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Pago
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="h-3.5 w-3.5" />
                                        Pendente
                                      </>
                                    )}
                                  </button>
                                )}
                              </td>

                              <td
                                className={`whitespace-nowrap px-5 py-3.5 text-right font-semibold tabular-nums ${
                                  isIncome ? 'text-emerald-700' : 'text-slate-900'
                                }`}
                              >
                                {isIncome ? '+ ' : '- '}
                                {formatCurrency(tx.amountCents)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </main>

      {/* Modal de Novo Lançamento */}
      <TransactionModal
        key={selectedMonth}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => void loadDashboardData(selectedMonth)}
        categories={categories}
        accounts={accounts}
        cards={cards}
        defaultMonth={selectedMonth}
        onCardCreated={(newCard) => setCards((prev) => [...prev, newCard])}
      />
    </div>
  );
}
export default Dashboard;
