PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`monthly_budget_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "categories_kind_check" CHECK("kind" IN ('income', 'expense')),
	CONSTRAINT "categories_monthly_budget_check" CHECK("__new_categories"."monthly_budget_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "kind", "monthly_budget_cents", "created_at") SELECT "id", "name", "kind", 0, "created_at" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_kind_name_unique` ON `categories` (`kind`,`name`);