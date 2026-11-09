CREATE TABLE `messages` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`format` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`run_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_failed_at` integer
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`cron` text NOT NULL,
	`time_zone` text NOT NULL,
	`next_run_at` integer NOT NULL
);
