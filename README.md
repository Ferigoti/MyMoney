# MyMoney — Gestão Financeira Pessoal

Sistema completo de controle financeiro pessoal (local-first) com gerenciamento de **Contas Bancárias**, **Vale Alimentação/Refeição**, **Reservas/Investimentos**, **Cartões de Crédito & Faturas**, **Compras Parceladas**, **Assinaturas e Contas Fixas Recorrentes** e **Metas de Orçamento (50-30-20)**.

---

## Sumário

1. [Arquitetura e Tecnologias](#1-arquitetura-e-tecnologias)
2. [Como Executar o Projeto](#2-como-executar-o-projeto)
3. [Banco de Dados (SQLite) — Onde Fica e Como Visualizar](#3-banco-de-dados-sqlite--onde-fica-e-como-visualizar)
4. [Estrutura das Tabelas do Banco](#4-estrutura-das-tabelas-do-banco)
5. [Principais Regras de Negócio](#5-principais-regras-de-negócio)
6. [Scripts Disponíveis](#6-scripts-disponíveis)

---

## 1. Arquitetura e Tecnologias

O projeto é organizado em um monorepo com duas aplicações (`backend` e `frontend`):

- **Backend (`/backend`)**:
  - **Node.js + TypeScript** com **Fastify 5**
  - **Banco de Dados**: **SQLite** embarcado via `better-sqlite3` (em modo `WAL` e com `foreign_keys = ON`)
  - **ORM & Query Builder**: **Drizzle ORM** + **Drizzle Kit**
  - **Validação**: **Zod**
  - **Testes Automatizados**: **Vitest**
- **Frontend (`/frontend`)**:
  - **React 19 + TypeScript + Vite**
  - **Estilização**: **Tailwind CSS v4** (com suporte a Tema Claro e Tema Escuro)
  - **Gráficos**: **Recharts**
  - **Ícones**: **Lucide React**

---

## 2. Como Executar o Projeto

Na raiz do projeto (`/home/joaoferigoti/Projetos/MyMoney`):

```bash
# 1. Instalar dependências (caso necessário)
npm install --prefix backend
npm install --prefix frontend

# 2. Iniciar Backend (porta 3333) + Frontend (porta 5173) simultaneamente
npm run dev
```

- **Frontend (Interface Web)**: http://localhost:5173
- **Backend (API REST)**: http://localhost:3333
- **Healthcheck da API**: http://localhost:3333/health

---

## 3. Banco de Dados (SQLite) — Onde Fica e Como Visualizar

**Sim, 100% das informações do sistema são salvas em um banco de dados relacional real (SQLite).** Nada fica perdido ao fechar o navegador ou reiniciar o computador.

### Localização do arquivo do banco de dados
O arquivo físico do banco fica salvo localmente em:

```text
backend/data/finance.db
```

> Também podem existir os arquivos auxiliares `finance.db-wal` e `finance.db-shm` ao lado dele (fazem parte do modo *Write-Ahead Logging* do SQLite para alta performance e segurança transacional).

---

### Opção 1: Drizzle Studio (Interface Web Visual Integrada — Recomendado)

O projeto já possui o **Drizzle Studio** configurado para abrir uma interface visual no navegador onde você pode visualizar todas as tabelas, filtrar registros, editar colunas ou adicionar linhas manualmente.

Na raiz do projeto (ou dentro de `backend/`), execute:

```bash
npm run db:studio
```

Em seguida, acesse no navegador o endereço exibido no terminal (por padrão **https://local.drizzle.studio**).

---

### Opção 2: Extensão no VS Code / Cursor / Antigravity

Você pode abrir o arquivo `backend/data/finance.db` diretamente no seu editor instalando uma extensão de SQLite:

1. Instale a extensão **SQLite Viewer** (por *Florian Klampfer*) ou **SQLite** (por *alexcvzz*).
2. No explorador de arquivos do editor, clique sobre `backend/data/finance.db`.
3. Todas as tabelas (`accounts`, `categories`, `credit_cards`, `invoices`, `transactions`, `recurring_transactions`) aparecerão em formato de planilha interativa.

---

### Opção 3: Clientes de Banco de Dados Desktop (DBeaver, Beekeeper Studio, TablePlus)

Para conectar usando um cliente SQL completo:

1. Escolha o driver **SQLite**.
2. Em **Database File / Path**, selecione o caminho completo do arquivo:
   ```text
   /home/joaoferigoti/Projetos/MyMoney/backend/data/finance.db
   ```
3. Clique em **Connect**. Você poderá rodar consultas SQL livremente e inspecionar os relacionamentos (chaves estrangeiras).

---

### Opção 4: Via Terminal (Node.js ou CLI `sqlite3`)

Caso tenha o utilitário `sqlite3` instalado no Linux:

```bash
sqlite3 backend/data/finance.db ".tables"
sqlite3 -header -column backend/data/finance.db "SELECT id, name, type, initial_balance_cents FROM accounts;"
```

Ou usando o próprio Node.js do projeto (sem precisar instalar nada extra):

```bash
node -e '
const Database = require("./backend/node_modules/better-sqlite3");
const db = new Database("./backend/data/finance.db", { readonly: true });
console.table(db.prepare("SELECT id, name, type, initial_balance_cents FROM accounts").all());
'
```

---

### Opção 5: Exportar Backup Direto pela Interface do Sistema

Na própria aplicação web:
1. Acesse a aba **Configurações** no menu superior.
2. No card **Backup de Segurança dos Dados**, clique em:
   - **Baixar SQLite (`.db`)**: baixa uma cópia íntegra e imediata do arquivo do banco de dados.
   - **Exportar JSON (`.json`)**: baixa um arquivo legível contendo todas as tabelas e registros estruturados.

---

## 4. Estrutura das Tabelas do Banco

Definida em [`backend/src/db/schema.ts`](backend/src/db/schema.ts):

| Tabela | Descrição |
| :--- | :--- |
| `accounts` | Contas cadastradas com tipo (`CHECKING` = Conta Corrente, `CASH` = Dinheiro Físico, `BENEFIT` = Vale Alimentação/Refeição, `SAVINGS` = Guardado/Reserva) e saldo inicial em centavos (`initial_balance_cents`). |
| `categories` | Categorias de receitas (`income`) e despesas (`expense`), associadas ao modelo de orçamento (`bucket`: `NEEDS` 50%, `WANTS` 30%, `SAVINGS` 20%). |
| `credit_cards` | Cartões de crédito com limite total (`limit_cents`), dia de fechamento (`closing_day`), dia de vencimento (`due_day`) e conta padrão de pagamento (`payment_account_id`). |
| `invoices` | Faturas mensais por cartão e competência (`YYYY-MM`), status (`OPEN`, `CLOSED`, `PAID`), data de pagamento (`paid_at`) e vínculo com a transação de pagamento (`payment_transaction_id`). |
| `transactions` | Todos os lançamentos financeiros (valores em centavos `amount_cents`, data `YYYY-MM-DD`, status `is_paid`, vínculo opcional com conta `account_id`, fatura de cartão `invoice_id`, grupo de parcelamento `installment_group_id` ou recorrência `recurring_id`). |
| `recurring_transactions` | Regras de assinaturas de cartão e contas/rendas fixas mensais (`description`, `amount_cents`, `type`, `due_day`, `account_id`, `card_id`, `is_active`) que são materializadas automaticamente a cada competência consultada. |

> **Nota sobre valores monetários**: Todos os valores monetários são armazenados no banco como **inteiros em centavos** (ex.: `R$ 150,00` = `15000`) para evitar qualquer erro de arredondamento de ponto flutuante (IEEE 754).

---

## 5. Principais Regras de Negócio

- **Separação de Saldos no Dashboard**:
  - **Saldo em Conta (`CHECKING` + `CASH`)**: compõe o saldo livre para gastar no mês.
  - **Vale Alimentação/Refeição (`BENEFIT`)**: exibido separadamente com saldo atual e saldo projetado de benefícios.
  - **Dinheiro Guardado/Reserva (`SAVINGS`)**: isolado do cálculo de gasto livre.
- **Extrato vs. Cartões & Faturas**:
  - O **Extrato** e a tabela da **Visão Geral** exibem apenas movimentações de conta (débito, Pix, dinheiro, boletos, receitas/despesas fixas e o pagamento de faturas).
  - Compras individuais no cartão de crédito, parcelas e assinaturas de cartão ficam concentradas em **Cartões & Faturas**.
- **Limite do Cartão de Crédito**:
  - Compras avulsas e parceladas em faturas abertas/fechadas comprometem o limite imediatamente.
  - Assinaturas recorrentes de cartão aparecem nas faturas futuras para planejamento mensal, mas **só consomem o limite do cartão quando chega a data da cobrança da assinatura**.
- **Pagamento e Cancelamento de Pagamento de Fatura**:
  - Ao pagar uma fatura (`PATCH /invoices/:id/pay`), o sistema marca a fatura como `PAID`, libera o limite do cartão e cria uma despesa de débito na conta bancária escolhida.
  - Ao cancelar o pagamento (`PATCH /invoices/:id/unpay` ou botão **"Cancelar Pagamento"** em *Cartões & Faturas*), a fatura volta para `OPEN` e a transação de débito vinculada é estornada automaticamente da conta bancária.
- **Edição de Parcelas e Assinaturas**:
  - Editar o valor, descrição ou categoria de uma parcela ou assinatura (tanto pelo Extrato quanto por *Cartões & Faturas*) propaga o ajuste automaticamente para todas as ocorrências em aberto nos demais meses.

---

## 6. Scripts Disponíveis

Na raiz do projeto (`/home/joaoferigoti/Projetos/MyMoney`):

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Inicia o servidor Backend (`:3333`) e o Frontend (`:5173`) em paralelo. |
| `npm run db:studio` | Abre o **Drizzle Studio** no navegador para visualizar e editar o banco SQLite. |
| `npm run build` | Compila o TypeScript do Backend e gera o bundle de produção do Frontend. |
| `npm test` | Executa a suíte de testes de integração e unidade do Backend (Vitest). |

