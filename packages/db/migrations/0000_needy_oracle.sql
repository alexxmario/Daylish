CREATE TABLE `fasting_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`protocol` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`target_hours` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fasting_sessions_user_started_idx` ON `fasting_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`barcode` text,
	`source` text NOT NULL,
	`source_ref` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`user_submitted` integer DEFAULT false NOT NULL,
	`nutrients` text NOT NULL,
	`energy_kcal` real,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`fiber_g` real,
	`sugar_g` real,
	`sat_fat_g` real,
	`sodium_mg` real,
	`allergens` text DEFAULT '[]' NOT NULL,
	`cached_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text
);
--> statement-breakpoint
CREATE INDEX `food_items_barcode_idx` ON `food_items` (`barcode`);--> statement-breakpoint
CREATE INDEX `food_items_name_idx` ON `food_items` (`name`);--> statement-breakpoint
CREATE TABLE `food_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`food_item_id` text NOT NULL,
	`label` text NOT NULL,
	`grams` real NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `food_portions_food_idx` ON `food_portions` (`food_item_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`logged_at` text NOT NULL,
	`local_date` text NOT NULL,
	`meal_slot` text NOT NULL,
	`log_method` text NOT NULL,
	`note` text,
	`photo_uri` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_entries_user_date_idx` ON `journal_entries` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `journal_entry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`food_item_id` text,
	`recipe_id` text,
	`display_name` text NOT NULL,
	`grams` real NOT NULL,
	`portion_label` text,
	`portion_count` real,
	`nutrients` text NOT NULL,
	`energy_kcal` real,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`fiber_g` real,
	`sugar_g` real,
	`sat_fat_g` real,
	`sodium_mg` real,
	`confidence` real DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_entry_items_entry_idx` ON `journal_entry_items` (`entry_id`);--> statement-breakpoint
CREATE TABLE `meal_plan_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`local_date` text NOT NULL,
	`meal_slot` text NOT NULL,
	`recipe_id` text,
	`servings` real DEFAULT 1 NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`leftover_of_slot_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`plan_id`) REFERENCES `meal_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meal_plan_slots_plan_idx` ON `meal_plan_slots` (`plan_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start_date` text NOT NULL,
	`generated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plans_user_week_idx` ON `meal_plans` (`user_id`,`week_start_date`);--> statement-breakpoint
CREATE TABLE `mood_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_id` text,
	`logged_at` text NOT NULL,
	`local_date` text NOT NULL,
	`mood` text,
	`energy` integer,
	`hunger` integer,
	`digestion` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mood_entries_user_date_idx` ON `mood_entries` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `pantry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_item_id` text,
	`name` text NOT NULL,
	`quantity_grams` real,
	`added_at` text NOT NULL,
	`expires_on` text,
	`location` text DEFAULT 'pantry' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pantry_items_user_idx` ON `pantry_items` (`user_id`);--> statement-breakpoint
CREATE TABLE `recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`food_item_id` text,
	`name` text NOT NULL,
	`grams` real NOT NULL,
	`display_quantity` text NOT NULL,
	`preparation` text,
	`optional` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredients_recipe_idx` ON `recipe_ingredients` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_interactions_user_idx` ON `recipe_interactions` (`user_id`,`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`instruction` text NOT NULL,
	`duration_minutes` integer,
	`is_passive` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_steps_recipe_idx` ON `recipe_steps` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`cuisine` text NOT NULL,
	`meal_slots` text NOT NULL,
	`servings` integer NOT NULL,
	`prep_minutes` integer NOT NULL,
	`cook_minutes` integer NOT NULL,
	`difficulty` text NOT NULL,
	`equipment` text NOT NULL,
	`diet_styles` text NOT NULL,
	`allergens` text NOT NULL,
	`nutrients` text NOT NULL,
	`energy_kcal` real,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`fiber_g` real,
	`sugar_g` real,
	`sat_fat_g` real,
	`sodium_mg` real,
	`storage_notes` text,
	`fridge_days` integer DEFAULT 0 NOT NULL,
	`freezer_months` integer DEFAULT 0 NOT NULL,
	`prep_score` integer DEFAULT 0 NOT NULL,
	`estimated_cost_minor` integer,
	`review_state` text DEFAULT 'ai_generated' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text
);
--> statement-breakpoint
CREATE INDEX `recipes_cuisine_idx` ON `recipes` (`cuisine`);--> statement-breakpoint
CREATE INDEX `recipes_prep_score_idx` ON `recipes` (`prep_score`);--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`queued_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `sync_outbox_queued_idx` ON `sync_outbox` (`queued_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`table_name` text PRIMARY KEY NOT NULL,
	`last_pulled_at` text
);
--> statement-breakpoint
CREATE TABLE `user_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`goal` text NOT NULL,
	`diet_style` text DEFAULT 'balanced' NOT NULL,
	`rate_kg_per_week` real DEFAULT 0 NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`estimated_expenditure_kcal` real,
	`estimate_confidence` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_goals_user_from_idx` ON `user_goals` (`user_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text,
	`sex` text DEFAULT 'unspecified' NOT NULL,
	`birth_date` text,
	`height_cm` real,
	`activity_level` text DEFAULT 'moderate' NOT NULL,
	`cooking_skill` text DEFAULT 'comfortable' NOT NULL,
	`allergens` text DEFAULT '[]' NOT NULL,
	`disliked_ingredients` text DEFAULT '[]' NOT NULL,
	`equipment` text DEFAULT '[]' NOT NULL,
	`weekly_budget_minor` integer,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`max_prep_minutes` integer DEFAULT 45 NOT NULL,
	`detailed_nutrition` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`onboarded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text
);
--> statement-breakpoint
CREATE TABLE `water_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`logged_at` text NOT NULL,
	`local_date` text NOT NULL,
	`millilitres` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `water_logs_user_date_idx` ON `water_logs` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `weight_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`weight_kg` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`body_fat_percent` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weight_entries_user_date_idx` ON `weight_entries` (`user_id`,`local_date`);