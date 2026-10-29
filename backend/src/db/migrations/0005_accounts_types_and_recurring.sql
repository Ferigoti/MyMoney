PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'checking' NOT NULL,
	`initial_balance_cents` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK("type" IN ('CHECKING', 'CASH', 'BENEFIT', 'SAVINGS', 'checking', 'savings', 'cash', 'benefit', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "name", "type", "initial_balance_cents", "is_archived", "created_at") SELECT "id", "name", "type", "initial_balance_cents", "is_archived", "created_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_unique` ON `accounts` (`name`);--> statement-breakpoint
CREATE TABLE `recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category_id` text,
	`account_id` text NOT NULL,
	`type` text DEFAULT 'EXPENSE' NOT NULL,
	`due_day` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "recurring_transactions_amount_positive_check" CHECK("recurring_transactions"."amount_cents" > 0),
	CONSTRAINT "recurring_transactions_type_check" CHECK("type" IN ('EXPENSE', 'INCOME', 'expense', 'income')),
	CONSTRAINT "recurring_transactions_due_day_check" CHECK("recurring_transactions"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX `recurring_transactions_account_idx` ON `recurring_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_transactions_category_idx` ON `recurring_transactions` (`category_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_id` text REFERENCES `recurring_transactions`(`id`) ON UPDATE cascade ON DELETE set null;--> statement-breakpoint
CREATE INDEX `transactions_recurring_idx` ON `transactions` (`recurring_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;

