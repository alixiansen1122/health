"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "./app-auth";
import { ensureDatabase, getD1 } from "@/db/runtime";

export type ActionState = { ok?: boolean; error?: string } | null;

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function textValue(formData: FormData, name: string, max = 200) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function numberValue(formData: FormData, name: string) {
  return Number(String(formData.get(name) ?? ""));
}

function optionalNumberValue(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function memberGroup(groupId: string, userId: string) {
  const row = await getD1()
    .prepare("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .first<{ role: string }>();
  if (!row) throw new Error("你不是该群组成员");
  return row;
}

export async function saveProfile(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const displayName = textValue(formData, "displayName", 30);
  const heightCm = numberValue(formData, "heightCm");
  const weightKg = numberValue(formData, "weightKg");
  const shareWeight = formData.get("shareWeight") === "on" ? 1 : 0;

  const heightValid = Number.isFinite(heightCm) && heightCm >= 80 && heightCm <= 250;
  const weightValid = Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 400;
  if (!displayName || !heightValid || !weightValid) return { error: "请填写有效的姓名、身高和体重" };

  const db = getD1();
  await db
    .prepare(`INSERT INTO profiles
      (user_id, email, display_name, height_cm, current_weight_kg, share_weight)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        height_cm = excluded.height_cm,
        current_weight_kg = excluded.current_weight_kg,
        share_weight = excluded.share_weight,
        updated_at = CURRENT_TIMESTAMP`)
    .bind(user.userId, user.email.toLowerCase(), displayName, heightCm, weightKg, shareWeight)
    .run();

  await db
    .prepare(`INSERT INTO weight_entries (id, user_id, record_date, weight_kg)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, record_date) DO UPDATE SET
        weight_kg = excluded.weight_kg, updated_at = CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), user.userId, today(), weightKg)
    .run();

  revalidatePath("/");
  return { ok: true };
}

export async function createGroup(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const name = textValue(formData, "name", 40);
  if (!name) return { error: "请输入群组名称" };
  const groupId = crypto.randomUUID();
  const inviteCode = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO groups (id, name, owner_id, invite_code) VALUES (?, ?, ?, ?)")
      .bind(groupId, name, user.userId, inviteCode),
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')")
      .bind(groupId, user.userId),
  ]);
  revalidatePath("/");
  redirect(`/?group=${groupId}`);
}

export async function inviteMember(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const groupId = textValue(formData, "groupId", 80);
  const email = textValue(formData, "email", 120).toLowerCase();
  const membership = await memberGroup(groupId, user.userId).catch(() => null);
  if (!membership) return { error: "你不是该群组成员" };
  if (membership.role !== "owner") return { error: "只有群主可以邀请成员" };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "请输入有效邮箱" };
  const status = await getD1().prepare(`SELECT
      (SELECT COUNT(*) FROM group_members WHERE group_id = ?) AS member_count,
      (SELECT COUNT(*) FROM group_members gm JOIN profiles p ON p.user_id = gm.user_id
        WHERE gm.group_id = ? AND lower(p.email) = lower(?)) AS already_member`)
    .bind(groupId, groupId, email)
    .first<{ member_count: number; already_member: number }>();
  if (status?.already_member) return { error: "这位朋友已经在群里了" };
  if (!status || status.member_count >= 2) return { error: "群组已有 2 位成员，无法再邀请" };
  await getD1()
    .prepare(`INSERT INTO group_invites (id, group_id, email, invited_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id, email) DO UPDATE SET status = 'pending', invited_by = excluded.invited_by`)
    .bind(crypto.randomUUID(), groupId, email, user.userId)
    .run();
  revalidatePath("/");
  return { ok: true };
}

export async function joinGroup(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const inviteCode = textValue(formData, "inviteCode", 20).toUpperCase();
  const db = getD1();
  const group = await db
    .prepare("SELECT id FROM groups WHERE invite_code = ?")
    .bind(inviteCode)
    .first<{ id: string }>();
  if (!group) return { error: "邀请码不存在" };
  const existing = await db
    .prepare("SELECT 1 AS joined FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(group.id, user.userId)
    .first();
  if (existing) {
    revalidatePath("/");
    redirect(`/?group=${group.id}`);
  }
  const joined = await db
    .prepare(`INSERT INTO group_members (group_id, user_id, role)
      SELECT ?, ?, 'member' WHERE (SELECT COUNT(*) FROM group_members WHERE group_id = ?) < 2`)
    .bind(group.id, user.userId, group.id)
    .run();
  if (!joined.meta?.changes) return { error: "该群组已有 2 位成员，无法加入" };
  revalidatePath("/");
  redirect(`/?group=${group.id}`);
}

export async function saveWeight(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const date = textValue(formData, "date", 10);
  const weightKg = numberValue(formData, "weightKg");
  const note = textValue(formData, "note", 120);
  if (!validDate(date) || !Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
    return { error: "请输入有效日期和体重" };
  }
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO weight_entries (id, user_id, record_date, weight_kg, note)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, record_date) DO UPDATE SET
        weight_kg = excluded.weight_kg, note = excluded.note, updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), user.userId, date, weightKg, note),
    db.prepare("UPDATE profiles SET current_weight_kg = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
      .bind(weightKg, user.userId),
  ]);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteWeight(formData: FormData) {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare("DELETE FROM weight_entries WHERE id = ? AND user_id = ?").bind(id, user.userId).run();
  revalidatePath("/");
}

export async function saveMeal(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/?view=health");
  await ensureDatabase();
  const date = textValue(formData, "date", 10);
  const mealType = textValue(formData, "mealType", 20);
  const food = textValue(formData, "food", 500);
  const notes = textValue(formData, "notes", 300);
  const calories = optionalNumberValue(formData, "calories");
  const proteinGrams = optionalNumberValue(formData, "proteinGrams");
  const carbsGrams = optionalNumberValue(formData, "carbsGrams");
  const fatGrams = optionalNumberValue(formData, "fatGrams");
  if (!validDate(date) || !["breakfast", "lunch", "dinner", "snack"].includes(mealType) || !food) {
    return { error: "请填写有效的日期、餐次和食物内容" };
  }
  for (const value of [calories, proteinGrams, carbsGrams, fatGrams]) {
    if (value !== null && value < 0) return { error: "营养数值不能小于 0" };
  }
  await getD1().prepare(`INSERT INTO meal_entries
    (id, user_id, record_date, meal_type, food, calories, protein_grams, carbs_grams, fat_grams, notes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')`)
    .bind(crypto.randomUUID(), user.userId, date, mealType, food, calories, proteinGrams, carbsGrams, fatGrams, notes)
    .run();
  revalidatePath("/");
  return { ok: true };
}

export async function deleteMeal(formData: FormData) {
  const user = await requireAppUser("/?view=health");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare("DELETE FROM meal_entries WHERE id = ? AND user_id = ?")
    .bind(id, user.userId).run();
  revalidatePath("/");
}

export async function saveTrainingEntry(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const date = textValue(formData, "date", 10);
  const activity = textValue(formData, "activity", 200);
  const notes = textValue(formData, "notes", 300);
  const durationMinutes = optionalNumberValue(formData, "durationMinutes");
  const completed = formData.get("completed") === "on" ? 1 : 0;
  if (!validDate(date) || !activity || (durationMinutes !== null && (durationMinutes < 1 || durationMinutes > 1440))) {
    return { error: "请填写有效的训练日期、项目和时长" };
  }
  await getD1().prepare(`INSERT INTO training_entries
    (id, user_id, record_date, activity, duration_minutes, completed, notes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'web')`)
    .bind(crypto.randomUUID(), user.userId, date, activity, durationMinutes, completed, notes)
    .run();
  revalidatePath("/");
  return { ok: true };
}

export async function toggleTrainingEntry(formData: FormData) {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare(`UPDATE training_entries
    SET completed = CASE completed WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?`)
    .bind(id, user.userId).run();
  revalidatePath("/");
}

export async function deleteTrainingEntry(formData: FormData) {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare("DELETE FROM training_entries WHERE id = ? AND user_id = ?")
    .bind(id, user.userId).run();
  revalidatePath("/");
}

export async function saveTrainingPlan(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const title = textValue(formData, "title", 100);
  const startDate = textValue(formData, "startDate", 10);
  const endDate = textValue(formData, "endDate", 10);
  const content = textValue(formData, "content", 3000);
  if (!title || !validDate(startDate) || (endDate && !validDate(endDate)) || (endDate && endDate < startDate) || !content) {
    return { error: "请填写有效的训练计划名称、日期和内容" };
  }
  await getD1().prepare(`INSERT INTO training_plans
    (id, user_id, title, start_date, end_date, content, active, source)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'web')`)
    .bind(crypto.randomUUID(), user.userId, title, startDate, endDate || null, content)
    .run();
  revalidatePath("/");
  return { ok: true };
}

export async function toggleTrainingPlan(formData: FormData) {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare(`UPDATE training_plans
    SET active = CASE active WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?`)
    .bind(id, user.userId).run();
  revalidatePath("/");
}

export async function deleteTrainingPlan(formData: FormData) {
  const user = await requireAppUser("/?view=workouts");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  await getD1().prepare("DELETE FROM training_plans WHERE id = ? AND user_id = ?")
    .bind(id, user.userId).run();
  revalidatePath("/");
}

export async function saveExpense(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  const groupId = textValue(formData, "groupId", 80);
  const payerId = textValue(formData, "payerId", 80) || user.userId;
  const date = textValue(formData, "date", 10);
  const item = textValue(formData, "item", 80);
  const category = textValue(formData, "category", 20) || "其他";
  const notes = textValue(formData, "notes", 200);
  const amount = numberValue(formData, "amount");
  const amountCents = Math.round(amount * 100);
  const membership = await memberGroup(groupId, user.userId).catch(() => null);
  if (!membership) return { error: "你不是该群组成员" };
  const payerMembership = await memberGroup(groupId, payerId).catch(() => null);
  if (!payerMembership) return { error: "消费人不是该群组成员" };
  if (!validDate(date) || !item || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > 100_000_000) {
    return { error: "请填写有效的消费日期、内容和金额" };
  }
  const db = getD1();
  if (id) {
    await db.prepare(`UPDATE expenses SET user_id = ?, purchase_date = ?, item = ?, amount_cents = ?,
      category = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ?`)
      .bind(payerId, date, item, amountCents, category, notes, id, groupId).run();
  } else {
    await db.prepare(`INSERT INTO expenses
      (id, group_id, user_id, purchase_date, item, amount_cents, category, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), groupId, payerId, date, item, amountCents, category, notes, user.userId).run();
  }
  revalidatePath("/");
  return { ok: true };
}

export async function deleteExpense(formData: FormData) {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const id = textValue(formData, "id", 80);
  const groupId = textValue(formData, "groupId", 80);
  await memberGroup(groupId, user.userId);
  await getD1().prepare("DELETE FROM expenses WHERE id = ? AND group_id = ?").bind(id, groupId).run();
  revalidatePath("/");
}
