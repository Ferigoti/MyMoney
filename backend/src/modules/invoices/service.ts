import type { DB } from '../../db/client.js';
import type { Invoice, Transaction } from '../../db/schema.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors.js';
import { todayIso } from '../../shared/validation.js';
import { findAccountById } from '../accounts/repository.js';
import { findCreditCardById } from '../cards/repository.js';
import { materializeRecurringForMonth } from '../recurring/service.js';
import { deleteTransactionById, insertTransactions } from '../transactions/repository.js';
import { addMonths } from '../transactions/transactions.service.js';
import {
  findInvoiceByCardAndDueMonth,
  findInvoiceByCardAndMonth,
  findInvoiceById,
  listInvoiceTransactions,
  markInvoicePaid,
  markInvoiceUnpaid,
  sumInvoiceTotal,
} from './repository.js';
import type { PayInvoiceInput } from './schemas.js';

export interface CardInvoiceView {
  cardId: string;
  month: string;
  /** null quando ainda não há lançamentos nessa competência. */
  invoice: Invoice | null;
  totalCents: number;
  transactions: Transaction[];
}

export function createInvoicesService(db: DB) {
  return {
    getCardInvoice(cardId: string, month: string): CardInvoiceView {
      if (!findCreditCardById(db, cardId)) throw new NotFoundError('Cartão', cardId);

      db.transaction((tx) => {
        materializeRecurringForMonth(tx, month);
        const prevMonth = addMonths(month, -1);
        materializeRecurringForMonth(tx, prevMonth);
      });

      let invoice = findInvoiceByCardAndDueMonth(db, cardId, month);
      if (!invoice) {
        invoice = findInvoiceByCardAndMonth(db, cardId, month);
      }
      if (!invoice) return { cardId, month, invoice: null, totalCents: 0, transactions: [] };

      return {
        cardId,
        month,
        invoice,
        totalCents: sumInvoiceTotal(db, invoice.id),
        transactions: listInvoiceTransactions(db, invoice.id),
      };
    },

    /**
     * Quita a fatura: cria o débito na conta (is_paid = true) e marca a fatura
     * como PAID apontando para esse débito. Tudo em uma transação SQLite.
     */
    payInvoice(invoiceId: string, input: PayInvoiceInput): { invoice: Invoice; paymentTransaction: Transaction } {
      return db.transaction((tx) => {
        const invoice = findInvoiceById(tx, invoiceId);
        if (!invoice) throw new NotFoundError('Fatura', invoiceId);
        if (invoice.status === 'PAID') throw new ConflictError(`Fatura ${invoice.month} já está paga`);

        const account = findAccountById(tx, input.accountId);
        if (!account) throw new NotFoundError('Conta', input.accountId);
        if (account.isArchived) throw new BusinessRuleError(`Conta "${account.name}" está arquivada`);

        const card = findCreditCardById(tx, invoice.cardId);
        if (!card) throw new NotFoundError('Cartão', invoice.cardId);

        const totalCents = sumInvoiceTotal(tx, invoice.id);
        if (totalCents <= 0) throw new BusinessRuleError(`Fatura ${invoice.month} não tem valor a pagar`);

        const paidAt = input.paidAt ?? todayIso();
        const [paymentTransaction] = insertTransactions(tx, [
          {
            description: `Pagamento fatura ${card.name} ${invoice.month}`,
            amountCents: totalCents,
            type: 'expense',
            date: paidAt,
            accountId: account.id,
            invoiceId: null,
            categoryId: null,
            isPaid: true,
          },
        ]);
        if (!paymentTransaction) throw new Error('Falha ao registrar débito do pagamento');

        const updated = markInvoicePaid(tx, invoice.id, {
          paidAt,
          paidFromAccountId: account.id,
          paymentTransactionId: paymentTransaction.id,
        });

        return { invoice: updated, paymentTransaction };
      });
    },

    /**
     * Cancela o pagamento de uma fatura (reabre a fatura com status OPEN)
     * e estorna/remove a transação de pagamento na conta bancária.
     */
    unpayInvoice(invoiceId: string): { invoice: Invoice; deletedPaymentTransactionId: string | null } {
      return db.transaction((tx) => {
        const invoice = findInvoiceById(tx, invoiceId);
        if (!invoice) throw new NotFoundError('Fatura', invoiceId);
        if (invoice.status !== 'PAID') {
          throw new ConflictError(`Fatura ${invoice.month} não está marcada como paga`);
        }

        const paymentTxId = invoice.paymentTransactionId;
        const updated = markInvoiceUnpaid(tx, invoice.id);

        if (paymentTxId) {
          deleteTransactionById(tx, paymentTxId);
        }

        return { invoice: updated, deletedPaymentTransactionId: paymentTxId };
      });
    },
  };
}
