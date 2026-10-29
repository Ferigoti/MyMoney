import { z } from 'zod';

/** 'YYYY-MM-DD' e data de calendário real (rejeita 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Data inexistente no calendário');

/** Competência 'YYYY-MM'. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência deve estar no formato YYYY-MM');

export const idSchema = z.string().trim().min(1).max(64);
export const nameSchema = z.string().trim().min(1).max(100);
/** Inteiro em centavos, estritamente positivo. */
export const positiveCentsSchema = z.number().int().positive();

export const idParamsSchema = z.strictObject({ id: idSchema });

/** Data local de hoje em 'YYYY-MM-DD'. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

