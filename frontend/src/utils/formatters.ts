const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Converte um inteiro em centavos para moeda formatada em Real ('R$ 0,00').
 * Ex.: 12345 -> 'R$ 123,45' | 0 -> 'R$ 0,00' | -500 -> '-R$ 5,00'
 */
export function formatCurrency(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  // Normaliza espaço não-quebrável do Intl para espaço comum
  return brlFormatter.format(safeCents / 100).replace(/\u00a0/g, ' ');
}

/**
 * Converte centavos inteiros para string decimal de input ('0,00').
 * Ex.: 12345 -> '123,45' | 0 -> '0,00'
 */
export function centsToInput(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = safeCents < 0 ? '-' : '';
  const abs = Math.abs(safeCents);
  const integerPart = Math.floor(abs / 100).toLocaleString('pt-BR');
  const decimalPart = String(abs % 100).padStart(2, '0');
  return `${sign}${integerPart},${decimalPart}`;
}

/**
 * Converte um valor digitado em input ('1.234,56', 'R$ 12,50', '12.50' ou dígitos)
 * para um inteiro estrito em centavos, usando parsing puro por string (sem float).
 */
export function inputToCents(val: string): number {
  const trimmed = val.trim();
  if (!trimmed) return 0;

  const isNegative = trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  let intStr: string;
  let decStr = '';

  if (cleaned.includes(',')) {
    const [rawInt = '', rawDec = ''] = cleaned.replace(/\./g, '').split(',');
    intStr = rawInt.replace(/\D/g, '');
    decStr = rawDec.replace(/\D/g, '');
  } else if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length === 2 && last.length <= 2) {
      intStr = (parts[0] ?? '').replace(/\D/g, '');
      decStr = last.replace(/\D/g, '');
    } else {
      intStr = cleaned.replace(/\D/g, '');
    }
  } else {
    intStr = cleaned.replace(/\D/g, '');
  }

  const safeInt = Number.parseInt(intStr || '0', 10);
  const paddedDec = (decStr + '00').slice(0, 2);
  const thirdDigit = decStr.length > 2 ? Number.parseInt(decStr[2]!, 10) : 0;
  let decCents = Number.parseInt(paddedDec, 10);
  if (thirdDigit >= 5) decCents += 1;

  const cents = safeInt * 100 + decCents;
  if (!Number.isSafeInteger(cents)) return 0;
  return isNegative ? -cents : cents;
}

/**
 * Converte apenas os dígitos de uma string em centavos (máscara ATM: '1250' -> 1250 centavos -> '12,50').
 * Limita a 13 dígitos (até R$ 99 bilhões) para garantir precisão inteira segura.
 */
export function digitsToCents(raw: string): number {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (!digits) return 0;
  return Number.parseInt(digits, 10);
}

const SHORT_MONTHS_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

const LONG_MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

/** Retorna o mês atual no formato 'YYYY-MM'. */
export function getCurrentYearMonth(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Retorna a data atual no formato 'YYYY-MM-DD'. */
export function getTodayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Soma ou subtrai meses de uma competência 'YYYY-MM'. */
export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yStr, mStr] = yearMonth.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return getCurrentYearMonth();

  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}`;
}

/** Formata 'YYYY-MM' como 'Novembro de 2026' ou 'Nov/26' (short). */
export function formatMonthLabel(yearMonth: string, mode: 'long' | 'short' = 'long'): string {
  const [yStr, mStr] = yearMonth.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  if (monthIndex < 0 || monthIndex > 11 || !Number.isFinite(year)) return yearMonth;

  if (mode === 'short') {
    return `${SHORT_MONTHS_PT[monthIndex]}/${String(year).slice(-2)}`;
  }
  return `${LONG_MONTHS_PT[monthIndex]} de ${year}`;
}

/** Formata 'YYYY-MM-DD' para 'DD/MM/YYYY'. */
export function formatIsoDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDateInMonth(yearMonth: string, day: number): string {
  const [yStr, mStr] = yearMonth.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const clampedDay = Math.min(Math.max(1, day), daysInCalendarMonth(year, month));
  return `${yearMonth}-${String(clampedDay).padStart(2, '0')}`;
}

function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Calcula em qual fatura (competência, fechamento e vencimento) uma compra cai,
 * seguindo o padrão dos bancos brasileiros:
 * - dia < closingDay  -> fatura que fecha neste mês
 * - dia >= closingDay -> dia de fechamento já é o melhor dia, entra na próxima fatura
 */
export function computeInvoicePeriodForPurchase(
  purchaseDate: string,
  closingDay: number,
  dueDay: number,
): { closingMonth: string; closingDate: string; dueMonth: string; dueDate: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchaseDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const currentMonth = `${match[1]}-${match[2]}`;
  const effectiveClosingDay = Math.min(closingDay, daysInCalendarMonth(year, month));
  const closingMonth = day < effectiveClosingDay ? currentMonth : shiftYearMonth(currentMonth, 1);
  const dueMonth = dueDay > closingDay ? closingMonth : shiftYearMonth(closingMonth, 1);
  return {
    closingMonth,
    closingDate: clampDateInMonth(closingMonth, closingDay),
    dueMonth,
    dueDate: clampDateInMonth(dueMonth, dueDay),
  };
}

/**
 * Retorna a janela real de compras (início e fim inclusivos) que compõem uma fatura
 * com data de fechamento `closingDate` (ex.: fecha dia 02/12 -> compras de 02/11 a 01/12).
 */
export function computeInvoiceBillingWindow(
  closingDate: string,
  closingDay: number,
): { startDate: string; endDate: string } {
  const closingMonth = closingDate.slice(0, 7);
  const prevClosingMonth = shiftYearMonth(closingMonth, -1);
  const startDate = clampDateInMonth(prevClosingMonth, closingDay);
  const endDate = shiftIsoDateDays(closingDate, -1);
  return { startDate, endDate };
}

/**
 * Calcula datas previstas de fechamento, vencimento e período de compras para uma fatura
 * com vencimento em `dueMonth` ('YYYY-MM'), mesmo antes de existir registro no banco.
 */
export function computeExpectedInvoiceForDueMonth(
  dueMonth: string,
  closingDay: number,
  dueDay: number,
): { closingDate: string; dueDate: string; startDate: string; endDate: string } {
  const closingMonth = dueDay > closingDay ? dueMonth : shiftYearMonth(dueMonth, -1);
  const closingDate = clampDateInMonth(closingMonth, closingDay);
  const dueDate = clampDateInMonth(dueMonth, dueDay);
  const { startDate, endDate } = computeInvoiceBillingWindow(closingDate, closingDay);
  return { closingDate, dueDate, startDate, endDate };
}

export function formatAccountTypeLabel(type: string): string {
  switch (type.toUpperCase()) {
    case 'CHECKING':
      return 'Conta Corrente';
    case 'CASH':
      return 'Dinheiro Físico';
    case 'BENEFIT':
      return 'Vale Alimentação / Refeição';
    case 'SAVINGS':
      return 'Guardado / Reserva';
    default:
      return 'Outra Conta';
  }
}

export type AppTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mymoney-theme';

export function getStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: AppTheme): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export interface TransferInfo {
  isTransfer: true;
  direction: 'out' | 'in';
  baseDescription: string;
  counterpartAccountName: string;
}

export function parseTransferDescription(description: string): TransferInfo | null {
  const outMatch = /^(.*)\s+\(Saída\s*→\s*(.+)\)$/i.exec(description);
  if (outMatch) {
    return {
      isTransfer: true,
      direction: 'out',
      baseDescription: outMatch[1]!.trim(),
      counterpartAccountName: outMatch[2]!.trim(),
    };
  }
  const inMatch = /^(.*)\s+\(Entrada\s*←\s*(.+)\)$/i.exec(description);
  if (inMatch) {
    return {
      isTransfer: true,
      direction: 'in',
      baseDescription: inMatch[1]!.trim(),
      counterpartAccountName: inMatch[2]!.trim(),
    };
  }
  return null;
}

export interface ConsolidatableTransaction {
  id: string;
  description: string;
  amountCents: number;
  date: string;
  accountId: string | null;
}

export interface ConsolidatedTransferFields {
  isTransfer: boolean;
  transferCleanDescription?: string;
  transferOriginAccountName?: string;
  transferDestinationAccountName?: string;
  pairedTransactionId?: string;
  transferDirection?: 'out' | 'in';
}

/**
 * Une os pares de transações de uma mesma transferência entre contas
 * (`(Saída → Destino)` e `(Entrada ← Origem)`) em um único item consolidado para exibição no extrato.
 */
export function consolidateTransferTransactions<T extends ConsolidatableTransaction>(
  items: T[],
  accountsMap: ReadonlyMap<string, { name: string }>,
): (T & ConsolidatedTransferFields)[] {
  const parsedMap = new Map<string, TransferInfo>();
  for (const item of items) {
    const info = parseTransferDescription(item.description);
    if (info) {
      parsedMap.set(item.id, info);
    }
  }

  const consumedInIds = new Set<string>();
  const pairedOutToIn = new Map<string, T>();

  for (const item of items) {
    const info = parsedMap.get(item.id);
    if (!info || info.direction !== 'out') continue;

    const matchingIn = items.find((candidate) => {
      if (candidate.id === item.id || consumedInIds.has(candidate.id)) return false;
      const candInfo = parsedMap.get(candidate.id);
      if (!candInfo || candInfo.direction !== 'in') return false;
      return (
        candidate.date === item.date &&
        candidate.amountCents === item.amountCents &&
        candInfo.baseDescription.toLowerCase() === info.baseDescription.toLowerCase()
      );
    });

    if (matchingIn) {
      consumedInIds.add(matchingIn.id);
      pairedOutToIn.set(item.id, matchingIn);
    }
  }

  const result: (T & ConsolidatedTransferFields)[] = [];

  for (const item of items) {
    if (consumedInIds.has(item.id)) {
      continue;
    }

    const info = parsedMap.get(item.id);
    if (!info) {
      result.push({ ...item, isTransfer: false });
      continue;
    }

    if (info.direction === 'out') {
      const pairedIn = pairedOutToIn.get(item.id);
      const pairedInInfo = pairedIn ? parsedMap.get(pairedIn.id) : undefined;
      const originName =
        (item.accountId ? accountsMap.get(item.accountId)?.name : undefined) ??
        pairedInInfo?.counterpartAccountName ??
        'Conta Origem';
      const destName =
        (pairedIn?.accountId ? accountsMap.get(pairedIn.accountId)?.name : undefined) ??
        info.counterpartAccountName;

      result.push({
        ...item,
        isTransfer: true,
        transferCleanDescription: info.baseDescription,
        transferOriginAccountName: originName,
        transferDestinationAccountName: destName,
        ...(pairedIn ? { pairedTransactionId: pairedIn.id } : {}),
        transferDirection: 'out',
      });
    } else {
      const originName = info.counterpartAccountName;
      const destName =
        (item.accountId ? accountsMap.get(item.accountId)?.name : undefined) ?? 'Conta Destino';

      result.push({
        ...item,
        isTransfer: true,
        transferCleanDescription: info.baseDescription,
        transferOriginAccountName: originName,
        transferDestinationAccountName: destName,
        transferDirection: 'in',
      });
    }
  }

  return result;
}


