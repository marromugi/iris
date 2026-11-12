ALTER TABLE `users` ADD `mail_tag` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_mail_tag_unique` ON `users` (`mail_tag`);