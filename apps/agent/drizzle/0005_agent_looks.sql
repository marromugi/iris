ALTER TABLE `agents` ADD `look_palette` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `look_seed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Agents from before looks get one at random, as an agent added without one does.
UPDATE `agents` SET `look_palette` = abs(random() % 2147483648), `look_seed` = abs(random() % 2147483648);
