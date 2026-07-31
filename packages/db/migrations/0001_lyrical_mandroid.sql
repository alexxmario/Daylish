CREATE TABLE `saved_meal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`saved_meal_id` text NOT NULL,
	`food_item_id` text,
	`display_name` text NOT NULL,
	`grams` real NOT NULL,
	`portion_label` text,
	`nutrients` text NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`saved_meal_id`) REFERENCES `saved_meals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `saved_meal_items_meal_idx` ON `saved_meal_items` (`saved_meal_id`);--> statement-breakpoint
CREATE TABLE `saved_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`meal_slot` text,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `saved_meals_user_idx` ON `saved_meals` (`user_id`);