CREATE TABLE `mails` (
	`id` text PRIMARY KEY NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`attachment_names` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mails_received_at` ON `mails` (`received_at`);