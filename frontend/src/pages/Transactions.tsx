import axios from 'axios';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard as CreditCardIcon,
  Filter,
  Pencil,
  Repeat,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  deleteTransaction,
  toggleTransactionPaid,
  updateTransaction,
} from '../services/api';
import type { Account, Category, DeleteScope, Transaction } from '../types';
import {
  centsToInput,
  consolidateTransferTransactions,
  formatCurrency,
  formatIsoDate,
  formatMonthLabel,
  getTodayIsoDate,
  type ConsolidatedTransferFields,
} from '../utils/formatters';

export interface TransactionsProps {
  transactions: Transaction[];
  futureTransactions?: Transaction[];
  categories: Category[];
  accounts: Account[];
  selectedMonth: string;
  onRefreshAll: () => Promise<void> | void;
}

type TypeFilter = 'all' | 'income' | 'expense' | 'transfer' | 'recurring';
type StatusFilter = 'all' | 'paid' | 'pending' | 'future';
type DisplayTransaction = Transaction & ConsolidatedTransferFields;

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
  return err instanceof Error ? err.message : 'Ocorreu um erro ao processar a operação.';
}

export function Transactions({
  transactions,
  futureTransactions = [],
  categories,
  accounts,
  selectedMonth,
  onRefreshAll,
}: TransactionsProps) {
  // Filtros do Extrato
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const todayIso = getTodayIsoDate();

  // Feedback visual e loading de ações
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Estado do Modal de Edição (PUT /transactions/:id)
  const [editingTx, setEditingTx] = useState<DisplayTransaction | null>(null);
  const [editDescription, setEditDescription] = useState<string>('');
  const [editAmountCents, setEditAmountCents] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editIsPaid, setEditIsPaid] = useState<boolean>(false);
  const [editUpdateRecurring, setEditUpdateRecurring] = useState<boolean>(true);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Estado do Diálogo de Exclusão (DELETE /transactions/:id?scope=single|future)
  const [deletingTx, setDeletingTx] = useState<DisplayTransaction | null>(null);
  const [deletingScope, setDeletingScope] = useState<DeleteScope | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // Une as transações em conta do mês selecionado com os lançamentos futuros (recorrências e agendados)
  // Exclui compras de cartão de crédito (que aparecem apenas em Cartões & Faturas) e consolida pares de transferência entre contas
  const allTransactions = useMemo(() => {
    const seen = new Set<string>();
    const combined: Transaction[] = [];
    for (const tx of [...transactions, ...futureTransactions]) {
      if (tx.invoiceId !== null) continue;
      if (!seen.has(tx.id)) {
        seen.add(tx.id);
        combined.push(tx);
      }
    }
    const sorted = combined.sort((a, b) => b.date.localeCompare(a.date));
    return consolidateTransferTransactions(sorted, accountsMap);
  }, [transactions, futureTransactions, accountsMap]);

  const filteredTransactions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return allTransactions.filter((tx) => {
      if (query) {
        const matchesDesc = tx.description.toLowerCase().includes(query);
        const matchesCleanDesc = tx.transferCleanDescription?.toLowerCase().includes(query);
        const matchesOrigin = tx.transferOriginAccountName?.toLowerCase().includes(query);
        const matchesDest = tx.transferDestinationAccountName?.toLowerCase().includes(query);
        if (!matchesDesc && !matchesCleanDesc && !matchesOrigin && !matchesDest) {
          return false;
        }
      }

      if (typeFilter === 'income' && (tx.type !== 'income' || tx.isTransfer)) {
        return false;
      }
      if (typeFilter === 'expense' && (tx.type !== 'expense' || tx.isTransfer)) {
        return false;
      }
      if (typeFilter === 'transfer' && !tx.isTransfer) {
        return false;
      }
      if (typeFilter === 'recurring' && !tx.recurringId) {
        return false;
      }

      if (categoryFilter === 'uncategorized' && (tx.categoryId !== null || tx.isTransfer)) {
        return false;
      }
      if (
        categoryFilter !== 'all' &&
        categoryFilter !== 'uncategorized' &&
        tx.categoryId !== categoryFilter
      ) {
        return false;
      }

      const isFutureTx = (tx.date > todayIso || !tx.date.startsWith(selectedMonth)) && !tx.isPaid;

      if (statusFilter === 'paid') {
        if (tx.invoiceId !== null || !tx.isPaid) return false;
      }
      if (statusFilter === 'pending') {
        if (tx.invoiceId === null && tx.isPaid) return false;
      }
      if (statusFilter === 'future') {
        if (!isFutureTx) return false;
      }

      return true;
    });
  }, [allTransactions, searchTerm, typeFilter, categoryFilter, statusFilter, todayIso, selectedMonth]);

  const editAvailableCategories = useMemo(() => {
    if (!editingTx) return [];
    return categories.filter((c) => c.kind === editingTx.type);
  }, [categories, editingTx]);

  const handleOpenEdit = (tx: DisplayTransaction) => {
    setEditError(null);
    setFeedback(null);
    setEditingTx(tx);
    setEditDescription(tx.isTransfer ? (tx.transferCleanDescription ?? tx.description) : tx.description);
    setEditAmountCents(tx.amountCents);
    setEditDate(tx.date);
    setEditCategoryId(tx.categoryId ?? '');
    setEditIsPaid(tx.isPaid);
    setEditUpdateRecurring(true);
  };

  const handleConfirmEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;

    const trimmedDesc = editDescription.trim();
    if (!trimmedDesc) {
      setEditError('Informe uma descrição válida.');
      return;
    }
    if (editAmountCents <= 0) {
      setEditError('O valor deve ser maior que R$ 0,00.');
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      if (editingTx.isTransfer) {
        const originName = editingTx.transferOriginAccountName ?? 'Origem';
        const destName = editingTx.transferDestinationAccountName ?? 'Destino';
        const primaryDesc =
          editingTx.transferDirection === 'in'
            ? `${trimmedDesc} (Entrada ← ${originName})`
            : `${trimmedDesc} (Saída → ${destName})`;

        await updateTransaction(editingTx.id, {
          description: primaryDesc,
          amountCents: editAmountCents,
          date: editDate,
          categoryId: null,
          isPaid: editIsPaid,
        });

        if (editingTx.pairedTransactionId) {
          const pairedDesc = `${trimmedDesc} (Entrada ← ${originName})`;
          await updateTransaction(editingTx.pairedTransactionId, {
            description: pairedDesc,
            amountCents: editAmountCents,
            date: editDate,
            categoryId: null,
            isPaid: editIsPaid,
          });
        }
      } else {
        await updateTransaction(editingTx.id, {
          description: trimmedDesc,
          amountCents: editAmountCents,
          date: editDate,
          categoryId: editCategoryId ? editCategoryId : null,
          ...(editingTx.invoiceId === null ? { isPaid: editIsPaid } : {}),
          ...(editingTx.recurringId ? { updateRecurring: editUpdateRecurring } : {}),
        });
      }
      setEditingTx(null);
      setFeedback({ type: 'success', message: 'Lançamento atualizado com sucesso.' });
      await Promise.resolve(onRefreshAll());
    } catch (err) {
      setEditError(extractApiErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenDelete = (tx: DisplayTransaction) => {
    setDeleteError(null);
    setFeedback(null);
    setDeletingTx(tx);
  };

  const handleConfirmDelete = async (scope: DeleteScope) => {
    if (!deletingTx) return;
    setDeletingScope(scope);
    setDeleteError(null);
    try {
      const result = await deleteTransaction(deletingTx.id, scope);
      if (deletingTx.isTransfer && deletingTx.pairedTransactionId) {
        await deleteTransaction(deletingTx.pairedTransactionId, 'single');
      }
      setDeletingTx(null);
      setFeedback({
        type: 'success',
        message: deletingTx.isTransfer
          ? 'Transferência entre contas excluída com sucesso.'
          : result.deletedCount > 1
            ? `${result.deletedCount} parcelas foram excluídas com sucesso.`
            : 'Lançamento excluído com sucesso.',
      });
      await Promise.resolve(onRefreshAll());
    } catch (err) {
      setDeleteError(extractApiErrorMessage(err));
    } finally {
      setDeletingScope(null);
    }
  };

  const handleTogglePaid = async (tx: DisplayTransaction) => {
    if (tx.invoiceId !== null || togglingId) return;
    setTogglingId(tx.id);
    setFeedback(null);
    try {
      await toggleTransactionPaid(tx.id);
      if (tx.isTransfer && tx.pairedTransactionId) {
        await toggleTransactionPaid(tx.pairedTransactionId);
      }
      await Promise.resolve(onRefreshAll());
    } catch (err) {
      setFeedback({ type: 'error', message: extractApiErrorMessage(err) });
    } finally {
      setTogglingId(null);
    }
  };

  const isInstallmentDelete =
    deletingTx !== null &&
    deletingTx.installmentGroupId !== null &&
    deletingTx.installmentNumber !== null &&
    deletingTx.installmentTotal !== null;

  const isRecurringDelete = deletingTx !== null && Boolean(deletingTx.recurringId);

  return (
    <div className="space-y-5">
      {/* Cabeçalho do Extrato */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Extrato Detalhado — {formatMonthLabel(selectedMonth, 'long')}
          </h2>
          <p className="text-xs text-slate-500">
            Pesquise por descrição, filtre por origem/categoria e edite ou exclua lançamentos com
            segurança
          </p>
        </div>
        <span className="text-xs font-medium text-slate-500">
          Exibindo {filteredTransactions.length} de {allTransactions.length} lançamento(s)
        </span>
      </div>

      {/* Feedback visual de operações */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 opacity-70 hover:opacity-100"
            aria-label="Fechar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Barra de Pesquisa e Filtros Rápidos */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:grid-cols-12">
        {/* Busca textual por descrição */}
        <div className="relative md:col-span-5">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar por descrição..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar por descrição"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        {/* Filtro por Tipo (Receita / Despesa / Cartão) */}
        <div className="md:col-span-3">
          <div className="relative">
            <Filter className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              aria-label="Filtrar por tipo"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-8 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              <option value="all">Todos os tipos</option>
              <option value="income">Receitas (Conta)</option>
              <option value="expense">Despesas / Débito / Pagamento Fatura</option>
              <option value="transfer">Transferências entre Contas</option>
              <option value="recurring">Contas e Receitas Recorrentes</option>
            </select>
          </div>
        </div>

        {/* Filtro por Categoria */}
        <div className="md:col-span-2">
          <select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          >
            <option value="all">Todas as categorias</option>
            <option value="uncategorized">Sem categoria</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro por Status */}
        <div className="md:col-span-2">
          <select
            aria-label="Filtrar por status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          >
            <option value="all">Todos os status</option>
            <option value="paid">Pago / Recebido</option>
            <option value="pending">Pendente / Na fatura</option>
            <option value="future">Lançamentos Futuros</option>
          </select>
        </div>
      </div>

      {/* Tabela de Extrato (Desktop) e Lista Compacta (Mobile) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs">
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center sm:p-10">
            <p className="text-sm font-medium text-slate-600">
              Nenhuma transação corresponde aos filtros selecionados
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Ajuste os filtros de busca ou selecione outra competência no topo da página.
            </p>
          </div>
        ) : (
          <>
            {/* Lista Mobile (< md) */}
            <div className="divide-y divide-slate-200 md:hidden">
              {filteredTransactions.map((tx) => {
                const category = tx.categoryId ? categoriesMap.get(tx.categoryId) : undefined;
                const account = tx.accountId ? accountsMap.get(tx.accountId) : undefined;
                const isCardTx = tx.invoiceId !== null;
                const isTransfer = Boolean(tx.isTransfer);
                const isIncome = tx.type === 'income' && !isTransfer;
                const isToggling = togglingId === tx.id;
                const displayDescription = isTransfer
                  ? (tx.transferCleanDescription ?? tx.description)
                  : tx.description;

                return (
                  <div key={tx.id} className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        {isCardTx ? (
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700"
                            title="Compra no Cartão"
                          >
                            <CreditCardIcon className="h-4 w-4" />
                          </span>
                        ) : isTransfer ? (
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-200/70"
                            title="Transferência entre Contas"
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={tx.isPaid}
                            disabled={isToggling}
                            onChange={() => void handleTogglePaid(tx)}
                            aria-label={`Alternar baixa de ${displayDescription}`}
                            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 break-words">
                            {displayDescription}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span>{formatIsoDate(tx.date)}</span>
                            <span>•</span>
                            <span>
                              {isTransfer
                                ? 'Transferência entre contas'
                                : category
                                  ? category.name
                                  : 'Sem categoria'}
                            </span>
                            <span>•</span>
                            <span>
                              {isTransfer ? (
                                <strong className="font-semibold text-sky-700">
                                  {tx.transferOriginAccountName} → {tx.transferDestinationAccountName}
                                </strong>
                              ) : isCardTx ? (
                                'Cartão de Crédito'
                              ) : account ? (
                                account.name
                              ) : (
                                'Conta'
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          isTransfer
                            ? 'text-sky-700'
                            : isIncome
                              ? 'text-emerald-700'
                              : 'text-slate-900'
                        }`}
                      >
                        {isTransfer ? '⇄ ' : isIncome ? '+ ' : '- '}
                        {formatCurrency(tx.amountCents)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCardTx ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                            Na fatura
                          </span>
                        ) : isTransfer ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
                            <ArrowLeftRight className="h-3 w-3" />
                            Entre Contas
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleTogglePaid(tx)}
                            disabled={isToggling}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                              tx.isPaid
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-800'
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

                        {(tx.date > todayIso || !tx.date.startsWith(selectedMonth)) &&
                          !tx.isPaid && (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
                              <Calendar className="h-2.5 w-2.5" />
                              Lançamento Futuro
                            </span>
                          )}

                        {tx.recurringId && (
                          <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200/70">
                            <Repeat className="h-2.5 w-2.5" />
                            {isCardTx
                              ? 'Assinatura'
                              : isIncome
                                ? 'Receita Recorrente'
                                : 'Conta Recorrente'}
                          </span>
                        )}

                        {tx.installmentNumber && tx.installmentTotal && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                            {tx.installmentNumber}/{tx.installmentTotal}
                          </span>
                        )}
                      </div>

                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(tx)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                          aria-label={`Editar ${displayDescription}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDelete(tx)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
                          aria-label={`Excluir ${displayDescription}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tabela Desktop (>= md) */}
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
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-5 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredTransactions.map((tx) => {
                    const category = tx.categoryId ? categoriesMap.get(tx.categoryId) : undefined;
                    const account = tx.accountId ? accountsMap.get(tx.accountId) : undefined;
                    const isCardTx = tx.invoiceId !== null;
                    const isTransfer = Boolean(tx.isTransfer);
                    const isIncome = tx.type === 'income' && !isTransfer;
                    const isToggling = togglingId === tx.id;
                    const displayDescription = isTransfer
                      ? (tx.transferCleanDescription ?? tx.description)
                      : tx.description;

                    return (
                      <tr key={tx.id} className="transition hover:bg-slate-50/80">
                        <td className="px-4 py-3.5 text-center">
                          {isCardTx || isTransfer ? (
                            <span
                              className="inline-block h-4 w-4 text-slate-300"
                              title={
                                isTransfer
                                  ? 'Transferência concluída entre contas'
                                  : 'Quitado via fatura do cartão'
                              }
                            >
                              {isTransfer ? '⇄' : '—'}
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={tx.isPaid}
                              disabled={isToggling}
                              onChange={() => void handleTogglePaid(tx)}
                              aria-label={`Alternar baixa de ${displayDescription}`}
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
                                isTransfer
                                  ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/70'
                                  : isIncome
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : isCardTx
                                      ? 'bg-indigo-50 text-indigo-700'
                                      : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {isTransfer ? (
                                <ArrowLeftRight className="h-4 w-4" />
                              ) : isIncome ? (
                                <ArrowUpRight className="h-4 w-4" />
                              ) : (
                                <ArrowDownRight className="h-4 w-4" />
                              )}
                            </span>
                            <div>
                              <p className="font-medium text-slate-900">
                                {displayDescription}
                                {isTransfer && (
                                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
                                    <ArrowLeftRight className="h-3 w-3" />
                                    Transferência entre Contas
                                  </span>
                                )}
                                {(tx.date > todayIso || !tx.date.startsWith(selectedMonth)) &&
                                  !tx.isPaid && (
                                    <span className="ml-2 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
                                      <Calendar className="h-3 w-3" />
                                      Lançamento Futuro
                                    </span>
                                  )}
                                {tx.recurringId && (
                                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200/70">
                                    <Repeat className="h-3 w-3" />
                                    {isCardTx
                                      ? 'Assinatura'
                                      : isIncome
                                        ? 'Receita Recorrente'
                                        : 'Conta Recorrente'}
                                  </span>
                                )}
                                {tx.installmentNumber && tx.installmentTotal && (
                                  <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                                    Parcela {tx.installmentNumber}/{tx.installmentTotal}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                          {isTransfer ? (
                            <span className="font-medium text-sky-700">
                              Transferência entre contas
                            </span>
                          ) : category ? (
                            category.name
                          ) : (
                            'Sem categoria'
                          )}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                          {isTransfer ? (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                              <span>{tx.transferOriginAccountName}</span>
                              <span className="text-sky-600">→</span>
                              <span>{tx.transferDestinationAccountName}</span>
                            </span>
                          ) : isCardTx ? (
                            <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
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
                          ) : isTransfer ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200/70">
                              <ArrowLeftRight className="h-3.5 w-3.5" />
                              Transferido
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
                          className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums ${
                            isTransfer
                              ? 'text-sky-700'
                              : isIncome
                                ? 'text-emerald-700'
                                : 'text-slate-900'
                          }`}
                        >
                          {isTransfer ? '⇄ ' : isIncome ? '+ ' : '- '}
                          {formatCurrency(tx.amountCents)}
                        </td>

                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(tx)}
                              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                              title="Editar lançamento"
                              aria-label={`Editar ${displayDescription}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenDelete(tx)}
                              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                              title="Excluir lançamento"
                              aria-label={`Excluir ${displayDescription}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal de Edição de Transação (PUT /transactions/:id) */}
      {editingTx && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-tx-title"
        >
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
              <div>
                <h3 id="edit-tx-title" className="text-base font-semibold text-slate-900">
                  Editar Lançamento
                </h3>
                <p className="text-xs text-slate-500">
                  Atualize a descrição, valor, data ou categoria
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmEdit(e)}
              className="space-y-4 overflow-y-auto p-4 sm:p-6"
            >
              {editError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="edit-tx-desc"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Descrição
                </label>
                <input
                  id="edit-tx-desc"
                  type="text"
                  required
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="edit-tx-amount"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Valor (R$)
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-medium text-slate-400">
                      R$
                    </span>
                    <input
                      id="edit-tx-amount"
                      type="text"
                      inputMode="numeric"
                      required
                      value={centsToInput(editAmountCents)}
                      onChange={(e) => setEditAmountCents(digitsToCents(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-tx-date"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Data
                  </label>
                  <input
                    id="edit-tx-date"
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-tx-category"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Categoria
                </label>
                <select
                  id="edit-tx-category"
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">Sem categoria</option>
                  {editAvailableCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {editingTx.invoiceId === null && (
                <div className="space-y-2.5">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={editIsPaid}
                      onChange={(e) => setEditIsPaid(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {editingTx.type === 'income' ? 'Já recebido?' : 'Já está pago?'}
                    </span>
                  </label>

                  {editingTx.recurringId && (
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-violet-200 bg-violet-50/50 px-3.5 py-2.5">
                      <input
                        type="checkbox"
                        checked={editUpdateRecurring}
                        onChange={(e) => setEditUpdateRecurring(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-600"
                      />
                      <span className="text-xs font-medium text-slate-800">
                        Atualizar também o valor/dados padrão para os próximos meses
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  disabled={savingEdit}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Diálogo de Confirmação de Exclusão (DELETE /transactions/:id?scope=single|future) */}
      {deletingTx && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-tx-title"
        >
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="delete-tx-title" className="text-base font-semibold text-slate-900">
                    Confirmar Exclusão
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isInstallmentDelete
                      ? `Compra parcelada (${deletingTx.installmentNumber}/${deletingTx.installmentTotal})`
                      : 'Esta ação removerá o lançamento selecionado'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingTx(null)}
                disabled={deletingScope !== null}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar diálogo"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
              {deleteError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{deletingTx.description}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Valor: <strong>{formatCurrency(deletingTx.amountCents)}</strong> • Data:{' '}
                  {formatIsoDate(deletingTx.date)}
                </p>
              </div>

              {isInstallmentDelete ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-600">
                    Este lançamento faz parte de um parcelamento (parcela{' '}
                    <strong>
                      {deletingTx.installmentNumber} de {deletingTx.installmentTotal}
                    </strong>
                    ). Como deseja prosseguir?
                  </p>

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDelete('single')}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {deletingScope === 'single'
                        ? 'Excluindo parcela...'
                        : 'Excluir apenas esta parcela'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDelete('future')}
                      className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deletingScope === 'future'
                        ? 'Excluindo parcelas...'
                        : 'Excluir esta e todas as parcelas seguintes'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => setDeletingTx(null)}
                      className="w-full rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : isRecurringDelete ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-600">
                    Esta é uma <strong>Conta Recorrente / Fixa</strong>. Deseja remover apenas o
                    lançamento deste mês ou também cancelar a geração automática nos próximos meses?
                  </p>

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDelete('single')}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {deletingScope === 'single'
                        ? 'Excluindo...'
                        : 'Excluir apenas o lançamento deste mês'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDelete('future')}
                      className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deletingScope === 'future'
                        ? 'Cancelando recorrência...'
                        : 'Excluir deste mês e encerrar conta fixa futura'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => setDeletingTx(null)}
                      className="w-full rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    disabled={deletingScope !== null}
                    onClick={() => setDeletingTx(null)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={deletingScope !== null}
                    onClick={() => void handleConfirmDelete('single')}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
                  >
                    {deletingScope === 'single' ? 'Excluindo...' : 'Excluir Lançamento'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Transactions;

