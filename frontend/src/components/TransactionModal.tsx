import axios from 'axios';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  CreditCard as CreditCardIcon,
  Plus,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { createCreditCard, createTransaction } from '../services/api';
import type { Account, Category, CreditCard } from '../types';
import {
  centsToInput,
  formatAccountTypeLabel,
  formatCurrency,
  getTodayIsoDate,
} from '../utils/formatters';

export type TransactionModalTab = 'expense' | 'income' | 'card' | 'transfer';

export interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  categories: Category[];
  accounts: Account[];
  cards: CreditCard[];
  defaultMonth?: string;
  onCardCreated?: (card: CreditCard) => void;
}

function getDefaultDateForMonth(month?: string): string {
  const today = getTodayIsoDate();
  if (!month || today.startsWith(`${month}-`)) {
    return today;
  }
  const day = today.slice(8, 10);
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return today;
  const maxDay = new Date(y, m, 0).getDate();
  const clampedDay = String(Math.min(Number(day) || 1, maxDay)).padStart(2, '0');
  return `${month}-${clampedDay}`;
}

/**
 * Converte apenas os dígitos de uma string em centavos (máscara ATM: '1250' -> 1250 centavos -> '12,50').
 */
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
  return err instanceof Error ? err.message : 'Erro ao salvar lançamento.';
}

export function TransactionModal({
  isOpen,
  onClose,
  onSuccess,
  categories,
  accounts,
  cards,
  defaultMonth,
  onCardCreated,
}: TransactionModalProps) {
  const [activeTab, setActiveTab] = useState<TransactionModalTab>('expense');
  const [description, setDescription] = useState('');
  const [amountCents, setAmountCents] = useState<number>(0);
  const [date, setDate] = useState<string>(() => getDefaultDateForMonth(defaultMonth));
  const [categoryId, setCategoryId] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [destinationAccountId, setDestinationAccountId] = useState<string>('');
  const [cardId, setCardId] = useState<string>('');
  const [isPaid, setIsPaid] = useState<boolean>(true);
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [isInstallment, setIsInstallment] = useState<boolean>(false);
  const [installments, setInstallments] = useState<number>(2);
  const [installmentMode, setInstallmentMode] = useState<'total' | 'installment'>('total');
  const [installmentAmountCents, setInstallmentAmountCents] = useState<number>(0);

  // Estado opcional para cadastro rápido de cartão quando ainda não houver nenhum
  const [showNewCardForm, setShowNewCardForm] = useState<boolean>(false);
  const [newCardName, setNewCardName] = useState('');
  const [newCardLimitCents, setNewCardLimitCents] = useState<number>(500000);
  const [newCardClosingDay, setNewCardClosingDay] = useState<number>(10);
  const [newCardDueDay, setNewCardDueDay] = useState<number>(17);
  const [creatingCard, setCreatingCard] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const targetKind = activeTab === 'income' ? 'income' : 'expense';
    return categories.filter((c) => c.kind === targetKind);
  }, [categories, activeTab]);

  // Valores efetivos (usa o selecionado se válido ou faz fallback para o primeiro item disponível)
  const effectiveCategoryId = useMemo(() => {
    if (categoryId === '') return '';
    if (filteredCategories.some((c) => c.id === categoryId)) return categoryId;
    return filteredCategories[0]?.id ?? '';
  }, [categoryId, filteredCategories]);

  const effectiveAccountId = useMemo(() => {
    if (accounts.some((a) => a.id === accountId)) return accountId;
    return accounts[0]?.id ?? '';
  }, [accountId, accounts]);

  const effectiveDestinationAccountId = useMemo(() => {
    if (
      destinationAccountId &&
      destinationAccountId !== effectiveAccountId &&
      accounts.some((a) => a.id === destinationAccountId)
    ) {
      return destinationAccountId;
    }
    const alternative = accounts.find((a) => a.id !== effectiveAccountId);
    return alternative?.id ?? accounts[0]?.id ?? '';
  }, [destinationAccountId, effectiveAccountId, accounts]);

  const selectedAccountObj = useMemo(
    () => accounts.find((a) => a.id === effectiveAccountId),
    [accounts, effectiveAccountId],
  );

  const effectiveCardId = useMemo(() => {
    if (cards.some((c) => c.id === cardId)) return cardId;
    return cards[0]?.id ?? '';
  }, [cardId, cards]);

  const selectTab = (tab: TransactionModalTab) => {
    setActiveTab(tab);
    setError(null);
    const targetKind = tab === 'income' ? 'income' : 'expense';
    const firstCat = categories.find((c) => c.kind === targetKind);
    setCategoryId(firstCat ? firstCat.id : '');
    if (tab !== 'card') {
      setIsPaid(true);
    }
  };

  if (!isOpen) return null;

  const resetForm = () => {
    setDescription('');
    setAmountCents(0);
    setInstallmentAmountCents(0);
    setInstallmentMode('total');
    setDate(getDefaultDateForMonth(defaultMonth));
    setIsPaid(true);
    setIsRecurring(false);
    setIsInstallment(false);
    setInstallments(2);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  const handleQuickCreateCard = async () => {
    if (!newCardName.trim()) {
      setError('Informe o nome do cartão.');
      return;
    }
    setCreatingCard(true);
    setError(null);
    try {
      const created = await createCreditCard({
        name: newCardName.trim(),
        limitCents: newCardLimitCents,
        closingDay: newCardClosingDay,
        dueDay: newCardDueDay,
        ...(effectiveAccountId ? { paymentAccountId: effectiveAccountId } : {}),
      });
      onCardCreated?.(created);
      setCardId(created.id);
      setShowNewCardForm(false);
      setNewCardName('');
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setCreatingCard(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setError('Informe uma descrição para o lançamento.');
      return;
    }
    const isCardInstallment = activeTab === 'card' && isInstallment && !isRecurring;
    const effectiveTotalAmountCents =
      isCardInstallment && installmentMode === 'installment' && installmentAmountCents > 0
        ? installmentAmountCents * installments
        : amountCents;

    if (effectiveTotalAmountCents <= 0) {
      setError('O valor deve ser maior que R$ 0,00.');
      return;
    }

    setSubmitting(true);
    try {
      if (activeTab === 'transfer') {
        if (!effectiveAccountId || !effectiveDestinationAccountId) {
          setError('Selecione a conta de origem e a conta de destino.');
          setSubmitting(false);
          return;
        }
        if (effectiveAccountId === effectiveDestinationAccountId) {
          setError('A conta de origem e a conta de destino devem ser diferentes.');
          setSubmitting(false);
          return;
        }
        const originAcc = accounts.find((a) => a.id === effectiveAccountId);
        const destAcc = accounts.find((a) => a.id === effectiveDestinationAccountId);

        await createTransaction({
          description: `${trimmedDesc} (Saída → ${destAcc?.name ?? 'Destino'})`,
          amountCents: effectiveTotalAmountCents,
          type: 'expense',
          date,
          accountId: effectiveAccountId,
          isPaid: true,
        });
        await createTransaction({
          description: `${trimmedDesc} (Entrada ← ${originAcc?.name ?? 'Origem'})`,
          amountCents: effectiveTotalAmountCents,
          type: 'income',
          date,
          accountId: effectiveDestinationAccountId,
          isPaid: true,
        });
      } else if (activeTab === 'card') {
        if (!effectiveCardId) {
          setError('Selecione ou cadastre um cartão de crédito.');
          setSubmitting(false);
          return;
        }
        await createTransaction({
          description: trimmedDesc,
          amountCents: effectiveTotalAmountCents,
          date,
          cardId: effectiveCardId,
          ...(effectiveCategoryId ? { categoryId: effectiveCategoryId } : {}),
          isRecurring,
          isInstallment: isRecurring ? false : isInstallment,
          ...(!isRecurring && isInstallment ? { installments } : {}),
        });
      } else {
        if (!effectiveAccountId) {
          setError('Selecione uma conta bancária.');
          setSubmitting(false);
          return;
        }
        await createTransaction({
          description: trimmedDesc,
          amountCents,
          type: activeTab,
          date,
          accountId: effectiveAccountId,
          ...(effectiveCategoryId ? { categoryId: effectiveCategoryId } : {}),
          isPaid,
          isRecurring,
        });
      }

      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header do Modal */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0 pr-2">
            <h2 id="modal-title" className="text-base font-semibold text-slate-900">
              Novo Lançamento
            </h2>
            <p className="truncate text-xs text-slate-500">
              Registre despesas, receitas ou compras no cartão de crédito
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Seletor de Tipo com Abas */}
        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => selectTab('expense')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              activeTab === 'expense'
                ? 'bg-white text-rose-700 shadow-2xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowDownRight className="h-4 w-4" />
            Despesa
          </button>

          <button
            type="button"
            onClick={() => selectTab('income')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              activeTab === 'income'
                ? 'bg-white text-emerald-700 shadow-2xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowUpRight className="h-4 w-4" />
            Receita
          </button>

          <button
            type="button"
            onClick={() => selectTab('card')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              activeTab === 'card'
                ? 'bg-white text-indigo-700 shadow-2xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCardIcon className="h-4 w-4" />
            Cartão
          </button>

          <button
            type="button"
            onClick={() => {
              selectTab('transfer');
              if (!description) setDescription('Transferência entre contas');
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              activeTab === 'transfer'
                ? 'bg-white text-sky-700 shadow-2xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowLeftRight className="h-4 w-4" />
            Movimentar
          </button>
        </div>

        {/* Formulário */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 overflow-y-auto p-4 sm:p-6"
        >
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Descrição */}
          <div>
            <label
              htmlFor="tx-description"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Descrição
            </label>
            <input
              id="tx-description"
              type="text"
              required
              placeholder={
                activeTab === 'income'
                  ? 'Ex.: Salário mensal, Freelance...'
                  : activeTab === 'card'
                    ? 'Ex.: Supermercado, Notebook...'
                    : 'Ex.: Conta de luz, Aluguel...'
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Valor (R$) e Data */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tx-amount" className="mb-1 block text-xs font-medium text-slate-700">
                {activeTab === 'card'
                  ? isInstallment && !isRecurring
                    ? installmentMode === 'installment'
                      ? 'Valor de Cada Parcela (R$)'
                      : 'Valor Total da Compra (R$)'
                    : 'Valor da Compra (R$)'
                  : 'Valor (R$)'}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-medium text-slate-400">
                  R$
                </span>
                <input
                  id="tx-amount"
                  type="text"
                  inputMode="numeric"
                  required
                  value={
                    activeTab === 'card' && isInstallment && !isRecurring && installmentMode === 'installment'
                      ? centsToInput(installmentAmountCents)
                      : centsToInput(amountCents)
                  }
                  onChange={(e) => {
                    const cents = digitsToCents(e.target.value);
                    if (activeTab === 'card' && isInstallment && !isRecurring) {
                      if (installmentMode === 'installment') {
                        setInstallmentAmountCents(cents);
                        setAmountCents(cents * installments);
                      } else {
                        setAmountCents(cents);
                        setInstallmentAmountCents(installments >= 2 ? Math.floor(cents / installments) : cents);
                      }
                    } else {
                      setAmountCents(cents);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3.5 pl-10 text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="tx-date" className="mb-1 block text-xs font-medium text-slate-700">
                {activeTab === 'card' ? 'Data da Compra' : 'Data'}
              </label>
              <input
                id="tx-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Categoria e Conta / Cartão / Transferência */}
          {activeTab === 'transfer' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="tx-origin-account"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Conta de Origem (Saída)
                </label>
                <select
                  id="tx-origin-account"
                  required
                  value={effectiveAccountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.type)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="tx-dest-account"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Conta de Destino (Entrada)
                </label>
                <select
                  id="tx-dest-account"
                  required
                  value={effectiveDestinationAccountId}
                  onChange={(e) => setDestinationAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.type)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="tx-category"
                  className="mb-1 block text-xs font-medium text-slate-700"
                >
                  Categoria
                </label>
                <select
                  id="tx-category"
                  value={effectiveCategoryId}
                  onChange={(e) => {
                    const nextCatId = e.target.value;
                    setCategoryId(nextCatId);
                    const pickedCat = filteredCategories.find((c) => c.id === nextCatId);
                    if (pickedCat && pickedCat.name.trim().toLowerCase() === 'vale') {
                      const benefitAcc = accounts.find((a) => a.type.toUpperCase() === 'BENEFIT');
                      if (benefitAcc) {
                        setAccountId(benefitAcc.id);
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">Sem categoria</option>
                  {filteredCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {activeTab !== 'card' ? (
                <div>
                  <label
                    htmlFor="tx-account"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Conta / Carteira / VA-VR
                  </label>
                  <select
                    id="tx-account"
                    required
                    value={effectiveAccountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} — {formatAccountTypeLabel(acc.type)}
                      </option>
                    ))}
                  </select>
                  {selectedAccountObj?.type.toUpperCase() === 'BENEFIT' && (
                    <p className="mt-1 text-[11px] font-medium text-amber-700">
                      Despesa debitada do saldo de Benefício (VA/VR).
                    </p>
                  )}
                  {selectedAccountObj?.type.toUpperCase() === 'SAVINGS' && (
                    <p className="mt-1 text-[11px] font-medium text-sky-700">
                      Movimentação em conta de Reserva / Investimento.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="tx-card" className="block text-xs font-medium text-slate-700">
                      Cartão de Crédito
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewCardForm((v) => !v)}
                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      <Plus className="h-3 w-3" />
                      Novo cartão
                    </button>
                  </div>
                  <select
                    id="tx-card"
                    required={!showNewCardForm}
                    value={effectiveCardId}
                    onChange={(e) => setCardId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {cards.length === 0 && <option value="">Nenhum cartão cadastrado</option>}
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Fecha dia {c.closingDay})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Sub-formulário rápido para criar cartão caso necessário */}
          {activeTab === 'card' && (showNewCardForm || cards.length === 0) && (
            <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5">
              <p className="text-xs font-semibold text-indigo-950">Cadastrar Cartão de Crédito</p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Nome (ex.: Nubank)"
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-xs text-slate-400">
                    Limite R$
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={centsToInput(newCardLimitCents)}
                    onChange={(e) => setNewCardLimitCents(digitsToCents(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-2.5 pl-18 text-xs font-medium text-slate-900"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-600">Fechamento:</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={newCardClosingDay}
                    onChange={(e) => setNewCardClosingDay(Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-600">Vencimento:</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={newCardDueDay}
                    onChange={(e) => setNewCardDueDay(Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {cards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowNewCardForm(false)}
                    className="rounded-lg px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200/60"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  disabled={creatingCard}
                  onClick={() => void handleQuickCreateCard()}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creatingCard ? 'Salvando cartão...' : 'Salvar Cartão'}
                </button>
              </div>
            </div>
          )}

          {/* Opções específicas da aba */}
          {activeTab === 'transfer' ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-xs text-sky-900">
              Será registrada automaticamente uma saída paga na conta de origem e uma entrada paga
              na conta de destino.
            </div>
          ) : activeTab !== 'card' ? (
            <div className="space-y-2.5">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={isPaid}
                  onChange={(e) => setIsPaid(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span className="text-xs font-medium text-slate-800">
                  {activeTab === 'expense' ? 'Já está pago?' : 'Já recebido?'}
                </span>
              </label>

              <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/40 px-3.5 py-2.5">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    {activeTab === 'income'
                      ? 'É uma receita fixa / recorrente mensal?'
                      : 'É uma conta fixa / recorrente mensal?'}
                  </span>
                </label>
                {isRecurring && (
                  <p className="mt-1.5 pl-6 text-[11px] text-slate-600">
                    {activeTab === 'income' ? (
                      <>
                        Esta receita ficará marcada como <strong>Conta Recorrente</strong> no Extrato
                        (você pode editar o valor a qualquer momento) e será gerada automaticamente
                        nos próximos meses.
                      </>
                    ) : (
                      <>
                        Esta despesa ficará marcada como <strong>Conta Recorrente</strong> no Extrato
                        (você pode editar o valor a qualquer momento) e será gerada automaticamente
                        nos próximos meses.
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/40 px-3.5 py-2.5">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setIsRecurring(next);
                      if (next) setIsInstallment(false);
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    É uma assinatura / cobrança fixa mensal? (Ex.: Netflix, Spotify)
                  </span>
                </label>
                {isRecurring && (
                  <p className="mt-1.5 pl-6 text-[11px] text-slate-600">
                    Esta assinatura ficará marcada como <strong>Recorrente</strong> na fatura e no
                    Extrato e será lançada automaticamente nas faturas dos próximos meses.
                  </p>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isInstallment}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setIsInstallment(next);
                      if (next) setIsRecurring(false);
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <span className="text-xs font-medium text-slate-800">Parcelado?</span>
                </label>

                {isInstallment && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-medium text-slate-600">
                        Como você prefere informar o valor?
                      </span>
                      <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-200/60 p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setInstallmentMode('total');
                            if (installmentAmountCents > 0) {
                              setAmountCents(installmentAmountCents * installments);
                            }
                          }}
                          className={`rounded-md py-1.5 px-2 font-medium transition ${
                            installmentMode === 'total'
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Valor Total da Compra
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setInstallmentMode('installment');
                            if (amountCents > 0) {
                              setInstallmentAmountCents(Math.floor(amountCents / installments));
                            }
                          }}
                          className={`rounded-md py-1.5 px-2 font-medium transition ${
                            installmentMode === 'installment'
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Valor de Cada Parcela
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <label
                        htmlFor="tx-installments"
                        className="text-xs font-medium text-slate-700"
                      >
                        Número de parcelas:
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="tx-installments"
                          type="number"
                          min={2}
                          max={48}
                          required
                          value={installments}
                          onChange={(e) => {
                            const next = Math.max(2, Math.min(48, Number(e.target.value) || 2));
                            setInstallments(next);
                            if (installmentMode === 'installment' && installmentAmountCents > 0) {
                              setAmountCents(installmentAmountCents * next);
                            } else if (installmentMode === 'total' && amountCents > 0) {
                              setInstallmentAmountCents(Math.floor(amountCents / next));
                            }
                          }}
                          className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                        <span className="text-xs text-slate-500">vezes</span>
                      </div>
                    </div>

                    {installmentMode === 'installment' && installmentAmountCents > 0 && (
                      <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/70 p-2.5 text-xs text-indigo-950">
                        <p className="font-semibold text-indigo-900">
                          Simulação: {installments} parcelas de {formatCurrency(installmentAmountCents)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-indigo-700">
                          Total da compra: <strong>{formatCurrency(installmentAmountCents * installments)}</strong>
                        </p>
                      </div>
                    )}

                    {installmentMode === 'total' && amountCents > 0 && (() => {
                      const base = Math.floor(amountCents / installments);
                      const remainder = amountCents % installments;
                      return (
                        <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/70 p-2.5 text-xs text-indigo-950">
                          <p className="font-semibold text-indigo-900">
                            Simulação:{' '}
                            {remainder === 0 ? (
                              <span>{installments} parcelas de {formatCurrency(base)}</span>
                            ) : (
                              <span>
                                1ª parcela de {formatCurrency(base + remainder)} e {installments - 1}x de{' '}
                                {formatCurrency(base)}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-indigo-700">
                            Total da compra: <strong>{formatCurrency(amountCents)}</strong>
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rodapé de Ações */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : 'Salvar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
export default TransactionModal;
