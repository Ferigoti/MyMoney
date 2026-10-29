import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

/**
 * Formato padrão de erro da API:
 * { statusCode, code, message, issues? }
 */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  issues?: { location?: string; path: string; message: string }[];
}

const SQLITE_CONSTRAINTS: Record<string, { statusCode: number; code: string; message: string }> = {
  SQLITE_CONSTRAINT_UNIQUE: { statusCode: 409, code: 'CONFLICT', message: 'Registro duplicado' },
  SQLITE_CONSTRAINT_PRIMARYKEY: { statusCode: 409, code: 'CONFLICT', message: 'Registro duplicado' },
  SQLITE_CONSTRAINT_FOREIGNKEY: {
    statusCode: 409,
    code: 'INTEGRITY_VIOLATION',
    message: 'Operação viola integridade referencial (registro relacionado inexistente ou em uso)',
  },
  SQLITE_CONSTRAINT_CHECK: {
    statusCode: 422,
    code: 'BUSINESS_RULE_VIOLATION',
    message: 'Dados violam uma restrição do banco',
  },
};

function sqliteCode(error: unknown): string | undefined {
  // better-sqlite3 lança SqliteError com `code`; o Drizzle pode embrulhar em `cause`.
  for (let e: unknown = error, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_')) return code;
  }
  return undefined;
}

const formatPath = (path: readonly PropertyKey[]) => path.map(String).join('.');

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const send = (body: ErrorBody) => reply.status(body.statusCode).send(body);

  // 1) Falha de validação do schema da rota (body/querystring/params).
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Requisição inválida',
      issues: error.validation.map((v) => ({
        ...(error.validationContext ? { location: error.validationContext } : {}),
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: v.message ?? 'Valor inválido',
      })),
    });
  }

  // 2) ZodError lançado fora do pipeline da rota (ex.: parse dentro de um service).
  if (error instanceof ZodError) {
    return send({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Requisição inválida',
      issues: error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    });
  }

  // 3) Erros de domínio.
  if (error instanceof AppError) {
    return send({ statusCode: error.statusCode, code: error.code, message: error.message });
  }

  // 4) Resposta não bate com o schema de resposta → bug do servidor.
  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'Falha de serialização da resposta');
    return send({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro interno' });
  }

  // 5) Restrições do SQLite que escaparam das validações do service.
  const constraint = SQLITE_CONSTRAINTS[sqliteCode(error) ?? ''];
  if (constraint) {
    request.log.warn({ err: error }, 'Violação de restrição do SQLite');
    return send(constraint);
  }

  // 6) Erros 4xx nativos do Fastify (JSON malformado, content-type, payload grande...).
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return send({ statusCode: error.statusCode, code: error.code ?? 'BAD_REQUEST', message: error.message });
  }

  request.log.error({ err: error }, 'Erro não tratado');
  return send({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro interno' });
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  const body: ErrorBody = {
    statusCode: 404,
    code: 'ROUTE_NOT_FOUND',
    message: `Rota ${request.method} ${request.url} não encontrada`,
  };
  return reply.status(404).send(body);
}

