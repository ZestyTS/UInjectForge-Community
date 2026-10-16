CREATE TABLE `rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`receipt` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_report_id_unique` ON `submissions` (`report_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_created` ON `submissions` (`status`,`created_at`);