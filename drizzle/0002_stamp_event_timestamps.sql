ALTER TABLE `stamp_events` ADD `timestamp_source` text DEFAULT 'slack_event' NOT NULL;--> statement-breakpoint
ALTER TABLE `stamp_events` ADD `ingested_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `stamp_events` SET `ingested_at` = `created_at` WHERE `ingested_at` = 0;