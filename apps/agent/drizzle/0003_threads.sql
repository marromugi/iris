CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_agent_id_unique` ON `threads` (`agent_id`);
--> statement-breakpoint
-- Every agent gets its own one-to-one thread, with an ID shaped like a version 4 UUID, as the
-- other IDs are.
INSERT INTO `threads` (`id`, `agent_id`, `created_at`)
	SELECT
		lower(
			hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
			|| substr('89ab', 1 + abs(random() % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
		),
		`id`,
		`created_at`
	FROM `agents`;
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`prompt` text NOT NULL,
	`cron` text NOT NULL,
	`time_zone` text NOT NULL,
	`next_run_at` integer NOT NULL
);
--> statement-breakpoint
-- An agent's tasks and runs so far happen in its one-to-one thread.
INSERT INTO `__new_tasks` (`id`, `agent_id`, `thread_id`, `prompt`, `cron`, `time_zone`, `next_run_at`)
	SELECT `tasks`.`id`, `tasks`.`agent_id`, `threads`.`id`, `prompt`, `cron`, `time_zone`, `next_run_at`
	FROM `tasks` JOIN `threads` ON `threads`.`agent_id` = `tasks`.`agent_id`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`task_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_runs` (`id`, `agent_id`, `thread_id`, `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, `due_at`)
	SELECT `runs`.`id`, `runs`.`agent_id`, `threads`.`id`, `task_id`, `started_at`, `ended_at`, `last_error`, `failed_attempts`, `due_at`
	FROM `runs` JOIN `threads` ON `threads`.`agent_id` = `runs`.`agent_id`;
--> statement-breakpoint
DROP TABLE `runs`;
--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;
