CREATE TABLE `event_inbox` (
	`event_id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`slack_event_time` integer,
	`retry_num` integer,
	`retry_reason` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `event_inbox_status_available_at` ON `event_inbox` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `event_inbox_received_at` ON `event_inbox` (`received_at`);