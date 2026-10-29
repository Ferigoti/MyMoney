PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`month` text NOT NULL,
	`closing_date` text NOT NULL,
	`due_date` text NOT NULL,
	`is_paid` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`paid_at` text,
	`paid_from_account_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`paid_from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "invoices_month_format_check" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
	CONSTRAINT "invoices_closing_date_format_check" CHECK("closing_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "invoices_due_date_format_check" CHECK("due_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "invoices_status_check" CHECK("status" IN ('OPEN', 'CLOSED', 'PAID')),
	CONSTRAINT "invoices_paid_consistency_check" CHECK(("__new_invoices"."status" = 'PAID' AND "__new_invoices"."paid_at" IS NOT NULL) OR ("__new_invoices"."status" <> 'PAID' AND "__new_invoices"."paid_at" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_invoices`("id", "card_id", "month", "closing_date", "due_date", "is_paid", "status", "paid_at", "paid_from_account_id", "created_at") SELECT "id", "card_id", "month", "closing_date", "due_date", "is_paid", CASE WHEN "is_paid" = 1 THEN 'PAID' ELSE 'OPEN' END, "paid_at", "paid_from_account_id", "created_at" FROM `invoices`;--> statement-breakpoint
DROP TABLE `invoices`;--> statement-breakpoint
ALTER TABLE `__new_invoices` RENAME TO `invoices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_card_month_unique` ON `invoices` (`card_id`,`month`);--> statement-breakpoint
CREATE INDEX `invoices_due_date_idx` ON `invoices` (`due_date`);--> statement-breakpoint
CREATE INDEX `invoices_paid_from_account_idx` ON `invoices` (`paid_from_account_id`);