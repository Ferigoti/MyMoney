const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');

function addUtcDays(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Algoritmo de Meeus/Jones/Butcher para calcular o Domingo de Páscoa (calendário gregoriano).
 */
export function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Retorna todos os feriados nacionais do Brasil para o ano informado (fixos + móveis).
 */
export function getFeriadosNacionais(year) {
  const y = pad4(year);
  const easter = getEasterSunday(year);

  const fixed = [
    { date: `${y}-01-01`, name: 'Confraternização Universal', type: 'fixed' },
    { date: `${y}-04-21`, name: 'Tiradentes', type: 'fixed' },
    { date: `${y}-05-01`, name: 'Dia Mundial do Trabalho', type: 'fixed' },
    { date: `${y}-09-07`, name: 'Independência do Brasil', type: 'fixed' },
    { date: `${y}-10-12`, name: 'Nossa Senhora Aparecida', type: 'fixed' },
    { date: `${y}-11-02`, name: 'Finados', type: 'fixed' },
    { date: `${y}-11-15`, name: 'Proclamação da República', type: 'fixed' },
    { date: `${y}-11-20`, name: 'Dia Nacional de Zumbi e da Consciência Negra', type: 'fixed' },
    { date: `${y}-12-25`, name: 'Natal', type: 'fixed' },
  ];

  const movable = [
    { date: addUtcDays(easter, -48), name: 'Segunda-feira de Carnaval', type: 'movable' },
    { date: addUtcDays(easter, -47), name: 'Terça-feira de Carnaval', type: 'movable' },
    { date: addUtcDays(easter, -2), name: 'Sexta-feira Santa (Paixão de Cristo)', type: 'movable' },
    { date: addUtcDays(easter, 60), name: 'Corpus Christi', type: 'movable' },
  ];

  return [...fixed, ...movable].sort((a, b) => a.date.localeCompare(b.date));
}

const cacheByYear = new Map();

function getHolidaySetForYear(year) {
  let set = cacheByYear.get(year);
  if (!set) {
    set = new Set(getFeriadosNacionais(year).map((h) => h.date));
    cacheByYear.set(year, set);
  }
  return set;
}

/**
 * Verifica se uma data 'YYYY-MM-DD' é feriado nacional brasileiro.
 */
export function isFeriadoNacional(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return getHolidaySetForYear(year).has(isoDate);
}

/**
 * Verifica se uma data 'YYYY-MM-DD' é dia útil bancário (segunda a sexta e não feriado nacional).
 */
export function isDiaUtil(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Domingo, 6 = Sábado
  if (dow === 0 || dow === 6) return false;
  return !isFeriadoNacional(isoDate);
}

/**
 * Retorna a data 'YYYY-MM-DD' correspondente ao N-ésimo dia útil da competência 'YYYY-MM'.
 */
export function getNthDiaUtilDoMes(month, n = 5) {
  const [year, m] = month.split('-').map(Number);
  const maxDay = daysInMonthUtc(year, m);
  const target = Math.max(1, Math.trunc(n));

  let businessCount = 0;
  let lastBusinessDate = `${month}-01`;

  for (let day = 1; day <= maxDay; day++) {
    const iso = `${month}-${pad2(day)}`;
    if (isDiaUtil(iso)) {
      businessCount++;
      lastBusinessDate = iso;
      if (businessCount === target) {
        return iso;
      }
    }
  }

  return lastBusinessDate;
}

export function getQuintoDiaUtil(month) {
  return getNthDiaUtilDoMes(month, 5);
}

export function getPrimeiroDiaUtil(month) {
  return getNthDiaUtilDoMes(month, 1);
}

export function getUltimoDiaUtilDoMes(month) {
  const [year, m] = month.split('-').map(Number);
  const maxDay = daysInMonthUtc(year, m);

  for (let day = maxDay; day >= 1; day--) {
    const iso = `${month}-${pad2(day)}`;
    if (isDiaUtil(iso)) {
      return iso;
    }
  }

  return `${month}-${pad2(maxDay)}`;
}

/**
 * Resolve a data exata ('YYYY-MM-DD') de uma recorrência na competência 'YYYY-MM'
 * de acordo com a regra configurada (`scheduleRule` e `dueDay`).
 */
export function resolveRecurringDateForMonth(month, scheduleRule = 'FIXED_DAY', dueDay = 1) {
  const rule = (scheduleRule || 'FIXED_DAY').toUpperCase();
  if (rule === 'FIFTH_BUSINESS_DAY') {
    return getQuintoDiaUtil(month);
  }
  if (rule === 'FIRST_BUSINESS_DAY') {
    return getPrimeiroDiaUtil(month);
  }
  if (rule === 'LAST_BUSINESS_DAY') {
    return getUltimoDiaUtilDoMes(month);
  }

  const [year, m] = month.split('-').map(Number);
  const maxDay = daysInMonthUtc(year, m);
  const safeDay = pad2(Math.min(Math.max(1, Math.trunc(dueDay || 1)), maxDay));
  return `${month}-${safeDay}`;
}

