PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category_id` text,
	`account_id` text,
	`card_id` text,
	`type` text DEFAULT 'EXPENSE' NOT NULL,
	`schedule_rule` text DEFAULT 'FIXED_DAY' NOT NULL,
	`due_day` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "recurring_transactions_amount_positive_check" CHECK("__new_recurring_transactions"."amount_cents" > 0),
	CONSTRAINT "recurring_transactions_target_check" CHECK(("__new_recurring_transactions"."account_id" IS NOT NULL AND "__new_recurring_transactions"."card_id" IS NULL) OR ("__new_recurring_transactions"."account_id" IS NULL AND "__new_recurring_transactions"."card_id" IS NOT NULL)),
	CONSTRAINT "recurring_transactions_type_check" CHECK("type" IN ('EXPENSE', 'INCOME', 'expense', 'income')),
	CONSTRAINT "recurring_transactions_schedule_rule_check" CHECK("schedule_rule" IN ('FIXED_DAY', 'FIFTH_BUSINESS_DAY', 'FIRST_BUSINESS_DAY', 'LAST_BUSINESS_DAY')),
	CONSTRAINT "recurring_transactions_due_day_check" CHECK("__new_recurring_transactions"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
INSERT INTO `__new_recurring_transactions`("id", "description", "amount_cents", "category_id", "account_id", "card_id", "type", "schedule_rule", "due_day", "is_active", "created_at") SELECT "id", "description", "amount_cents", "category_id", "account_id", NULL, "type", "schedule_rule", "due_day", "is_active", "created_at" FROM `recurring_transactions`;--> statement-breakpoint
DROP TABLE `recurring_transactions`;--> statement-breakpoint
ALTER TABLE `__new_recurring_transactions` RENAME TO `recurring_transactions`;--> statement-breakpoint
CREATE INDEX `recurring_transactions_account_idx` ON `recurring_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_transactions_card_idx` ON `recurring_transactions` (`card_id`);--> statement-breakpoint
CREATE INDEX `recurring_transactions_category_idx` ON `recurring_transactions` (`category_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;

