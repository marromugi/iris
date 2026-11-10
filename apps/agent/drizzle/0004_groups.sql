CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_members` (
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	PRIMARY KEY(`thread_id`, `agent_id`)
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `post_id` text;
--> statement-breakpoint
ALTER TABLE `threads` ADD `name` text;--> statement-breakpoint
-- Each agent is the member of its own one-to-one thread.
INSERT INTO `thread_members` (`thread_id`, `agent_id`)
	SELECT `id`, `agent_id` FROM `threads` WHERE `agent_id` IS NOT NULL;
--> statement-breakpoint
-- A run a message started becomes a post, with the run's ID, and the run its reply.
INSERT INTO `posts` (`id`, `thread_id`, `text`, `created_at`)
	SELECT `runs`.`id`, `runs`.`thread_id`, json_extract(`messages`.`body`, '$.text'), `runs`.`started_at`
	FROM `runs` JOIN `messages` ON `messages`.`run_id` = `runs`.`id` AND `messages`.`seq` = 0
	WHERE `runs`.`task_id` IS NULL;
--> statement-breakpoint
UPDATE `runs` SET `post_id` = `id` WHERE `task_id` IS NULL;
