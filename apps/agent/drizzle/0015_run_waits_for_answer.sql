CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`task_id` text,
	`post_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`due_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_runs`("id", "agent_id", "thread_id", "task_id", "post_id", "started_at", "ended_at", "last_error", "failed_attempts", "due_at") SELECT "id", "agent_id", "thread_id", "task_id", "post_id", "started_at", "ended_at", "last_error", "failed_attempts", "due_at" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;