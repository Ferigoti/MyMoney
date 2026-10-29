import axios from 'axios';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard as CreditCardIcon,
  Lock,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  RotateCcw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createCreditCard,
  deleteTransaction,
  fetchCardInvoice,
  payInvoice,
  unpayInvoice,
  updateCreditCard,
  updateTransaction,
} from '../services/api';
import type {
  Account,
  CardInvoiceView,
  Category,
  CreditCard,
  DeleteScope,
  InvoiceStatus,
  Transaction,
} from '../types';
import {
  centsToInput,
  formatCurrency,
  formatIsoDate,
  formatMonthLabel,
  getCurrentYearMonth,
  getTodayIsoDate,
  shiftYearMonth,
} from '../utils/formatters';

export interface CardsProps {
  cards: CreditCard[];
  accounts: Account[];
  categories: Category[];
  initialMonth?: string;
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
  return err instanceof Error ? err.message : 'Ocorreu um erro inesperado.';
}

function renderStatusBadge(status: InvoiceStatus) {
  switch (status) {
    case 'PAID':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          PAID (Paga)
        </span>
      );
    case 'CLOSED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
          <Lock className="h-3.5 w-3.5" />
          CLOSED (Fechada)
        </span>
      );
    case 'OPEN':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
          <Clock className="h-3.5 w-3.5" />
          OPEN (Aberta)
        </span>
      );
  }
}

export function Cards({
  cards,
  accounts,
  categories,
  initialMonth,
  onRefreshAll,
}: CardsProps) {
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [invoiceMonth, setInvoiceMonth] = useState<string>(
    () => initialMonth || getCurrentYearMonth(),
  );
  const [invoiceView, setInvoiceView] = useState<CardInvoiceView | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Estado do Modal de Pagamento de Fatura
  const [isPayModalOpen, setIsPayModalOpen] = useState<boolean>(false);
  const [payAccountId, setPayAccountId] = useState<string>('');
  const [paidAt, setPaidAt] = useState<string>(() => getTodayIsoDate());
  const [paying, setPaying] = useState<boolean>(false);
  const [unpaying, setUnpaying] = useState<boolean>(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Estado do Modal de Novo / Editar Cartão
  const [isNewCardModalOpen, setIsNewCardModalOpen] = useState<boolean>(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [newCardName, setNewCardName] = useState<string>('');
  const [newCardLimitCents, setNewCardLimitCents] = useState<number>(500000);
  const [newCardClosingDay, setNewCardClosingDay] = useState<number>(10);
  const [newCardDueDay, setNewCardDueDay] = useState<number>(17);
  const [newCardPaymentAccountId, setNewCardPaymentAccountId] = useState<string>('');
  const [creatingCard, setCreatingCard] = useState<boolean>(false);
  const [newCardError, setNewCardError] = useState<string | null>(null);

  // Estado do Modal de Edição de Compra / Parcela / Assinatura na Fatura
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editDescription, setEditDescription] = useState<string>('');
  const [editAmountCents, setEditAmountCents] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Estado do Diálogo de Exclusão de Compra / Parcela / Assinatura na Fatura
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deletingScope, setDeletingScope] = useState<DeleteScope | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind === 'expense'),
    [categories],
  );

  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const effectiveCardId = useMemo(() => {
    if (cards.some((c) => c.id === selectedCardId)) return selectedCardId;
    return cards[0]?.id ?? '';
  }, [cards, selectedCardId]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === effectiveCardId) ?? null,
    [cards, effectiveCardId],
  );

  const effectivePayAccountId = useMemo(() => {
    if (accounts.some((a) => a.id === payAccountId)) return payAccountId;
    if (selectedCard?.paymentAccountId && accounts.some((a) => a.id === selectedCard.paymentAccountId)) {
      return selectedCard.paymentAccountId;
    }
    return accounts[0]?.id ?? '';
  }, [accounts, payAccountId, selectedCard]);

  const loadInvoice = useCallback(async (cardId: string, month: string) => {
    if (!cardId) {
      setInvoiceView(null);
      return;
    }
    setLoadingInvoice(true);
    setError(null);
    try {
      const data = await fetchCardInvoice(cardId, month);
      setInvoiceView(data);
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setLoadingInvoice(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!effectiveCardId) return;

    fetchCardInvoice(effectiveCardId, invoiceMonth)
      .then((data) => {
        if (cancelled) return;
        setInvoiceView(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(extractApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingInvoice(false);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveCardId, invoiceMonth]);

  const changeInvoiceMonth = (nextMonth: string) => {
    if (!nextMonth || nextMonth === invoiceMonth) return;
    setLoadingInvoice(true);
    setInvoiceMonth(nextMonth);
  };

  const selectCard = (cardId: string) => {
    if (cardId === effectiveCardId) return;
    setLoadingInvoice(true);
    setSelectedCardId(cardId);
  };

  const handleOpenPayModal = () => {
    setPayError(null);
    setPaidAt(getTodayIsoDate());
    setIsPayModalOpen(true);
  };

  const handleConfirmPayInvoice = async (e: FormEvent) => {
    e.preventDefault();
    const invoice = invoiceView?.invoice;
    if (!invoice) return;

    if (!effectivePayAccountId) {
      setPayError('Selecione uma conta bancária para debitar o pagamento.');
      return;
    }

    setPaying(true);
    setPayError(null);
    try {
      await payInvoice(invoice.id, {
        accountId: effectivePayAccountId,
        paidAt,
      });
      setIsPayModalOpen(false);
      await Promise.all([
        loadInvoice(effectiveCardId, invoiceMonth),
        Promise.resolve(onRefreshAll()),
      ]);
    } catch (err) {
      setPayError(extractApiErrorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  const handleUnpayInvoice = async () => {
    const invoice = invoiceView?.invoice;
    if (!invoice || invoice.status !== 'PAID') return;

    setUnpaying(true);
    setError(null);
    try {
      await unpayInvoice(invoice.id);
      await Promise.all([
        loadInvoice(effectiveCardId, invoiceMonth),
        Promise.resolve(onRefreshAll()),
      ]);
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setUnpaying(false);
    }
  };

  const openCreateCardModal = () => {
    setEditingCard(null);
    setNewCardName('');
    setNewCardLimitCents(500000);
    setNewCardClosingDay(10);
    setNewCardDueDay(17);
    setNewCardPaymentAccountId(accounts[0]?.id ?? '');
    setNewCardError(null);
    setIsNewCardModalOpen(true);
  };

  const openEditCardModal = (card: CreditCard) => {
    setEditingCard(card);
    setNewCardName(card.name);
    setNewCardLimitCents(card.limitCents);
    setNewCardClosingDay(card.closingDay);
    setNewCardDueDay(card.dueDay);
    setNewCardPaymentAccountId(card.paymentAccountId ?? '');
    setNewCardError(null);
    setIsNewCardModalOpen(true);
  };

  const handleCreateCard = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCardName.trim()) {
      setNewCardError('Informe o nome do cartão.');
      return;
    }

    setCreatingCard(true);
    setNewCardError(null);
    try {
      if (editingCard) {
        await updateCreditCard(editingCard.id, {
          name: newCardName.trim(),
          limitCents: newCardLimitCents,
          closingDay: newCardClosingDay,
          dueDay: newCardDueDay,
          paymentAccountId: newCardPaymentAccountId ? newCardPaymentAccountId : null,
        });
        setIsNewCardModalOpen(false);
        await Promise.all([
          loadInvoice(editingCard.id, invoiceMonth),
          Promise.resolve(onRefreshAll()),
        ]);
      } else {
        const created = await createCreditCard({
          name: newCardName.trim(),
          limitCents: newCardLimitCents,
          closingDay: newCardClosingDay,
          dueDay: newCardDueDay,
          ...(newCardPaymentAccountId ? { paymentAccountId: newCardPaymentAccountId } : {}),
        });
        setNewCardName('');
        setIsNewCardModalOpen(false);
        await Promise.resolve(onRefreshAll());
        setSelectedCardId(created.id);
      }
    } catch (err) {
      setNewCardError(extractApiErrorMessage(err));
    } finally {
      setCreatingCard(false);
    }
  };

  const handleOpenEditTx = (tx: Transaction) => {
    setEditError(null);
    setEditingTx(tx);
    setEditDescription(tx.description);
    setEditAmountCents(tx.amountCents);
    setEditDate(tx.date);
    setEditCategoryId(tx.categoryId ?? '');
  };

  const handleConfirmEditTx = async (e: FormEvent) => {
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
      await updateTransaction(editingTx.id, {
        description: trimmedDesc,
        amountCents: editAmountCents,
        date: editDate,
        categoryId: editCategoryId ? editCategoryId : null,
        ...(editingTx.recurringId ? { updateRecurring: true } : {}),
      });
      setEditingTx(null);
      await Promise.all([
        loadInvoice(effectiveCardId, invoiceMonth),
        Promise.resolve(onRefreshAll()),
      ]);
    } catch (err) {
      setEditError(extractApiErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenDeleteTx = (tx: Transaction) => {
    setDeleteError(null);
    setDeletingTx(tx);
  };

  const handleConfirmDeleteTx = async (scope: DeleteScope) => {
    if (!deletingTx) return;
    setDeletingScope(scope);
    setDeleteError(null);
    try {
      await deleteTransaction(deletingTx.id, scope);
      setDeletingTx(null);
      await Promise.all([
        loadInvoice(effectiveCardId, invoiceMonth),
        Promise.resolve(onRefreshAll()),
      ]);
    } catch (err) {
      setDeleteError(extractApiErrorMessage(err));
    } finally {
      setDeletingScope(null);
    }
  };

  const isInstallmentDelete =
    deletingTx !== null &&
    deletingTx.installmentGroupId !== null &&
    deletingTx.installmentNumber !== null &&
    deletingTx.installmentTotal !== null;

  const isRecurringDelete = deletingTx !== null && Boolean(deletingTx.recurringId);

  const currentInvoice = invoiceView?.invoice ?? null;
  const invoiceTransactions = invoiceView?.transactions ?? [];
  const invoiceTotalCents = invoiceView?.totalCents ?? 0;
  const canPayInvoice =
    currentInvoice !== null &&
    (currentInvoice.status === 'OPEN' || currentInvoice.status === 'CLOSED') &&
    invoiceTotalCents > 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Secção de Cartões */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Cartões de Crédito e Gestão de Faturas
          </h2>
          <p className="text-xs text-slate-500">
            Acompanhe o limite comprometido, navegue pelas faturas futuras e realize a baixa mensal
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedCard && (
            <button
              type="button"
              onClick={() => openEditCardModal(selectedCard)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-100 sm:flex-initial"
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Editar Limite / Datas ({selectedCard.name})</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateCardModal}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 sm:flex-initial"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Novo Cartão
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-2xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <CreditCardIcon className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-900">
            Nenhum cartão de crédito cadastrado
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Cadastre o seu primeiro cartão para controlar limites, parcelamentos e faturas mensais.
          </p>
          <button
            type="button"
            onClick={() => setIsNewCardModalOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Cadastrar Cartão
          </button>
        </div>
      ) : (
        <>
          {/* Lista de Cartões com Limite Total, Gasto e Disponível */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => {
              const isSelected = card.id === effectiveCardId;
              const usedCents = card.usedCents ?? 0;
              const availableCents = card.availableCents ?? card.limitCents - usedCents;
              const usagePercent =
                card.limitCents > 0
                  ? Math.min(100, Math.max(0, Math.round((usedCents / card.limitCents) * 100)))
                  : 0;

              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => selectCard(card.id)}
                  className={`flex flex-col justify-between rounded-xl border p-5 text-left transition ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-900 shadow-2xs hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{card.name}</p>
                      <p
                        className={`mt-0.5 text-xs ${
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        Fecha dia {card.closingDay} • Vence dia {card.dueDay}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-2 ${
                        isSelected ? 'bg-white/10 text-white' : 'bg-indigo-50 text-indigo-700'
                      }`}
                    >
                      <CreditCardIcon className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Barra de uso do limite */}
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className={isSelected ? 'text-slate-300' : 'text-slate-500'}>
                        Limite utilizado ({usagePercent}%)
                      </span>
                      <span className="font-semibold">{formatCurrency(usedCents)}</span>
                    </div>

                    <div
                      className={`h-2 w-full overflow-hidden rounded-full ${
                        isSelected ? 'bg-white/15' : 'bg-slate-100'
                      }`}
                    >
                      <div
                        className={`h-full rounded-full transition-all ${
                          usagePercent >= 90
                            ? 'bg-rose-500'
                            : isSelected
                              ? 'bg-indigo-400'
                              : 'bg-indigo-600'
                        }`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1 text-xs">
                      <div>
                        <span className={isSelected ? 'text-slate-400' : 'text-slate-400'}>
                          Disponível:{' '}
                        </span>
                        <span
                          className={`font-semibold ${
                            availableCents < 0
                              ? 'text-rose-400'
                              : isSelected
                                ? 'text-emerald-300'
                                : 'text-emerald-700'
                          }`}
                        >
                          {formatCurrency(availableCents)}
                        </span>
                      </div>
                      <div>
                        <span className={isSelected ? 'text-slate-400' : 'text-slate-400'}>
                          Total:{' '}
                        </span>
                        <span className="font-medium">{formatCurrency(card.limitCents)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detalhe da Fatura do Cartão Selecionado */}
          {selectedCard && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs">
              {/* Barra Superior da Fatura: Navegador de Mês + Status + Botão Pagar */}
              <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center">
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                  {/* Navegador de Mês da Fatura */}
                  <div className="inline-flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto sm:justify-start">
                    <button
                      type="button"
                      onClick={() => changeInvoiceMonth(shiftYearMonth(invoiceMonth, -1))}
                      className="rounded-md p-1.5 text-slate-600 transition hover:bg-white hover:text-slate-900"
                      title="Fatura anterior"
                      aria-label="Fatura anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    <div className="flex items-center gap-2 px-2 py-1 sm:px-3">
                      <Calendar className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-28 text-center text-xs font-semibold text-slate-900 sm:min-w-36 sm:text-sm">
                        {formatMonthLabel(invoiceMonth, 'long')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => changeInvoiceMonth(shiftYearMonth(invoiceMonth, 1))}
                      className="rounded-md p-1.5 text-slate-600 transition hover:bg-white hover:text-slate-900"
                      title="Próxima fatura (parcelas futuras)"
                      aria-label="Próxima fatura"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Badge de Status da Fatura */}
                  {currentInvoice ? (
                    renderStatusBadge(currentInvoice.status)
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      Sem fatura gerada neste mês
                    </span>
                  )}

                  {currentInvoice && (
                    <span className="text-xs text-slate-500">
                      Fechamento: <strong>{formatIsoDate(currentInvoice.closingDate)}</strong> •
                      Vencimento: <strong>{formatIsoDate(currentInvoice.dueDate)}</strong>
                      {currentInvoice.status === 'PAID' && currentInvoice.paidAt && (
                        <>
                          {' '}
                          • Paga em <strong>{formatIsoDate(currentInvoice.paidAt)}</strong>
                          {currentInvoice.paidFromAccountId &&
                            accountsMap.get(currentInvoice.paidFromAccountId) && (
                              <>
                                {' '}
                                via{' '}
                                <strong>
                                  {accountsMap.get(currentInvoice.paidFromAccountId)?.name}
                                </strong>
                              </>
                            )}
                        </>
                      )}
                    </span>
                  )}
                </div>

                {/* Valor Total Consolidado da Fatura + Ação Pagar Fatura */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 sm:gap-4 lg:border-t-0 lg:pt-0">
                  <div className="text-left lg:text-right">
                    <span className="block text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                      Total da Fatura
                    </span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums sm:text-xl">
                      {loadingInvoice ? '...' : formatCurrency(invoiceTotalCents)}
                    </span>
                  </div>

                  {canPayInvoice && (
                    <button
                      type="button"
                      onClick={handleOpenPayModal}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700"
                    >
                      <Wallet className="h-4 w-4" />
                      Pagar Fatura
                    </button>
                  )}

                  {currentInvoice?.status === 'PAID' && (
                    <button
                      type="button"
                      onClick={handleUnpayInvoice}
                      disabled={unpaying}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 shadow-xs transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Cancela o pagamento desta fatura, reabre a fatura e estorna o lançamento de débito na conta bancária"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {unpaying ? 'Cancelando...' : 'Cancelar Pagamento'}
                    </button>
                  )}
                </div>
              </div>

              {/* Lista de Transações Vinculadas à Fatura */}
              {invoiceTransactions.length === 0 ? (
                <div className="p-8 text-center">
                  <Receipt className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-600">
                    Nenhuma compra vinculada à fatura de {formatMonthLabel(invoiceMonth, 'long')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Use as setas de mês acima para navegar entre faturas passadas ou parcelas
                    futuras.
                  </p>
                </div>
              ) : (
                <>
                  {/* Lista Mobile (< md) */}
                  <div className="divide-y divide-slate-200 md:hidden">
                    {invoiceTransactions.map((tx) => {
                      const category = tx.categoryId
                        ? categoriesMap.get(tx.categoryId)
                        : undefined;
                      const isInstallment =
                        tx.installmentNumber !== null && tx.installmentTotal !== null;

                      return (
                        <div key={tx.id} className="space-y-2.5 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-900 break-words">
                                {tx.description}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                <span>{formatIsoDate(tx.date)}</span>
                                <span>•</span>
                                <span>{category ? category.name : 'Sem categoria'}</span>
                                {isInstallment ? (
                                  <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                    Parcela {tx.installmentNumber}/{tx.installmentTotal}
                                  </span>
                                ) : tx.recurringId ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                    <Repeat className="h-2.5 w-2.5" />
                                    Assinatura
                                  </span>
                                ) : (
                                  <span className="text-slate-400">À vista</span>
                                )}
                              </div>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                              {formatCurrency(tx.amountCents)}
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditTx(tx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                              aria-label={`Editar ${tx.description}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            {currentInvoice?.status !== 'PAID' && (
                              <button
                                type="button"
                                onClick={() => handleOpenDeleteTx(tx)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
                                aria-label={`Excluir ${tx.description}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between bg-slate-50/70 px-4 py-3 text-xs font-semibold text-slate-900">
                      <span className="uppercase">Total Consolidado</span>
                      <span className="text-sm tabular-nums">{formatCurrency(invoiceTotalCents)}</span>
                    </div>
                  </div>

                  {/* Tabela Desktop (>= md) */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
                          <th className="px-5 py-3">Data da Compra</th>
                          <th className="px-5 py-3">Descrição</th>
                          <th className="px-5 py-3">Categoria</th>
                          <th className="px-5 py-3">Parcela</th>
                          <th className="px-5 py-3 text-right">Valor</th>
                          <th className="px-5 py-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {invoiceTransactions.map((tx) => {
                          const category = tx.categoryId
                            ? categoriesMap.get(tx.categoryId)
                            : undefined;
                          const isInstallment =
                            tx.installmentNumber !== null && tx.installmentTotal !== null;

                          return (
                            <tr key={tx.id} className="transition hover:bg-slate-50/80">
                              <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">
                                {formatIsoDate(tx.date)}
                              </td>

                              <td className="px-5 py-3.5 font-medium text-slate-900">
                                {tx.description}
                              </td>

                              <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">
                                {category ? category.name : 'Sem categoria'}
                              </td>

                              <td className="whitespace-nowrap px-5 py-3.5">
                                {isInstallment ? (
                                  <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/60">
                                    {tx.installmentNumber}/{tx.installmentTotal}
                                  </span>
                                ) : tx.recurringId ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200/60">
                                    <Repeat className="h-3 w-3" />
                                    Assinatura
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">À vista</span>
                                )}
                              </td>

                              <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-slate-900">
                                {formatCurrency(tx.amountCents)}
                              </td>

                              <td className="whitespace-nowrap px-5 py-3.5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditTx(tx)}
                                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                    title="Editar lançamento (ajusta automaticamente todas as parcelas/meses em aberto)"
                                    aria-label={`Editar ${tx.description}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  {currentInvoice?.status !== 'PAID' && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDeleteTx(tx)}
                                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                                      title="Excluir lançamento"
                                      aria-label={`Excluir ${tx.description}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold text-slate-900">
                          <td colSpan={4} className="px-5 py-3 text-right text-xs uppercase">
                            Valor Total Consolidado da Fatura
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-sm">
                            {formatCurrency(invoiceTotalCents)}
                          </td>
                          <td className="px-5 py-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal Rápido de Pagamento de Fatura */}
      {isPayModalOpen && currentInvoice && selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-invoice-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 id="pay-invoice-title" className="text-base font-semibold text-slate-900">
                  Pagar Fatura — {selectedCard.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Competência {formatMonthLabel(currentInvoice.month, 'long')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPayModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmPayInvoice(e)} className="space-y-4 p-6">
              {payError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{payError}</span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-xs text-slate-500">Valor total a debitar na conta</span>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {formatCurrency(invoiceTotalCents)}
                </p>
              </div>

              <div>
                <label
                  htmlFor="pay-account"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Conta bancária de origem
                </label>
                <select
                  id="pay-account"
                  required
                  value={effectivePayAccountId}
                  onChange={(e) => setPayAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pay-date" className="mb-1 block text-xs font-medium text-slate-700">
                  Data do pagamento
                </label>
                <input
                  id="pay-date"
                  type="date"
                  required
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setIsPayModalOpen(false)}
                  disabled={paying}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  {paying ? 'Confirmando...' : 'Confirmar Pagamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Cadastro de Novo Cartão */}
      {isNewCardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-card-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 id="new-card-title" className="text-base font-semibold text-slate-900">
                  {editingCard ? `Editar Cartão — ${editingCard.name}` : 'Novo Cartão de Crédito'}
                </h3>
                <p className="text-xs text-slate-500">
                  Defina o limite total e os dias de fechamento e vencimento
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewCardModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateCard(e)} className="space-y-4 p-6">
              {newCardError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{newCardError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="card-name"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Nome do Cartão
                </label>
                <input
                  id="card-name"
                  type="text"
                  required
                  placeholder="Ex.: Nubank, Itaú Click..."
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="card-limit"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Limite Total (R$)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-medium text-slate-400">
                    R$
                  </span>
                  <input
                    id="card-limit"
                    type="text"
                    inputMode="numeric"
                    required
                    value={centsToInput(newCardLimitCents)}
                    onChange={(e) => setNewCardLimitCents(digitsToCents(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3.5 pl-10 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="card-closing"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Dia de Fechamento
                  </label>
                  <input
                    id="card-closing"
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={newCardClosingDay}
                    onChange={(e) => setNewCardClosingDay(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="card-due"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Dia de Vencimento
                  </label>
                  <input
                    id="card-due"
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={newCardDueDay}
                    onChange={(e) => setNewCardDueDay(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setIsNewCardModalOpen(false)}
                  disabled={creatingCard}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingCard}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                >
                  {creatingCard
                    ? 'Salvando...'
                    : editingCard
                      ? 'Salvar Alterações'
                      : 'Salvar Cartão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Edição de Compra / Parcela / Assinatura na Fatura */}
      {editingTx && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-card-tx-title"
        >
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
              <div>
                <h3 id="edit-card-tx-title" className="text-base font-semibold text-slate-900">
                  {editingTx.installmentGroupId
                    ? `Editar Parcelamento (${editingTx.installmentNumber}/${editingTx.installmentTotal})`
                    : editingTx.recurringId
                      ? 'Editar Assinatura do Cartão'
                      : 'Editar Compra no Cartão'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingTx.installmentGroupId
                    ? 'Ajusta todas as parcelas em faturas não pagas'
                    : editingTx.recurringId
                      ? 'Ajusta todos os meses em aberto e futuros'
                      : 'Atualize descrição, valor, data ou categoria'}
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
              onSubmit={(e) => void handleConfirmEditTx(e)}
              className="space-y-4 overflow-y-auto p-4 sm:p-6"
            >
              {editError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{editError}</span>
                </div>
              )}

              {(editingTx.installmentGroupId || editingTx.recurringId) && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3.5 py-2.5 text-xs text-indigo-900">
                  {editingTx.installmentGroupId ? (
                    <>
                      As alterações feitas aqui serão aplicadas automaticamente a{' '}
                      <strong>todas as parcelas em faturas abertas/fechadas</strong> deste
                      parcelamento.
                    </>
                  ) : (
                    <>
                      As alterações feitas aqui serão aplicadas automaticamente a{' '}
                      <strong>todos os meses em aberto e às próximas faturas</strong> desta
                      assinatura.
                    </>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="edit-card-tx-desc"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Descrição
                </label>
                <input
                  id="edit-card-tx-desc"
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
                    htmlFor="edit-card-tx-amount"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    {editingTx.installmentGroupId
                      ? 'Valor da Parcela (R$)'
                      : editingTx.recurringId
                        ? 'Valor Mensal (R$)'
                        : 'Valor (R$)'}
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-medium text-slate-400">
                      R$
                    </span>
                    <input
                      id="edit-card-tx-amount"
                      type="text"
                      inputMode="numeric"
                      required
                      disabled={currentInvoice?.status === 'PAID'}
                      value={centsToInput(editAmountCents)}
                      onChange={(e) => setEditAmountCents(digitsToCents(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-card-tx-date"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    {editingTx.recurringId ? 'Data da Cobrança' : 'Data da Compra'}
                  </label>
                  <input
                    id="edit-card-tx-date"
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
                  htmlFor="edit-card-tx-category"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Categoria
                </label>
                <select
                  id="edit-card-tx-category"
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">Sem categoria</option>
                  {expenseCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

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

      {/* Diálogo de Confirmação de Exclusão na Fatura */}
      {deletingTx && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-card-tx-title"
        >
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="delete-card-tx-title" className="text-base font-semibold text-slate-900">
                    Confirmar Exclusão
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isInstallmentDelete
                      ? `Compra parcelada (${deletingTx.installmentNumber}/${deletingTx.installmentTotal})`
                      : isRecurringDelete
                        ? 'Assinatura recorrente do cartão'
                        : 'Esta ação removerá o lançamento da fatura'}
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
                      onClick={() => void handleConfirmDeleteTx('single')}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {deletingScope === 'single'
                        ? 'Excluindo parcela...'
                        : 'Excluir apenas esta parcela'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDeleteTx('future')}
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
                    Esta é uma <strong>Assinatura do Cartão</strong>. Deseja remover apenas o
                    lançamento desta fatura ou também encerrar a assinatura para os próximos meses?
                  </p>

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDeleteTx('single')}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {deletingScope === 'single'
                        ? 'Excluindo...'
                        : 'Excluir apenas desta fatura'}
                    </button>

                    <button
                      type="button"
                      disabled={deletingScope !== null}
                      onClick={() => void handleConfirmDeleteTx('future')}
                      className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deletingScope === 'future'
                        ? 'Encerrando assinatura...'
                        : 'Excluir desta fatura e encerrar assinatura futura'}
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
                    onClick={() => void handleConfirmDeleteTx('single')}
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

export default Cards;

