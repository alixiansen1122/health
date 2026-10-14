CREATE TABLE `meal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`record_date` text NOT NULL,
	`meal_type` text NOT NULL,
	`food` text NOT NULL,
	`calories` integer,
	`protein_grams` real,
	`carbs_grams` real,
	`fat_grams` real,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meal_entries_user_date` ON `meal_entries` (`user_id`,`record_date`);--> statement-breakpoint
CREATE TABLE `training_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`record_date` text NOT NULL,
	`activity` text NOT NULL,
	`duration_minutes` integer,
	`completed` integer DEFAULT true NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_training_entries_user_date` ON `training_entries` (`user_id`,`record_date`);--> statement-breakpoint
CREATE TABLE `training_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`content` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_training_plans_user_active` ON `training_plans` (`user_id`,`active`);