/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

declare global {
  // Cloudflare's generated global is intentionally a marker interface.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface CloudflareEnv extends Env {}
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

const tools = [
  {
    name: "record_meal",
    title: "记录饮食",
    description: "把用户明确提供的一餐饮食写入健康与运动网站的个人饮食页。日期和餐次不明确时先询问用户。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "日期，格式 YYYY-MM-DD" },
        meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "早餐、午餐、晚餐或加餐" },
        food: { type: "string", description: "吃了什么以及份量" },
        calories: { type: "number", minimum: 0, description: "可选热量 kcal" },
        protein_grams: { type: "number", minimum: 0 },
        carbs_grams: { type: "number", minimum: 0 },
        fat_grams: { type: "number", minimum: 0 },
        notes: { type: "string" },
      },
      required: ["date", "meal_type", "food"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "record_training",
    title: "记录每日训练",
    description: "把用户个人当天的训练内容写入健康与运动网站的个人运动页。activity 只写简短训练主题；多个动作请在 notes 中按 1.动作：重量×次数×组数；2.动作：…… 的格式逐项写清，网站会拆分显示。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "日期，格式 YYYY-MM-DD" },
        activity: { type: "string", description: "简短训练主题，例如：胸+肩+三头（Push）；不要在此塞入整段动作明细" },
        duration_minutes: { type: "integer", minimum: 1, maximum: 1440 },
        completed: { type: "boolean", description: "是否已经完成，默认 true" },
        notes: { type: "string", description: "训练明细或备注；多个动作使用编号格式：1. 动作：重量×次数×组数；2. 动作：……" },
      },
      required: ["date", "activity"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "save_training_plan",
    title: "保存训练计划",
    description: "把用户确认过的阶段训练计划保存到健康与运动网站的总运动计划，并按训练日和动作拆分显示。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start_date: { type: "string", description: "开始日期，格式 YYYY-MM-DD" },
        end_date: { type: "string", description: "可选结束日期，格式 YYYY-MM-DD" },
        content: { type: "string", description: "完整训练安排。每个训练日以“第1天 | 训练主题”单独起行，动作以“1. 动作：重量×次数×组数”逐项编号" },
        replace_active: { type: "boolean", description: "是否把旧计划标记为已完成，默认 false" },
      },
      required: ["title", "start_date", "content"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "record_weight",
    title: "记录体重",
    description: "记录或更新用户某一天的体重。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "日期，格式 YYYY-MM-DD" },
        weight_kg: { type: "number", minimum: 20, maximum: 400 },
        note: { type: "string" },
      },
      required: ["date", "weight_kg"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_health_summary",
    title: "读取每日健康记录",
    description: "读取指定日期的饮食、个人训练、体重以及当前训练计划，用于总结或回答进度问题。",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "日期，格式 YYYY-MM-DD" } },
      required: ["date"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return handleMcpRequest(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const userId = request.headers.get("oai-authenticated-user-id");
  if (!userId) return rpcError(null, -32001, "需要登录 ChatGPT 后才能使用健康同步工具", 401);

  let body: JsonRpcRequest;
  try {
    body = await request.json<JsonRpcRequest>();
  } catch {
    return rpcError(null, -32700, "无效的 JSON 请求", 400);
  }
  const id = body.id ?? null;

  if (body.method === "server/discover") {
    return rpcResult(id, {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      serverInfo: { name: "health-and-fitness", version: "1.1.0" },
    });
  }
  if (body.method === "tools/list") return rpcResult(id, { tools });
  if (body.method !== "tools/call") return rpcError(id, -32601, "不支持的方法", 404);

  const name = body.params?.name;
  const args = body.params?.arguments ?? {};
  try {
    const result = await callHealthTool(env.DB, userId, name, args);
    return rpcResult(id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "工具调用失败";
    return rpcResult(id, { isError: true, content: [{ type: "text", text: message }] });
  }
}

async function callHealthTool(db: D1Database, userId: string, name: string | undefined, args: Record<string, unknown>) {
  if (name === "record_meal") {
    const date = validDateArg(args.date);
    const mealType = stringArg(args.meal_type, "餐次", 20);
    if (!["breakfast", "lunch", "dinner", "snack"].includes(mealType)) throw new Error("餐次必须是 breakfast、lunch、dinner 或 snack");
    const food = stringArg(args.food, "食物内容", 500);
    const calories = optionalNumberArg(args.calories, "热量", 0, 100000);
    const protein = optionalNumberArg(args.protein_grams, "蛋白质", 0, 10000);
    const carbs = optionalNumberArg(args.carbs_grams, "碳水", 0, 10000);
    const fat = optionalNumberArg(args.fat_grams, "脂肪", 0, 10000);
    const notes = optionalStringArg(args.notes, 300);
    const entryId = crypto.randomUUID();
    await db.prepare(`INSERT INTO meal_entries
      (id, user_id, record_date, meal_type, food, calories, protein_grams, carbs_grams, fat_grams, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chatgpt')`)
      .bind(entryId, userId, date, mealType, food, calories, protein, carbs, fat, notes).run();
    return toolResult(`已记录 ${date} 的${mealTypeLabel(mealType)}：${food}`, { id: entryId, date, meal_type: mealType, food });
  }

  if (name === "record_training") {
    const date = validDateArg(args.date);
    const activity = stringArg(args.activity, "训练内容", 200);
    const duration = optionalNumberArg(args.duration_minutes, "训练时长", 1, 1440, true);
    const completed = typeof args.completed === "boolean" ? args.completed : true;
    const notes = optionalStringArg(args.notes, 300);
    const entryId = crypto.randomUUID();
    await db.prepare(`INSERT INTO training_entries
      (id, user_id, record_date, activity, duration_minutes, completed, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'chatgpt')`)
      .bind(entryId, userId, date, activity, duration, completed ? 1 : 0, notes).run();
    return toolResult(`已记录 ${date} 的训练：${activity}`, { id: entryId, date, activity, duration_minutes: duration, completed });
  }

  if (name === "save_training_plan") {
    const title = stringArg(args.title, "计划名称", 100);
    const startDate = validDateArg(args.start_date);
    const endDate = args.end_date === undefined ? null : validDateArg(args.end_date);
    if (endDate && endDate < startDate) throw new Error("结束日期不能早于开始日期");
    const content = stringArg(args.content, "计划内容", 3000);
    const planId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    if (args.replace_active === true) {
      statements.push(db.prepare("UPDATE training_plans SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND active = 1").bind(userId));
    }
    statements.push(db.prepare(`INSERT INTO training_plans
      (id, user_id, title, start_date, end_date, content, active, source)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'chatgpt')`).bind(planId, userId, title, startDate, endDate, content));
    await db.batch(statements);
    return toolResult(`已保存训练计划“${title}”`, { id: planId, title, start_date: startDate, end_date: endDate });
  }

  if (name === "record_weight") {
    const date = validDateArg(args.date);
    const weight = numberArg(args.weight_kg, "体重", 20, 400);
    const note = optionalStringArg(args.note, 120);
    await db.batch([
      db.prepare(`INSERT INTO weight_entries (id, user_id, record_date, weight_kg, note)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, record_date) DO UPDATE SET
          weight_kg = excluded.weight_kg, note = excluded.note, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), userId, date, weight, note),
      db.prepare("UPDATE profiles SET current_weight_kg = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
        .bind(weight, userId),
    ]);
    return toolResult(`已记录 ${date} 体重 ${weight} kg`, { date, weight_kg: weight, note });
  }

  if (name === "get_health_summary") {
    const date = validDateArg(args.date);
    const [mealResult, trainingResult, weight, planResult] = await Promise.all([
      db.prepare(`SELECT meal_type, food, calories, protein_grams, carbs_grams, fat_grams, notes
        FROM meal_entries WHERE user_id = ? AND record_date = ? ORDER BY created_at`).bind(userId, date).all(),
      db.prepare(`SELECT activity, duration_minutes, completed, notes
        FROM training_entries WHERE user_id = ? AND record_date = ? ORDER BY created_at`).bind(userId, date).all(),
      db.prepare("SELECT weight_kg, note FROM weight_entries WHERE user_id = ? AND record_date = ?").bind(userId, date).first(),
      db.prepare(`SELECT title, start_date, end_date, content FROM training_plans
        WHERE user_id = ? AND active = 1 ORDER BY start_date DESC`).bind(userId).all(),
    ]);
    const summary = {
      date,
      meals: mealResult.results ?? [],
      training: trainingResult.results ?? [],
      weight: weight ?? null,
      active_plans: planResult.results ?? [],
    };
    return toolResult(`${date}：${summary.meals.length} 条饮食、${summary.training.length} 条训练、${summary.active_plans.length} 个执行中计划。`, summary);
  }

  throw new Error("未知的健康工具");
}

function toolResult(text: string, structuredContent: unknown) {
  return { content: [{ type: "text", text }], structuredContent };
}

function rpcResult(id: string | number | null, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string, status = 400) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function validDateArg(value: unknown) {
  const date = stringArg(value, "日期", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期必须使用 YYYY-MM-DD 格式");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("日期无效");
  return date;
}

function stringArg(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim().slice(0, max);
}

function optionalStringArg(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberArg(value: unknown, label: string, min: number, max: number, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}数值无效`);
  }
  return value;
}

function optionalNumberArg(value: unknown, label: string, min: number, max: number, integer = false) {
  if (value === undefined || value === null) return null;
  return numberArg(value, label, min, max, integer);
}

function mealTypeLabel(value: string) {
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as Record<string, string>)[value];
}

export default worker;
