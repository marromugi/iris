CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
-- Every user starts with one agent, and the tasks and runs from before agents become its own.
-- The ID is a version 4 UUID, as the API's paths take.
INSERT INTO `agents` (`id`, `name`, `created_at`) VALUES (
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + abs(random() % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
	),
	'エージェント',
	unixepoch() * 1000
);
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`prompt` text NOT NULL,
	`cron` text NOT NULL,
	`time_zone` text NOT NULL,
	`next_run_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `agent_id`, `prompt`, `cron`, `time_zone`, `next_run_at`)
	SELECT `id`, (SELECT `id` FROM `agents`), `prompt`, `cron`, `time_zone`, `next_run_at` FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_failed_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_runs` (`id`, `agent_id`, `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, `last_failed_at`)
	SELECT `id`, (SELECT `id` FROM `agents`), `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, `last_failed_at` FROM `runs`;
--> statement-breakpoint
DROP TABLE `runs`;
--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;
