import { headers } from "next/headers";
import { ensureDatabase, getD1, resultRows } from "@/db/runtime";

export const dynamic = "force-dynamic";

type ExportType = "weight" | "meals" | "training";

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const mealLabels: Record<string, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as ExportType | null;
  if (type !== "weight" && type !== "meals" && type !== "training") {
    return new Response("无效的导出类型", { status: 400 });
  }

  const requestHeaders = await headers();
  const userId =
    requestHeaders.get("oai-authenticated-user-id") ??
    (process.env.NODE_ENV === "development" ? "local-preview-owner" : null);
  if (!userId) return new Response("需要登录后才能导出", { status: 401 });

  await ensureDatabase();
  const db = getD1();
  let header: string[];
  let rows: unknown[][];

  if (type === "weight") {
    const list = resultRows(
      await db.prepare(`SELECT record_date, weight_kg, note FROM weight_entries
        WHERE user_id = ? ORDER BY record_date`).bind(userId)
        .all<{ record_date: string; weight_kg: number; note: string }>(),
    );
    header = ["日期", "体重(kg)", "备注"];
    rows = list.map((row) => [row.record_date, row.weight_kg, row.note]);
  } else if (type === "meals") {
    const list = resultRows(
      await db.prepare(`SELECT record_date, meal_type, food, calories, protein_grams, carbs_grams, fat_grams, notes, source
        FROM meal_entries WHERE user_id = ? ORDER BY record_date, created_at`).bind(userId)
        .all<{ record_date: string; meal_type: string; food: string; calories: number | null; protein_grams: number | null; carbs_grams: number | null; fat_grams: number | null; notes: string; source: string }>(),
    );
    header = ["日期", "餐次", "食物", "热量(kcal)", "蛋白质(g)", "碳水(g)", "脂肪(g)", "备注", "来源"];
    rows = list.map((row) => [row.record_date, mealLabels[row.meal_type] ?? row.meal_type, row.food, row.calories ?? "", row.protein_grams ?? "", row.carbs_grams ?? "", row.fat_grams ?? "", row.notes, row.source === "chatgpt" ? "ChatGPT" : "网页"]);
  } else {
    const list = resultRows(
      await db.prepare(`SELECT record_date, activity, duration_minutes, completed, notes, source
        FROM training_entries WHERE user_id = ? ORDER BY record_date, created_at`).bind(userId)
        .all<{ record_date: string; activity: string; duration_minutes: number | null; completed: number; notes: string; source: string }>(),
    );
    header = ["日期", "训练主题", "时长(分钟)", "是否完成", "动作与备注", "来源"];
    rows = list.map((row) => [row.record_date, row.activity, row.duration_minutes ?? "", row.completed ? "是" : "否", row.notes, row.source === "chatgpt" ? "ChatGPT" : "网页"]);
  }

  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="health-${type}.csv"`,
    },
  });
}
