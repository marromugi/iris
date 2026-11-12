CREATE TABLE `mail_setup` (
	`id` integer PRIMARY KEY NOT NULL,
	`confirmation_url` text,
	`confirmation_code` text,
	`confirmation_at` integer,
	`last_mail_at` integer
);
