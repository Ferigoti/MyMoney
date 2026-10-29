export interface FeriadoNacional {
  /** 'YYYY-MM-DD' */
  date: string;
  name: string;
  type: 'fixed' | 'movable';
}

export type RecurringScheduleRule =
  | 'FIXED_DAY'
  | 'FIFTH_BUSINESS_DAY'
  | 'FIRST_BUSINESS_DAY'
  | 'LAST_BUSINESS_DAY';

export declare function getEasterSunday(year: number): string;
export declare function getFeriadosNacionais(year: number): FeriadoNacional[];
export declare function isFeriadoNacional(isoDate: string): boolean;
export declare function isDiaUtil(isoDate: string): boolean;
export declare function getNthDiaUtilDoMes(month: string, n: number): string;
export declare function getQuintoDiaUtil(month: string): string;
export declare function getPrimeiroDiaUtil(month: string): string;
export declare function getUltimoDiaUtilDoMes(month: string): string;
export declare function resolveRecurringDateForMonth(
  month: string,
  scheduleRule?: RecurringScheduleRule | string | null,
  dueDay?: number,
): string;

