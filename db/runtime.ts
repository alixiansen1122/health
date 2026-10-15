import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) throw new Error("服务器数据库暂时不可用");
  return env.DB;
}

export async function ensureDatabase(): Promise<void> {
  if (!ready) ready = createSchema().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function createSchema() {
  const db = getD1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      height_cm REAL NOT NULL,
      current_weight_kg REAL NOT NULL,
      share_weight INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS group_invites (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS weight_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS meal_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
      food TEXT NOT NULL,
      calories INTEGER,
      protein_grams REAL,
      carbs_grams REAL,
      fat_grams REAL,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'chatgpt')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS training_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      activity TEXT NOT NULL,
      duration_minutes INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'chatgpt')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS training_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web', 'chatgpt')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workout_date TEXT NOT NULL,
      activity TEXT NOT NULL,
      duration_minutes INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      item TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT '其他',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invites_group_email ON group_invites(group_id, email)`,
    `CREATE INDEX IF NOT EXISTS idx_group_invites_email_status ON group_invites(email, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_entries_user_date ON weight_entries(user_id, record_date)`,
    `CREATE INDEX IF NOT EXISTS idx_meal_entries_user_date ON meal_entries(user_id, record_date)`,
    `CREATE INDEX IF NOT EXISTS idx_training_entries_user_date ON training_entries(user_id, record_date)`,
    `CREATE INDEX IF NOT EXISTS idx_training_plans_user_active ON training_plans(user_id, active)`,
    `CREATE INDEX IF NOT EXISTS idx_workouts_group_date ON workouts(group_id, workout_date)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON expenses(group_id, purchase_date)`,
  ];

  await db.batch(statements.map((statement) => db.prepare(statement)));
}

export function resultRows<T>(result: D1Result<T>): T[] {
  return (result.results ?? []) as T[];
}
