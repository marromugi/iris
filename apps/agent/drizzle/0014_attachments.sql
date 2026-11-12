CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_post_id` ON `attachments` (`post_id`);