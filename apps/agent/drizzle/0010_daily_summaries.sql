CREATE TABLE `daily_summaries` (
	`thread_id` text NOT NULL,
	`day` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`text` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`retry_at` integer,
	PRIMARY KEY(`thread_id`, `ends_at`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`time_zone` text NOT NULL
);
