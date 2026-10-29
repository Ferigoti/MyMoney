## Objetivo
Sistema local monousuário de gestão financeira pessoal (sem integrações bancárias, sem autenticação, sem multi-tenancy).

## Stack Obrigatória
- Runtime: Node.js (v20+)
- Backend: Fastify + TypeScript (strict)
- Validação: Zod
- Banco de Dados: SQLite local via better-sqlite3 + Drizzle ORM
- Testes: Vitest

## Regras Críticas de Negócio e Dados
1. **Dinheiro:** NUNCA use `number` de ponto flutuante para dinheiro. Todos os valores são inteiros representando centavos (`amount_cents: INTEGER`).
2. **Datas:** Padronizadas como strings ISO-8601 (`YYYY-MM-DD` para compras/vencimentos, `YYYY-MM` para competência de faturas).
3. **Cartão de Crédito:**
   - Compras após o `closing_day` caem automaticamente na fatura do mês seguinte.
   - Parcelamento gera N transações futuras vinculadas às respectivas faturas mensais.
   - O resto da divisão de centavos de parcelas deve ser somado na primeira parcela (ex: R$ 100,00 em 3x = 3334, 3333, 3333 centavos).
4. **Contas à Vista/Boletos:** Transações comuns usam `account_id` e flag `is_paid: BOOLEAN`. Não se vinculam a faturas.

## Arquitetura de Pastas (Backend)
- src/config/ (env, paths)
- src/db/ (schema, migrations, connection)
- src/modules/ (agrupado por domínio: transactions, invoices, categories, accounts)
  - cada módulo contém: schemas.ts (Zod), repository.ts, service.ts, routes.ts
- src/server.ts

## Estilo de Código
- Sem overengineering: nada de factories complexas, CQRS ou Clean Architecture engessada com 15 camadas.
- Repository para acesso ao Drizzle, Service para validações de negócio, Routes para Fastify/Zod.
- Fail-fast: entradas inválidas rejeitadas diretamente no schema Zod.