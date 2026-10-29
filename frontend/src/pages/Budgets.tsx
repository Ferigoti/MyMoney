import axios from 'axios';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Pencil,
  Plus,
  Target,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { createCategory, updateCategoryBudget } from '../services/api';
import type { Category, DashboardSummary } from '../types';
import { centsToInput, formatCurrency, formatMonthLabel } from '../utils/formatters';

export interface BudgetsProps {
  categories: Category[];
  summary: DashboardSummary | null;
  selectedMonth: string;
  onRefreshAll: () => Promise<void> | void;
}

function digitsToCents(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number.parseInt(digits, 10);
}

function extractApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: string; issues?: { path?: string; message?: string }[] }
      | undefined;
    if (data?.issues && data.issues.length > 0) {
      return data.issues.map((i) => i.message).join(' • ');
    }
    if (data?.message) return data.message;
  }
  return err instanceof Error ? err.message : 'Erro ao atualizar orçamento.';
}

export function Budgets({
  categories,
  summary,
  selectedMonth,
  onRefreshAll,
}: BudgetsProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editBudgetCents, setEditBudgetCents] = useState<number>(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado para criação rápida de nova categoria de despesa
  const [isNewCatOpen, setIsNewCatOpen] = useState<boolean>(false);
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatBudgetCents, setNewCatBudgetCents] = useState<number>(0);
  const [creatingCat, setCreatingCat] = useState<boolean>(false);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind === 'expense'),
    [categories],
  );

  // Mapa de consumo vindo do GET /dashboard/summary (expenses_by_category)
  const spentByCategoryMap = useMemo(() => {
    const map = new Map<
      string,
      {
        spentCents: number;
        budgetCents: number;
        remainingCents: number;
        usagePercentage: number;
      }
    >();
    if (!summary) return map;

    for (const item of summary.expenses_by_category) {
      if (item.category_id) {
        map.set(item.category_id, {
          spentCents: item.spent_cents ?? item.total_cents,
          budgetCents: item.budget_cents ?? 0,
          remainingCents: item.remaining_cents ?? 0,
          usagePercentage: item.usage_percentage ?? 0,
        });
      }
    }
    return map;
  }, [summary]);

  const budgetItems = useMemo(() => {
    return expenseCategories.map((cat) => {
      const fromSummary = spentByCategoryMap.get(cat.id);
      const budgetCents = cat.monthlyBudgetCents ?? fromSummary?.budgetCents ?? 0;
      const spentCents = fromSummary?.spentCents ?? 0;
      const remainingCents = budgetCents > 0 ? budgetCents - spentCents : 0;
      const usagePercentage =
        budgetCents > 0 ? Math.round((spentCents * 10000) / budgetCents) / 100 : 0;

      return {
        category: cat,
        budgetCents,
        spentCents,
        remainingCents,
        usagePercentage,
      };
    });
  }, [expenseCategories, spentByCategoryMap]);

  const totals = useMemo(() => {
    return budgetItems.reduce(
      (acc, item) => {
        acc.totalBudgetCents += item.budgetCents;
        acc.totalSpentInBudgetedCents += item.budgetCents > 0 ? item.spentCents : 0;
        acc.totalSpentAllCents += item.spentCents;
        return acc;
      },
      { totalBudgetCents: 0, totalSpentInBudgetedCents: 0, totalSpentAllCents: 0 },
    );
  }, [budgetItems]);

  const startEditing = (cat: Category) => {
    setError(null);
    setEditingCategoryId(cat.id);
    setEditBudgetCents(cat.monthlyBudgetCents ?? 0);
  };

  const cancelEditing = () => {
    setEditingCategoryId(null);
    setEditBudgetCents(0);
  };

  const handleSaveBudget = async (e: FormEvent, categoryId: string) => {
    e.preventDefault();
    setSavingId(categoryId);
    setError(null);
    try {
      await updateCategoryBudget(categoryId, editBudgetCents);
      setEditingCategoryId(null);
      await Promise.resolve(onRefreshAll());
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleCreateCategory = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setError('Informe o nome da categoria.');
      return;
    }

    setCreatingCat(true);
    setError(null);
    try {
      await createCategory({
        name: trimmed,
        kind: 'expense',
        monthlyBudgetCents: newCatBudgetCents,
      });
      setNewCatName('');
      setNewCatBudgetCents(0);
      setIsNewCatOpen(false);
      await Promise.resolve(onRefreshAll());
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setCreatingCat(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Secção de Orçamentos */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Orçamento Mensal e Tetos de Gastos — {formatMonthLabel(selectedMonth, 'long')}
          </h2>
          <p className="text-xs text-slate-500">
            Defina limites por categoria de despesa e acompanhe alertas quando o consumo atingir 80%
            ou 100%
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {totals.totalBudgetCents > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs shadow-2xs">
              <span>
                <span className="text-slate-500">Total Orçado: </span>
                <strong className="text-slate-900">{formatCurrency(totals.totalBudgetCents)}</strong>
              </span>
              <span className="hidden text-slate-300 sm:inline">|</span>
              <span>
                <span className="text-slate-500">Consumido: </span>
                <strong className="text-slate-900">
                  {formatCurrency(totals.totalSpentInBudgetedCents)}
                </strong>
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsNewCatOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Nova Categoria
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Formulário rápido de Nova Categoria com Teto */}
      {isNewCatOpen && (
        <form
          onSubmit={(e) => void handleCreateCategory(e)}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label htmlFor="new-cat-name" className="mb-1 block text-xs font-medium text-slate-700">
              Nome da Categoria de Despesa
            </label>
            <input
              id="new-cat-name"
              type="text"
              required
              placeholder="Ex.: Educação, Assinaturas..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="w-full sm:w-52">
            <label
              htmlFor="new-cat-budget"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Teto Mensal Inicial (R$)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-medium text-slate-400">
                R$
              </span>
              <input
                id="new-cat-budget"
                type="text"
                inputMode="numeric"
                value={centsToInput(newCatBudgetCents)}
                onChange={(e) => setNewCatBudgetCents(digitsToCents(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsNewCatOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creatingCat}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creatingCat ? 'Salvando...' : 'Criar Categoria'}
            </button>
          </div>
        </form>
      )}

      {/* Grid de Cards de Categorias e seus Tetos de Gastos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {budgetItems.map(
          ({ category, budgetCents, spentCents, remainingCents, usagePercentage }) => {
            const isEditing = editingCategoryId === category.id;
            const isSaving = savingId === category.id;
            const hasBudget = budgetCents > 0;
            const isExceeded = hasBudget && usagePercentage >= 100;
            const isWarning = hasBudget && usagePercentage >= 80 && usagePercentage < 100;
            const barWidth = hasBudget ? Math.min(100, Math.max(0, usagePercentage)) : 0;

            return (
              <div
                key={category.id}
                className={`flex flex-col justify-between rounded-xl border bg-white p-4 shadow-2xs transition sm:p-5 ${
                  isExceeded
                    ? 'border-rose-300 ring-1 ring-rose-100'
                    : isWarning
                      ? 'border-amber-300 ring-1 ring-amber-100'
                      : 'border-slate-200'
                }`}
              >
                {/* Topo do Card: Nome + Badge de Alerta + Botão Editar Teto */}
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{category.name}</h3>
                      {isExceeded && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                          <AlertCircle className="h-3 w-3" />
                          Limite atingido ({usagePercentage.toFixed(0)}%)
                        </span>
                      )}
                      {isWarning && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                          <AlertTriangle className="h-3 w-3" />
                          Alerta &gt; 80% ({usagePercentage.toFixed(0)}%)
                        </span>
                      )}
                      {hasBudget && !isWarning && !isExceeded && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {usagePercentage.toFixed(0)}% utilizado
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      {hasBudget ? (
                        <>
                          <strong className="text-slate-900">{formatCurrency(spentCents)}</strong>{' '}
                          de{' '}
                          <strong className="text-slate-700">{formatCurrency(budgetCents)}</strong>
                        </>
                      ) : (
                        <>
                          Gasto no mês:{' '}
                          <strong className="text-slate-900">{formatCurrency(spentCents)}</strong>{' '}
                          <span className="text-slate-400">(sem teto definido)</span>
                        </>
                      )}
                    </p>
                  </div>

                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEditing(category)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      title="Definir ou editar teto mensal"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {hasBudget ? 'Editar teto' : 'Definir teto'}
                    </button>
                  )}
                </div>

                {/* Edição rápida inline do teto mensal */}
                {isEditing ? (
                  <form
                    onSubmit={(e) => void handleSaveBudget(e, category.id)}
                    className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                  >
                    <Target className="h-4 w-4 shrink-0 text-slate-500" />
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-xs font-medium text-slate-400">
                        R$
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Teto mensal para ${category.name}`}
                        value={centsToInput(editBudgetCents)}
                        onChange={(e) => setEditBudgetCents(digitsToCents(e.target.value))}
                        className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isSaving ? '...' : 'Salvar'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={isSaving}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70"
                      aria-label="Cancelar edição"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <div className="mt-4 space-y-2">
                    {/* Barra de progresso visual */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${
                          !hasBudget
                            ? 'bg-slate-300'
                            : isExceeded
                              ? 'bg-rose-600'
                              : isWarning
                                ? 'bg-amber-500'
                                : 'bg-emerald-600'
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>

                    {/* Saldo restante disponível */}
                    <div className="flex items-center justify-between text-xs">
                      {hasBudget ? (
                        remainingCents >= 0 ? (
                          <span className="text-slate-600">
                            Ainda pode gastar{' '}
                            <strong className="font-semibold text-emerald-700">
                              {formatCurrency(remainingCents)}
                            </strong>
                          </span>
                        ) : (
                          <span className="font-medium text-rose-700">
                            Teto excedido em{' '}
                            <strong>{formatCurrency(Math.abs(remainingCents))}</strong>
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">
                          Configure um teto mensal para acompanhar o saldo disponível
                        </span>
                      )}

                      {hasBudget && (
                        <span className="font-medium text-slate-500">
                          {usagePercentage.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

export default Budgets;

