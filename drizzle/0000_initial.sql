CREATE TABLE `actors` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`image_url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ref` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`pr_url` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_dedupe_key_unique` ON `requests` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `requests_occurred_at` ON `requests` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `stamp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`giver_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`stamp_count` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`source` text NOT NULL,
	`channel_id` text,
	`pr_url` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stamp_events_dedupe_key_unique` ON `stamp_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `stamp_events_occurred_at` ON `stamp_events` (`occurred_at`);