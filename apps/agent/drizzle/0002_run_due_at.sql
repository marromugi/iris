CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL
);
--> statement-breakpoint
-- A run that hasn't ended is due when it was due before: five minutes (the retry delay) after it
-- last failed, or after it started if it never failed.
INSERT INTO `__new_runs` (`id`, `agent_id`, `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, `due_at`)
	SELECT `id`, `agent_id`, `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, coalesce(`last_failed_at`, `started_at`) + 300000 FROM `runs`;
--> statement-breakpoint
DROP TABLE `runs`;
--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;
