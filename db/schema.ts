import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  heightCm: real("height_cm").notNull(),
  currentWeightKg: real("current_weight_kg").notNull(),
  shareWeight: integer("share_weight", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("idx_group_members_user_id").on(table.userId),
  ],
);

export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    email: text("email").notNull(),
    invitedBy: text("invited_by").notNull(),
    status: text("status", { enum: ["pending", "accepted"] })
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_group_invites_group_email").on(table.groupId, table.email),
    index("idx_group_invites_email_status").on(table.email, table.status),
  ],
);

export const weightEntries = sqliteTable(
  "weight_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    recordDate: text("record_date").notNull(),
    weightKg: real("weight_kg").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_weight_entries_user_date").on(
      table.userId,
      table.recordDate,
    ),
  ],
);

export const mealEntries = sqliteTable(
  "meal_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    recordDate: text("record_date").notNull(),
    mealType: text("meal_type", {
      enum: ["breakfast", "lunch", "dinner", "snack"],
    }).notNull(),
    food: text("food").notNull(),
    calories: integer("calories"),
    proteinGrams: real("protein_grams"),
    carbsGrams: real("carbs_grams"),
    fatGrams: real("fat_grams"),
    notes: text("notes").notNull().default(""),
    source: text("source", { enum: ["web", "chatgpt"] })
      .notNull()
      .default("web"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_meal_entries_user_date").on(table.userId, table.recordDate)],
);

export const trainingEntries = sqliteTable(
  "training_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    recordDate: text("record_date").notNull(),
    activity: text("activity").notNull(),
    durationMinutes: integer("duration_minutes"),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(true),
    notes: text("notes").notNull().default(""),
    source: text("source", { enum: ["web", "chatgpt"] })
      .notNull()
      .default("web"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_training_entries_user_date").on(table.userId, table.recordDate)],
);

export const trainingPlans = sqliteTable(
  "training_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    content: text("content").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    source: text("source", { enum: ["web", "chatgpt"] })
      .notNull()
      .default("web"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_training_plans_user_active").on(table.userId, table.active)],
);

export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    userId: text("user_id").notNull(),
    workoutDate: text("workout_date").notNull(),
    activity: text("activity").notNull(),
    durationMinutes: integer("duration_minutes"),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_workouts_group_date").on(table.groupId, table.workoutDate)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    userId: text("user_id").notNull(),
    purchaseDate: text("purchase_date").notNull(),
    item: text("item").notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: text("category").notNull().default("其他"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_expenses_group_date").on(table.groupId, table.purchaseDate)],
);
