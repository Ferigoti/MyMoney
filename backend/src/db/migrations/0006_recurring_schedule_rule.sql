ALTER TABLE `recurring_transactions` ADD `schedule_rule` text DEFAULT 'FIXED_DAY' NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `categories` (`id`, `name`, `kind`, `monthly_budget_cents`)
SELECT lower(hex(randomblob(16))), 'Vale', 'income', 0
WHERE EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'Salário' AND `kind` = 'income');

