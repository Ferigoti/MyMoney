CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'checking' NOT NULL,
	`initial_balance_cents` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK("type" IN ('checking', 'savings', 'cash', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_unique` ON `accounts` (`name`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "categories_kind_check" CHECK("kind" IN ('income', 'expense'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_kind_name_unique` ON `categories` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `credit_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`limit_cents` integer NOT NULL,
	`closing_day` integer NOT NULL,
	`due_day` integer NOT NULL,
	`payment_account_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`payment_account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "credit_cards_limit_check" CHECK("credit_cards"."limit_cents" >= 0),
	CONSTRAINT "credit_cards_closing_day_check" CHECK("credit_cards"."closing_day" BETWEEN 1 AND 31),
	CONSTRAINT "credit_cards_due_day_check" CHECK("credit_cards"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_cards_name_unique` ON `credit_cards` (`name`);--> statement-breakpoint
CREATE INDEX `credit_cards_payment_account_idx` ON `credit_cards` (`payment_account_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`month` text NOT NULL,
	`closing_date` text NOT NULL,
	`due_date` text NOT NULL,
	`is_paid` integer DEFAULT false NOT NULL,
	`paid_at` text,
	`paid_from_account_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`paid_from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "invoices_month_format_check" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
	CONSTRAINT "invoices_closing_date_format_check" CHECK("closing_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "invoices_due_date_format_check" CHECK("due_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "invoices_paid_consistency_check" CHECK(("invoices"."is_paid" = 0 AND "invoices"."paid_at" IS NULL) OR ("invoices"."is_paid" = 1 AND "invoices"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_card_month_unique` ON `invoices` (`card_id`,`month`);--> statement-breakpoint
CREATE INDEX `invoices_due_date_idx` ON `invoices` (`due_date`);--> statement-breakpoint
CREATE INDEX `invoices_paid_from_account_idx` ON `invoices` (`paid_from_account_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`invoice_id` text,
	`category_id` text,
	`is_paid` integer DEFAULT false NOT NULL,
	`installment_group_id` text,
	`installment_number` integer,
	`installment_total` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "transactions_amount_positive_check" CHECK("transactions"."amount_cents" > 0),
	CONSTRAINT "transactions_type_check" CHECK("type" IN ('income', 'expense')),
	CONSTRAINT "transactions_date_format_check" CHECK("date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "transactions_single_target_check" CHECK(("transactions"."account_id" IS NOT NULL AND "transactions"."invoice_id" IS NULL) OR ("transactions"."account_id" IS NULL AND "transactions"."invoice_id" IS NOT NULL)),
	CONSTRAINT "transactions_installment_check" CHECK(("transactions"."installment_group_id" IS NULL AND "transactions"."installment_number" IS NULL AND "transactions"."installment_total" IS NULL)
        OR ("transactions"."installment_group_id" IS NOT NULL AND "transactions"."installment_total" >= 1
            AND "transactions"."installment_number" BETWEEN 1 AND "transactions"."installment_total"))
);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_invoice_idx` ON `transactions` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_installment_group_idx` ON `transactions` (`installment_group_id`);