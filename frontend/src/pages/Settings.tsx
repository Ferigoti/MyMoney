import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  Landmark,
  Moon,
  Palette,
  Pencil,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  createAccount,
  deleteAccount,
  downloadDatabaseBackup,
  updateAccount,
} from '../services/api';
import type { Account, AccountType } from '../types';
import {
  centsToInput,
  digitsToCents,
  formatAccountTypeLabel,
  formatCurrency,
  type AppTheme,
} from '../utils/formatters';

interface SettingsProps {
  accounts: Account[];
  theme: AppTheme;
  onThemeChange: (nextTheme: AppTheme) => void;
  onRefreshAll: () => Promise<void>;
}

function extractApiError(err: unknown, fallback: string): string {
  const data = (
    err as {
      response?: {
        data?: {
          message?: string;
          error?: string | { message?: string };
          issues?: { message?: string }[];
        };
      };
    }
  )?.response?.data;
  if (data?.issues && data.issues.length > 0) {
    return data.issues.map((i) => i.message).filter(Boolean).join(' • ');
  }
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (typeof data?.error === 'object' && data.error?.message) return data.error.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function Settings({
  accounts,
  theme,
  onThemeChange,
  onRefreshAll,
}: SettingsProps) {
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal de Conta (criação ou edição do saldo atual)
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('CHECKING');
  const [accountBalanceCents, setAccountBalanceCents] = useState(0);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountModalError, setAccountModalError] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  // Backup
  const [downloadingFormat, setDownloadingFormat] = useState<'sqlite' | 'json' | null>(null);

  // Abre o modal para cadastrar uma nova conta
  function openNewAccountModal() {
    setEditingAccountId(null);
    setAccountName('');
    setAccountType('CHECKING');
    setAccountBalanceCents(0);
    setAccountModalError(null);
    setIsAccountModalOpen(true);
  }

  // Abre o modal para editar uma conta existente (saldo atual ajustável manualmente)
  function openEditAccountModal(acc: Account) {
    setEditingAccountId(acc.id);
    setAccountName(acc.name);
    // Normaliza tipos legados em minúsculo para as opções do select
    const upper = acc.type.toUpperCase();
    setAccountType(
      (['CHECKING', 'CASH', 'BENEFIT', 'SAVINGS'].includes(upper) ? upper : 'CHECKING') as AccountType,
    );
    // Usa o saldo atual calculado pelo backend; cai para o saldo inicial se ausente
    const current = acc.currentBalanceCents ?? acc.initialBalanceCents;
    setAccountBalanceCents(current);
    setAccountModalError(null);
    setIsAccountModalOpen(true);
  }

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = accountName.trim();
    if (!trimmed) {
      setAccountModalError('Informe o nome da conta ou carteira.');
      return;
    }
    setSavingAccount(true);
    setAccountModalError(null);
    try {
      if (editingAccountId) {
        // Atualiza a conta enviando o saldo atual desejado (backend recalcula o saldo inicial)
        await updateAccount(editingAccountId, {
          name: trimmed,
          type: accountType,
          currentBalanceCents: accountBalanceCents,
        });
        await onRefreshAll();
        setFeedback({
          type: 'success',
          message: `Conta "${trimmed}" atualizada com sucesso.`,
        });
      } else {
        // Cria nova conta
        await createAccount({
          name: trimmed,
          type: accountType,
          initialBalanceCents: accountBalanceCents,
        });
        await onRefreshAll();
        setFeedback({
          type: 'success',
          message: `Conta "${trimmed}" cadastrada com sucesso.`,
        });
      }
      setIsAccountModalOpen(false);
    } catch (err) {
      const msg = extractApiError(err, editingAccountId ? 'Não foi possível atualizar a conta.' : 'Não foi possível criar a conta.');
      setAccountModalError(msg);
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleDeleteAccount(account: Account) {
    setDeletingAccountId(account.id);
    setFeedback(null);
    try {
      await deleteAccount(account.id);
      await onRefreshAll();
      setFeedback({
        type: 'success',
        message: `Conta "${account.name}" removida com sucesso.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: extractApiError(
          err,
          `Não foi possível excluir a conta "${account.name}". Verifique se há transações vinculadas.`,
        ),
      });
    } finally {
      setDeletingAccountId(null);
    }
  }

  async function handleExportBackup(format: 'sqlite' | 'json') {
    setDownloadingFormat(format);
    setFeedback(null);
    try {
      await downloadDatabaseBackup(format);
      setFeedback({
        type: 'success',
        message:
          format === 'sqlite'
            ? 'Backup do banco SQLite (.db) exportado com sucesso.'
            : 'Backup consolidado em JSON (.json) exportado com sucesso.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: extractApiError(err, 'Falha ao exportar o backup do banco de dados.'),
      });
    } finally {
      setDownloadingFormat(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Configurações</h2>
          <p className="text-sm text-slate-500">
            Gerencie suas contas bancárias, aparência do sistema e cópias de segurança dos dados.
          </p>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-lg p-1 text-current opacity-70 hover:opacity-100"
            aria-label="Fechar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 1. Contas (Corrente, Dinheiro Físico, VA/VR, Guardado/Reserva) */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Contas, Benefícios (VA/VR) e Reservas
              </h3>
              <p className="text-xs text-slate-500">
                Separe suas contas de movimentação (Corrente/Dinheiro), Vale Alimentação/Refeição e
                Dinheiro Guardado/Reserva.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openNewAccountModal}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 sm:w-auto"
          >
            <Plus className="h-4 w-4" />Nova Conta
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            Nenhuma conta cadastrada. Clique em <strong>+ Nova Conta</strong> para começar.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.map((acc) => {
              const upperType = acc.type.toUpperCase();
              const badgeColor =
                upperType === 'BENEFIT'
                  ? 'bg-amber-100 text-amber-800'
                  : upperType === 'SAVINGS'
                    ? 'bg-sky-100 text-sky-800'
                    : 'bg-emerald-100 text-emerald-800';

              return (
                <div
                  key={acc.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-2xs ring-1 ring-slate-200/70">
                        <Wallet className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-semibold text-slate-900">{acc.name}</h4>
                        <span
                          className={`mt-0.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${badgeColor}`}
                        >
                          {formatAccountTypeLabel(acc.type)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditAccountModal(acc)}
                      title="Editar conta / ajustar saldo atual"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={deletingAccountId === acc.id}
                      onClick={() => handleDeleteAccount(acc)}
                      title="Excluir conta (bloqueado caso haja transações vinculadas)"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-200/70 pt-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500">Saldo Atual</span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          (acc.currentBalanceCents ?? acc.initialBalanceCents) < 0
                            ? 'text-rose-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {formatCurrency(acc.currentBalanceCents ?? acc.initialBalanceCents)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Preferências de Aparência (Tema Claro / Escuro) */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Preferências de Aparência</h3>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                Personalize o tema visual do MyMoney entre Claro e Escuro. Sua escolha fica salva
                automaticamente neste navegador e adapta tabelas, cartões e gráficos.
              </p>
            </div>
          </div>

          <div className="inline-flex w-full items-center rounded-xl border border-slate-200 bg-slate-100 p-1 sm:w-auto sm:self-center">
            <button
              type="button"
              onClick={() => onThemeChange('light')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition sm:flex-initial ${
                theme === 'light'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sun className="h-4 w-4 text-amber-500" />
              Tema Claro
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('dark')}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition sm:flex-initial ${
                theme === 'dark'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Moon className="h-4 w-4 text-indigo-400" />
              Tema Escuro
            </button>
          </div>
        </div>
      </section>

      {/* 3. Segurança e Backup de Dados */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Segurança e Backup do Banco de Dados
              </h3>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                Seus dados ficam armazenados localmente em SQLite. Exporte uma cópia completa do
                arquivo original <code>.db</code> ou um arquivo <code>.json</code> consolidado para
                guardar onde preferir.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <button
              type="button"
              disabled={downloadingFormat !== null}
              onClick={() => handleExportBackup('sqlite')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
            >
              <Database className="h-4 w-4 text-emerald-400" />
              {downloadingFormat === 'sqlite'
                ? 'Exportando SQLite...'
                : 'Exportar Banco SQLite (.db)'}
            </button>

            <button
              type="button"
              disabled={downloadingFormat !== null}
              onClick={() => handleExportBackup('json')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
            >
              <FileJson className="h-4 w-4 text-sky-600" />
              {downloadingFormat === 'json' ? 'Exportando JSON...' : 'Exportar JSON Consolidado'}
              <Download className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      </section>

      {/* Modal: Nova Conta / Editar Conta */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingAccountId ? 'Editar Conta / Ajustar Saldo' : 'Nova Conta / Carteira'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {accountModalError && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{accountModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Nome da Conta
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex.: Itaú Corrente, Flash VA/VR, Caixinha Reserva"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Tipo de Conta
                </label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="CHECKING">Conta Corrente (Movimentação)</option>
                  <option value="CASH">Dinheiro Físico (Movimentação)</option>
                  <option value="BENEFIT">Vale Alimentação / Refeição (VA/VR)</option>
                  <option value="SAVINGS">Dinheiro Guardado / Reserva</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {editingAccountId ? 'Saldo Atual (R$)' : 'Saldo Inicial (R$)'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={centsToInput(accountBalanceCents)}
                  onChange={(e) => {
                    // Digitar "-" em qualquer posição torna o saldo negativo (cheque especial)
                    const raw = e.target.value;
                    const cents = digitsToCents(raw);
                    setAccountBalanceCents(raw.includes('-') ? -cents : cents);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 tabular-nums outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
                {editingAccountId && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Informe o saldo real da conta hoje. O sistema ajusta o saldo inicial
                    automaticamente para que o saldo atual fique exatamente com este valor, sem
                    alterar nenhum lançamento.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingAccount}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingAccount ? 'Salvando...' : editingAccountId ? 'Salvar Alterações' : 'Criar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
