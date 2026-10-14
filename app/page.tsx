import type { Metadata } from "next";
import Link from "next/link";
import { requireAppUser } from "./app-auth";
import { chatGPTSignOutPath } from "./chatgpt-auth";
import { ensureDatabase, getD1, resultRows } from "@/db/runtime";
import {
  createGroup,
  deleteMeal,
  deleteExpense,
  deleteTrainingEntry,
  deleteTrainingPlan,
  deleteWeight,
  inviteMember,
  joinGroup,
  saveExpense,
  saveMeal,
  saveProfile,
  saveTrainingEntry,
  saveTrainingPlan,
  saveWeight,
  toggleTrainingEntry,
  toggleTrainingPlan,
} from "./actions";
import { ExpenseBars, WeightChart } from "./charts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "健康与运动",
  description: "个人饮食、运动计划与每日健康记录。",
};

type Profile = {
  user_id: string;
  email: string;
  display_name: string;
  height_cm: number;
  current_weight_kg: number;
  share_weight: number;
};
type Group = { id: string; name: string; owner_id: string; invite_code: string; role: string };
type Member = Profile & { role: string };
type Weight = { id: string; record_date: string; weight_kg: number; note: string };
type Expense = {
  id: string; group_id: string; user_id: string; purchase_date: string; item: string;
  amount_cents: number; category: string; notes: string; display_name: string;
};
type Meal = {
  id: string; record_date: string; meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  food: string; calories: number | null; protein_grams: number | null; carbs_grams: number | null;
  fat_grams: number | null; notes: string; source: "web" | "chatgpt";
};
type TrainingEntry = {
  id: string; record_date: string; activity: string; duration_minutes: number | null;
  completed: number; notes: string; source: "web" | "chatgpt";
};
type TrainingPlan = {
  id: string; title: string; start_date: string; end_date: string | null;
  content: string; active: number; source: "web" | "chatgpt";
};

const navItems = [
  ["home", "⌂", "首页"],
  ["weight", "↗", "体重"],
  ["workouts", "◫", "运动"],
  ["health", "✦", "饮食"],
  ["expenses", "¥", "消费"],
  ["group", "◎", "群组"],
] as const;

function queryLink(view: string, groupId?: string, date?: string) {
  const params = new URLSearchParams();
  if (view !== "home") params.set("view", view);
  if (groupId) params.set("group", groupId);
  if (date && (view === "workouts" || view === "health")) params.set("date", date);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function chinaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function mondayOfValue(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  return addDays(value, 1 - day);
}

function safeDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ? value : fallback;
}

function weekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

type ExerciseDisplay = { name: string; detail: string };
type ParsedNumberedText = { intro: string; exercises: ExerciseDisplay[]; outro: string };
type PlanDayDisplay = { label: string; title: string; exercises: ExerciseDisplay[]; points: string[] };

function cleanTrainingText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function trimTrainingPunctuation(value: string) {
  return value.trim().replace(/^[：:；;、，,。\s]+|[；;。\s]+$/g, "");
}

function exerciseParts(value: string): ExerciseDisplay {
  const cleaned = trimTrainingPunctuation(value);
  const explicit = cleaned.match(/^(.{2,32}?)[：:]\s*(.+)$/);
  if (explicit) return { name: explicit[1].trim(), detail: explicit[2].trim() };
  const metric = cleaned.match(/^(.{2,32}?)(?=\s*(?:每只|自重|空杆|器械(?:标示)?|\d+(?:\.\d+)?\s*(?:kg|公斤|次|组|分钟|秒|米|公里)|[×xX]\s*\d))/i);
  if (!metric) return { name: cleaned, detail: "" };
  const name = metric[1].trim();
  return { name, detail: cleaned.slice(metric[1].length).trim() };
}

function parseNumberedText(value: string): ParsedNumberedText {
  const normalized = cleanTrainingText(value)
    .replace(/([：:；;。])\s*(?=\d{1,2}[.、．](?!\d))/g, "$1\n")
    .replace(/[ \t]+(?=\d{1,2}[.、．](?!\d))/g, "\n");
  const matcher = /(?:^|\n)\s*(\d{1,2})[.、．]\s*/g;
  const matches = [...normalized.matchAll(matcher)];
  if (!matches.length) return { intro: normalized, exercises: [], outro: "" };
  const intro = trimTrainingPunctuation(normalized.slice(0, matches[0].index));
  let outro = "";
  const exercises = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    let exerciseText = normalized.slice(start, end);
    if (index === matches.length - 1) {
      const trailingSection = exerciseText.search(/\n\s*\n/);
      if (trailingSection >= 0) {
        outro = trimTrainingPunctuation(exerciseText.slice(trailingSection));
        exerciseText = exerciseText.slice(0, trailingSection);
      }
    }
    return exerciseParts(exerciseText);
  }).filter((item) => item.name);
  return { intro, exercises, outro };
}

function splitTrainingPoints(value: string) {
  return cleanTrainingText(value)
    .split(/\n+|[；;。]+/)
    .map(trimTrainingPunctuation)
    .filter(Boolean);
}

function parseTrainingEntry(activity: string, notes: string) {
  const activityParts = parseNumberedText(activity);
  const noteParts = parseNumberedText(notes);
  const exercises = activityParts.exercises.length ? activityParts.exercises : noteParts.exercises;
  const heading = activityParts.exercises.length
    ? activityParts.intro || "本次训练"
    : noteParts.exercises.length
      ? activity
      : activity;
  const pointSource = activityParts.exercises.length
    ? [activityParts.outro, notes].filter(Boolean).join("\n")
    : noteParts.exercises.length
      ? [noteParts.intro, noteParts.outro].filter(Boolean).join("\n")
      : notes;
  return { heading, exercises, points: splitTrainingPoints(pointSource) };
}

function parseTrainingPlan(content: string) {
  const normalized = cleanTrainingText(content)
    .replace(/[ \t]+(?=第\s*[0-9一二三四五六七]+\s*天(?:\s*[|｜:：—-]|\s))/g, "\n")
    .replace(/[ \t]+(?=\d{1,2}[.、．](?!\d))/g, "\n");
  const matcher = /(?:^|\n)\s*(第\s*[0-9一二三四五六七]+\s*天)\s*(?:[|｜:：—-]\s*)?([^\n]*)/g;
  const matches = [...normalized.matchAll(matcher)];
  if (!matches.length) {
    const parsed = parseNumberedText(normalized);
    return { overview: splitTrainingPoints([parsed.intro, parsed.outro].filter(Boolean).join("\n")), days: [] as PlanDayDisplay[], exercises: parsed.exercises };
  }
  const overview = splitTrainingPoints(normalized.slice(0, matches[0].index));
  const days = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    const parsed = parseNumberedText(normalized.slice(start, end));
    return {
      label: match[1].replace(/\s/g, ""),
      title: trimTrainingPunctuation(match[2]),
      exercises: parsed.exercises,
      points: splitTrainingPoints([parsed.intro, parsed.outro].filter(Boolean).join("\n")),
    };
  });
  return { overview, days, exercises: [] as ExerciseDisplay[] };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string; group?: string; date?: string }> }) {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const db = getD1();
  const params = await searchParams;
  const view = navItems.some(([key]) => key === params.view) ? params.view! : "home";
  const todayValue = chinaToday();
  const anchorDate = safeDate(params.date, todayValue);
  const weekStart = mondayOfValue(anchorDate);
  const weekEnd = addDays(weekStart, 6);

  const profile = await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(user.userId).first<Profile>();
  if (!profile) return <Onboarding email={user.email} suggestedName={user.fullName ?? ""} />;

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO group_members (group_id, user_id, role)
      SELECT group_id, ?, 'member' FROM group_invites WHERE lower(email) = lower(?) AND status = 'pending'`)
      .bind(user.userId, user.email),
    db.prepare("UPDATE group_invites SET status = 'accepted' WHERE lower(email) = lower(?) AND status = 'pending'")
      .bind(user.email),
  ]);

  const groups = resultRows(await db.prepare(`SELECT g.*, gm.role FROM groups g
    JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at`).bind(user.userId).all<Group>());
  const selectedGroup = groups.find((item) => item.id === params.group) ?? groups[0] ?? null;

  const weights = resultRows(await db.prepare(`SELECT id, record_date, weight_kg, note
    FROM weight_entries WHERE user_id = ? ORDER BY record_date ASC`).bind(user.userId).all<Weight>());

  const [meals, trainingEntries, trainingPlans] = await Promise.all([
    db.prepare(`SELECT * FROM meal_entries WHERE user_id = ? AND record_date BETWEEN ? AND ?
      ORDER BY record_date ASC, created_at ASC`).bind(user.userId, weekStart, weekEnd).all<Meal>().then(resultRows),
    db.prepare(`SELECT * FROM training_entries WHERE user_id = ? AND record_date BETWEEN ? AND ?
      ORDER BY record_date ASC, created_at ASC`).bind(user.userId, weekStart, weekEnd).all<TrainingEntry>().then(resultRows),
    db.prepare(`SELECT * FROM training_plans WHERE user_id = ?
      ORDER BY active DESC, start_date DESC, created_at DESC LIMIT 30`).bind(user.userId).all<TrainingPlan>().then(resultRows),
  ]);

  let members: Member[] = [];
  let expenses: Expense[] = [];
  if (selectedGroup) {
    [members, expenses] = await Promise.all([
      db.prepare(`SELECT p.*, gm.role FROM group_members gm JOIN profiles p ON p.user_id = gm.user_id
        WHERE gm.group_id = ? ORDER BY CASE gm.role WHEN 'owner' THEN 0 ELSE 1 END, p.display_name`)
        .bind(selectedGroup.id).all<Member>().then(resultRows),
      db.prepare(`SELECT e.*, p.display_name FROM expenses e JOIN profiles p ON p.user_id = e.user_id
        WHERE e.group_id = ? ORDER BY e.purchase_date DESC, e.updated_at DESC LIMIT 200`)
        .bind(selectedGroup.id).all<Expense>().then(resultRows),
    ]);
  }

  const currentWeight = weights.at(-1)?.weight_kg ?? profile.current_weight_kg;
  const startWeight = weights[0]?.weight_kg ?? currentWeight;
  const weightChange = currentWeight - startWeight;
  const monthStart = todayValue.slice(0, 8) + "01";
  const todayExpenses = expenses.filter((item) => item.purchase_date === todayValue).reduce((sum, item) => sum + item.amount_cents, 0);
  const weekExpenses = expenses.filter((item) => item.purchase_date >= weekStart).reduce((sum, item) => sum + item.amount_cents, 0);
  const monthExpenses = expenses.filter((item) => item.purchase_date >= monthStart).reduce((sum, item) => sum + item.amount_cents, 0);
  const upcoming = trainingEntries.filter((item) => item.record_date >= todayValue).sort((a, b) => a.record_date.localeCompare(b.record_date));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark">健</span><span>健康与运动<small>HEALTH &amp; FITNESS</small></span></Link>
        <nav className="side-nav" aria-label="主导航">
          {navItems.map(([key, icon, label]) => (
            <Link key={key} className={view === key ? "active" : ""} href={queryLink(key, selectedGroup?.id)}>
              <span>{icon}</span>{label}
            </Link>
          ))}
        </nav>
        <div className="side-profile">
          <div className="avatar">{profile.display_name.slice(0, 1)}</div>
          <div><strong>{profile.display_name}</strong><small>{profile.email}</small></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "workouts" || view === "health" ? "个人健康空间" : selectedGroup ? selectedGroup.name : "你的健康空间"}</p>
            <h1>{view === "home" ? `晚上好，${profile.display_name}` : navItems.find(([key]) => key === view)?.[2]}</h1>
          </div>
          <div className="top-actions">
            {groups.length > 1 && view !== "workouts" && view !== "health" && <details className="group-switch"><summary>{selectedGroup?.name}⌄</summary><div>{groups.map((group) => <Link key={group.id} href={queryLink(view, group.id)}>{group.name}</Link>)}</div></details>}
            <a className="ghost-button" href={chatGPTSignOutPath("/")}>退出</a>
          </div>
        </header>

        {view === "home" && <Dashboard profile={profile} currentWeight={currentWeight} weightChange={weightChange} weights={weights} upcoming={upcoming} monthExpenses={monthExpenses} members={members} />}
        {view === "weight" && <WeightPage profile={profile} weights={weights} currentWeight={currentWeight} weightChange={weightChange} />}
        {view === "workouts" && <PersonalWorkoutPage trainingEntries={trainingEntries} trainingPlans={trainingPlans} today={todayValue} anchorDate={anchorDate} weekStart={weekStart} selectedGroupId={selectedGroup?.id} />}
        {view === "health" && <MealPage meals={meals} profile={profile} currentWeight={currentWeight} today={todayValue} anchorDate={anchorDate} weekStart={weekStart} selectedGroupId={selectedGroup?.id} />}
        {view === "expenses" && <ExpensePage selectedGroup={selectedGroup} expenses={expenses} members={members} today={todayValue} todayTotal={todayExpenses} weekTotal={weekExpenses} monthTotal={monthExpenses} />}
        {view === "group" && <GroupPage selectedGroup={selectedGroup} groups={groups} members={members} profile={profile} />}
      </main>

      <nav className="bottom-nav" aria-label="手机导航">
        {navItems.map(([key, icon, label]) => <Link key={key} className={view === key ? "active" : ""} href={queryLink(key, selectedGroup?.id)}><span>{icon}</span><small>{label}</small></Link>)}
      </nav>
    </div>
  );
}

function Onboarding({ email, suggestedName }: { email: string; suggestedName: string }) {
  return <main className="onboarding">
    <section className="welcome-panel">
      <div className="brand-mark large">健</div>
      <p className="eyebrow">WELCOME TO 健康与运动</p>
      <h1>把每一天的健康变化，认真记录下来。</h1>
      <p>集中管理体重、个人运动计划与每日饮食，也可以按需与朋友共享消费记录。</p>
      <div className="welcome-points"><span>✓ 每日体重趋势</span><span>✓ 个人运动周历</span><span>✓ 饮食与热量建议</span></div>
    </section>
    <form action={saveProfile} className="onboarding-form">
      <p className="step-label">第 1 步，共 1 步</p><h2>先认识一下你</h2><p className="muted">账号邮箱：{email}</p>
      <label>你的名字<input name="displayName" defaultValue={suggestedName} placeholder="例如：阿力" required maxLength={30} /></label>
      <div className="form-grid"><label>身高（cm）<input name="heightCm" type="number" min="80" max="250" step="0.1" placeholder="175" required /></label><label>当前体重（kg）<input name="weightKg" type="number" min="20" max="400" step="0.1" placeholder="68.5" required /></label></div>
      <label className="check-row"><input name="shareWeight" type="checkbox" /><span><strong>向群组成员展示体重</strong><small>默认关闭，以后可以随时修改</small></span></label>
      <button className="primary-button" type="submit">开始记录 <span>→</span></button>
    </form>
  </main>;
}

function EmptyGroup() {
  return <section className="empty-state card"><span className="empty-icon">◎</span><h2>先创建你们的双人群组</h2><p>创建后即可共享运动日历和消费记录。</p><div className="empty-actions"><details><summary className="primary-button">创建群组</summary><form action={createGroup}><label>群组名称<input name="name" placeholder="例如：周末训练搭子" required /></label><button className="primary-button">确认创建</button></form></details><details><summary className="secondary-button">使用邀请码加入</summary><form action={joinGroup}><label>邀请码<input name="inviteCode" placeholder="输入 10 位邀请码" required /></label><button className="primary-button">加入群组</button></form></details></div></section>;
}

function Dashboard({ profile, currentWeight, weightChange, weights, upcoming, monthExpenses, members }: { profile: Profile; currentWeight: number; weightChange: number; weights: Weight[]; upcoming: TrainingEntry[]; monthExpenses: number; members: Member[] }) {
  return <>
    <section className="stat-grid">
      <article className="stat-card coral"><span className="stat-icon">↗</span><p>当前体重</p><strong>{currentWeight.toFixed(1)}<small> kg</small></strong><em className={weightChange <= 0 ? "good" : ""}>{weightChange > 0 ? "+" : ""}{weightChange.toFixed(1)} kg 自开始</em></article>
      <article className="stat-card mint"><span className="stat-icon">✓</span><p>本周个人训练</p><strong>{upcoming.filter((item) => item.completed).length}<small> 项完成</small></strong><em>{upcoming.length} 个训练安排</em></article>
      <article className="stat-card yellow"><span className="stat-icon">¥</span><p>本月消费</p><strong>{formatMoney(monthExpenses)}</strong><em>{members.length || 1} 人共同记录</em></article>
    </section>
    <section className="dashboard-grid">
      <article className="card chart-card"><div className="card-head"><div><p className="eyebrow">WEIGHT TREND</p><h2>体重趋势</h2></div><Link href="/?view=weight">查看全部 →</Link></div><WeightChart entries={weights.slice(-30)} /></article>
      <article className="card plan-card"><div className="card-head"><div><p className="eyebrow">NEXT UP</p><h2>接下来的个人训练</h2></div><Link href="/?view=workouts">查看周计划 →</Link></div>
        {upcoming.length ? <div className="compact-list">{upcoming.slice(0, 4).map((item) => <div key={item.id}><time>{dateLabel(item.record_date)}</time><span className={item.completed ? "done-dot" : "pending-dot"}></span><div><strong>{item.activity}</strong><small>{item.duration_minutes ? `${item.duration_minutes} 分钟` : "未填写时长"}{item.source === "chatgpt" ? " · ChatGPT" : ""}</small></div></div>)}</div> : <p className="muted">本周还没有个人训练安排。</p>}
      </article>
    </section>
    <section className="quote-strip"><span>“</span><p>比昨天更强一点，就已经很好。</p><small>今天也一起完成一件小事吧，{profile.display_name}。</small></section>
    {!selectedGroup && <EmptyGroup />}
  </>;
}

function WeightPage({ profile, weights, currentWeight, weightChange }: { profile: Profile; weights: Weight[]; currentWeight: number; weightChange: number }) {
  const bmi = currentWeight / Math.pow(profile.height_cm / 100, 2);
  return <section className="page-grid">
    <div className="main-column">
      <article className="card chart-card large"><div className="card-head"><div><p className="eyebrow">YOUR JOURNEY</p><h2>每日体重</h2></div><details><summary className="primary-button small">＋ 记录体重</summary><WeightForm /></details></div><WeightChart entries={weights} tall /></article>
      <article className="card"><div className="card-head"><h2>历史记录</h2><span className="pill">{weights.length} 天</span></div><div className="data-list">{[...weights].reverse().map((item) => <div key={item.id}><time>{item.record_date}</time><strong>{item.weight_kg.toFixed(1)} kg</strong><span>{item.note || "—"}</span><form action={deleteWeight}><input type="hidden" name="id" value={item.id} /><button className="icon-button" aria-label={`删除 ${item.record_date} 的体重记录`}>×</button></form></div>)}</div></article>
    </div>
    <aside className="side-column"><article className="card metric-card"><p>当前体重</p><strong>{currentWeight.toFixed(1)}<small> kg</small></strong><span>累计变化 {weightChange > 0 ? "+" : ""}{weightChange.toFixed(1)} kg</span></article><article className="card metric-card"><p>BMI 参考值</p><strong>{bmi.toFixed(1)}</strong><span>仅作一般记录参考</span></article><article className="card"><h2>个人资料</h2><form action={saveProfile} className="stack-form"><label>名字<input name="displayName" defaultValue={profile.display_name} required /></label><div className="form-grid"><label>身高（cm）<input name="heightCm" type="number" min="80" max="250" step="0.1" defaultValue={profile.height_cm} required /></label><label>当前体重（kg）<input name="weightKg" type="number" min="20" max="400" step="0.1" defaultValue={currentWeight} required /></label></div><label className="inline-check"><input name="shareWeight" type="checkbox" defaultChecked={Boolean(profile.share_weight)} /> 向群友展示当前体重</label><button className="secondary-button">保存资料</button></form></article><article className="privacy-note"><strong>{profile.share_weight ? "群友可以看到你的当前体重" : "你的体重目前仅自己可见"}</strong><p>体重历史始终仅自己可见。</p></article></aside>
  </section>;
}

function WeightForm() {
  return <form action={saveWeight} className="popover-form"><h3>记录体重</h3><label>日期<input name="date" type="date" defaultValue={chinaToday()} required /></label><label>体重（kg）<input name="weightKg" type="number" min="20" max="400" step="0.1" required /></label><label>备注（选填）<input name="note" maxLength={120} placeholder="例如：晨起空腹" /></label><button className="primary-button">保存记录</button></form>;
}

const mealLabels = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

const weekDayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const primaryMealTypes: Meal["meal_type"][] = ["breakfast", "lunch", "dinner"];

function WeekNavigator({ view, weekStart, anchorDate, today, groupId }: { view: "workouts" | "health"; weekStart: string; anchorDate: string; today: string; groupId?: string }) {
  const weekEnd = addDays(weekStart, 6);
  return <div className="week-toolbar">
    <div className="week-switcher">
      <Link aria-label="上一周" href={queryLink(view, groupId, addDays(weekStart, -7))}>←</Link>
      <strong>{dateLabel(weekStart)} — {dateLabel(weekEnd)}</strong>
      <Link aria-label="下一周" href={queryLink(view, groupId, addDays(weekStart, 7))}>→</Link>
      <Link className="today-link" href={queryLink(view, groupId, today)}>本周</Link>
    </div>
    <form method="get" className="date-jump">
      <input type="hidden" name="view" value={view} />
      {groupId && <input type="hidden" name="group" value={groupId} />}
      <label>跳转日期<input name="date" type="date" defaultValue={anchorDate} /></label>
      <button className="secondary-button">查询</button>
    </form>
  </div>;
}

function ExerciseList({ exercises }: { exercises: ExerciseDisplay[] }) {
  return <div className="exercise-list">
    {exercises.map((exercise, index) => <article className="exercise-item" key={`${exercise.name}-${index}`}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <div><strong>{exercise.name}</strong>{exercise.detail && <p>{exercise.detail}</p>}</div>
    </article>)}
  </div>;
}

function TrainingEntryDetails({ item }: { item: TrainingEntry }) {
  const parsed = parseTrainingEntry(item.activity, item.notes);
  return <div className="training-entry-body">
    <div className="training-entry-head">
      <strong className="training-heading">{parsed.heading}</strong>
      <span>{parsed.exercises.length ? `${parsed.exercises.length} 个动作` : "训练记录"}</span>
    </div>
    {parsed.exercises.length > 0 && <ExerciseList exercises={parsed.exercises} />}
    <div className="training-meta"><span>{item.duration_minutes ? `${item.duration_minutes} 分钟` : "未填写时长"}</span></div>
    {parsed.points.length > 0 && <ul className="training-notes">{parsed.points.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>}
  </div>;
}

function TrainingPlanDetails({ plan }: { plan: TrainingPlan }) {
  const parsed = parseTrainingPlan(plan.content);
  return <>
    {parsed.overview.length > 0 && <section className="plan-overview"><span>计划说明</span><ul>{parsed.overview.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul></section>}
    {parsed.exercises.length > 0 && <ExerciseList exercises={parsed.exercises} />}
    {parsed.days.length > 0 && <div className="plan-days">
      {parsed.days.map((day, index) => <details className="plan-day" key={`${day.label}-${index}`} open={index === 0}>
        <summary><span>{day.label}</span><strong>{day.title || "训练安排"}</strong><em>{day.exercises.length ? `${day.exercises.length} 个动作` : `${day.points.length} 项`}</em></summary>
        <div className="plan-day-content">
          {day.points.length > 0 && <ul className="training-notes">{day.points.map((point, pointIndex) => <li key={`${point}-${pointIndex}`}>{point}</li>)}</ul>}
          {day.exercises.length > 0 && <ExerciseList exercises={day.exercises} />}
        </div>
      </details>)}
    </div>}
    {!parsed.overview.length && !parsed.days.length && !parsed.exercises.length && <p className="muted">暂无计划明细</p>}
  </>;
}

function PersonalWorkoutPage({ trainingEntries, trainingPlans, today, anchorDate, weekStart, selectedGroupId }: { trainingEntries: TrainingEntry[]; trainingPlans: TrainingPlan[]; today: string; anchorDate: string; weekStart: string; selectedGroupId?: string }) {
  const dates = weekDates(weekStart);
  const completedCount = trainingEntries.filter((item) => item.completed).length;
  const totalMinutes = trainingEntries.reduce((sum, item) => sum + (item.duration_minutes ?? 0), 0);
  const activePlans = trainingPlans.filter((item) => item.active);

  return <>
    <section className="sync-hero workout-hero">
      <div><p className="eyebrow">PERSONAL TRAINING</p><h2>你的专属运动空间</h2><p>手机 ChatGPT 记录的训练与总计划会同步到这里，仅按当前登录账号展示。</p></div>
      <span>◫</span>
    </section>
    <section className="stat-grid health-stats">
      <article className="stat-card mint"><p>本周训练</p><strong>{trainingEntries.length}<small> 项</small></strong><em>{completedCount} 项已完成</em></article>
      <article className="stat-card yellow"><p>累计时长</p><strong>{totalMinutes}<small> 分钟</small></strong><em>当前查询周</em></article>
      <article className="stat-card coral"><p>执行中总计划</p><strong>{activePlans.length}<small> 个</small></strong><em>个人专属，不与群组混合</em></article>
    </section>
    <WeekNavigator view="workouts" weekStart={weekStart} anchorDate={anchorDate} today={today} groupId={selectedGroupId} />
    <section className="page-grid weekly-layout">
      <div className="main-column weekly-days">
        {dates.map((date, index) => {
          const items = trainingEntries.filter((item) => item.record_date === date);
          return <article className={`card week-day-card ${date === anchorDate ? "focus-day" : ""}`} key={date} id={`workout-${date}`}>
            <header className="week-day-head">
              <div><span>{weekDayLabels[index]}</span><strong>{dateLabel(date)}</strong>{date === today && <em>今天</em>}</div>
              <div><small>{items.filter((item) => item.completed).length}/{items.length} 完成</small><details><summary className="mini-add">＋</summary><TrainingEntryForm today={date} /></details></div>
            </header>
            <div className="health-list">{items.map((item) => <div className={`health-list-row training-record ${item.completed ? "completed" : ""}`} key={item.id}>
              <form action={toggleTrainingEntry}><input type="hidden" name="id" value={item.id} /><button className="check-button" aria-label="切换训练完成状态">{item.completed ? "✓" : ""}</button></form>
              <TrainingEntryDetails item={item} />
              {item.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}
              <form action={deleteTrainingEntry}><input type="hidden" name="id" value={item.id} /><button className="icon-button" aria-label={`删除 ${item.activity}`}>×</button></form>
            </div>)}{!items.length && <p className="muted day-empty">暂无训练，点击右上角添加</p>}</div>
          </article>;
        })}
      </div>
      <aside className="side-column sticky-column">
        <article className="card">
          <div className="card-head"><div><p className="eyebrow">MASTER PLAN</p><h2>总运动计划</h2></div><details><summary className="mini-add">＋</summary><TrainingPlanForm today={today} /></details></div>
          <div className="plan-list">{trainingPlans.map((plan) => <article className={plan.active ? "active" : ""} key={plan.id}>
            <header><strong>{plan.title}</strong>{plan.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}</header>
            <small>{plan.start_date}{plan.end_date ? ` → ${plan.end_date}` : " 起"}</small>
            <TrainingPlanDetails plan={plan} />
            <div className="plan-actions"><form action={toggleTrainingPlan}><input type="hidden" name="id" value={plan.id} /><button className="text-button">{plan.active ? "标记完成" : "重新启用"}</button></form><form action={deleteTrainingPlan}><input type="hidden" name="id" value={plan.id} /><button className="text-button danger">删除</button></form></div>
          </article>)}{!trainingPlans.length && <p className="muted list-empty">还没有总计划，可在这里添加或让 ChatGPT 保存。</p>}</div>
        </article>
        <article className="privacy-note"><strong>手机同步</strong><p>对 ChatGPT 说“记录今天训练……”会进入对应日期；“保存训练计划……”会进入上方总计划。</p></article>
      </aside>
    </section>
  </>;
}

function MealPage({ meals, profile, currentWeight, today, anchorDate, weekStart, selectedGroupId }: { meals: Meal[]; profile: Profile; currentWeight: number; today: string; anchorDate: string; weekStart: string; selectedGroupId?: string }) {
  const dates = weekDates(weekStart);
  const bmi = currentWeight / Math.pow(profile.height_cm / 100, 2);
  const calorieFactor = bmi >= 25 ? 28 : bmi < 18.5 ? 33 : 30;
  const calorieTarget = Math.round(currentWeight * calorieFactor / 50) * 50;
  const proteinTarget = Math.round(currentWeight * 1.6);
  const fatTarget = Math.round(currentWeight * 0.8);
  const carbTarget = Math.max(0, Math.round((calorieTarget - proteinTarget * 4 - fatTarget * 9) / 4));
  const weekCalories = meals.reduce((sum, item) => sum + (item.calories ?? 0), 0);
  const recordedDays = new Set(meals.map((item) => item.record_date)).size;

  return <>
    <section className="sync-hero meal-hero">
      <div><p className="eyebrow">NUTRITION WEEK</p><h2>一周饮食，一眼看清</h2><p>早餐、午餐、晚餐与加餐按天归档；手机 ChatGPT 新增的餐食会自动出现在对应日期。</p></div>
      <span>✦</span>
    </section>
    <section className="stat-grid health-stats">
      <article className="stat-card yellow"><p>每日建议热量</p><strong>{calorieTarget}<small> kcal</small></strong><em>按当前身高与体重估算</em></article>
      <article className="stat-card mint"><p>本周已记录</p><strong>{recordedDays}<small>/7 天</small></strong><em>{meals.length} 条餐食</em></article>
      <article className="stat-card coral"><p>本周已录入热量</p><strong>{weekCalories}<small> kcal</small></strong><em>仅统计已填写热量的餐食</em></article>
    </section>
    <WeekNavigator view="health" weekStart={weekStart} anchorDate={anchorDate} today={today} groupId={selectedGroupId} />
    <section className="page-grid weekly-layout">
      <div className="main-column weekly-days">
        {dates.map((date, index) => {
          const items = meals.filter((item) => item.record_date === date);
          const dayCalories = items.reduce((sum, item) => sum + (item.calories ?? 0), 0);
          const snacks = items.filter((item) => item.meal_type === "snack");
          return <article className={`card meal-day-card ${date === anchorDate ? "focus-day" : ""}`} key={date} id={`meal-${date}`}>
            <header className="week-day-head">
              <div><span>{weekDayLabels[index]}</span><strong>{dateLabel(date)}</strong>{date === today && <em>今天</em>}</div>
              <div className="day-calories"><small>{dayCalories || 0} / {calorieTarget} kcal</small><details><summary className="mini-add">＋</summary><MealForm today={date} /></details></div>
            </header>
            <div className="calorie-track" aria-label={`${date} 热量进度`}><i style={{ width: `${Math.min(100, calorieTarget ? dayCalories / calorieTarget * 100 : 0)}%` }} /></div>
            <div className="meal-slots">{primaryMealTypes.map((mealType) => {
              const slotItems = items.filter((item) => item.meal_type === mealType);
              return <section className="meal-slot" key={mealType}><h3>{mealLabels[mealType]}</h3>{slotItems.map((item) => <MealRecord key={item.id} item={item} />)}{!slotItems.length && <p>尚未记录</p>}</section>;
            })}</div>
            {snacks.length > 0 && <div className="snack-row"><strong>加餐</strong><div>{snacks.map((item) => <MealRecord key={item.id} item={item} compact />)}</div></div>}
          </article>;
        })}
      </div>
      <aside className="side-column sticky-column">
        <article className="card nutrition-advice">
          <p className="eyebrow">DAILY GUIDANCE</p><h2>每日摄入建议</h2>
          <div className="calorie-target"><strong>{calorieTarget}</strong><span>kcal / 天</span></div>
          <div className="target-grid"><div><b>{proteinTarget}g</b><span>蛋白质</span></div><div><b>{carbTarget}g</b><span>碳水</span></div><div><b>{fatTarget}g</b><span>脂肪</span></div></div>
          <dl><div><dt>当前体重</dt><dd>{currentWeight.toFixed(1)} kg</dd></div><div><dt>身高</dt><dd>{profile.height_cm} cm</dd></div><div><dt>BMI</dt><dd>{bmi.toFixed(1)}</dd></div></dl>
          <p className="advice-note">按体重与 BMI 做日常训练饮食估算。实际需要会随年龄、性别、训练量和目标变化，仅作一般记录参考，不替代医疗或营养建议。</p>
        </article>
        <article className="privacy-note"><strong>手机同步</strong><p>对 ChatGPT 说“记录今天早餐……”或注明具体日期，餐食会同步到本页对应星期和餐次。</p></article>
      </aside>
    </section>
  </>;
}

function MealRecord({ item, compact = false }: { item: Meal; compact?: boolean }) {
  return <div className={`meal-record ${compact ? "compact" : ""}`}>
    <div><strong>{item.food}</strong><small>{item.calories !== null ? `${item.calories} kcal` : "未填热量"}{item.notes ? ` · ${item.notes}` : ""}</small><div className="macro-line">{item.protein_grams !== null && <span>蛋白质 {item.protein_grams}g</span>}{item.carbs_grams !== null && <span>碳水 {item.carbs_grams}g</span>}{item.fat_grams !== null && <span>脂肪 {item.fat_grams}g</span>}</div></div>
    <div>{item.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}<form action={deleteMeal}><input type="hidden" name="id" value={item.id} /><button className="icon-button" aria-label={`删除 ${item.food}`}>×</button></form></div>
  </div>;
}

function MealForm({ today }: { today: string }) {
  return <form action={saveMeal} className="popover-form"><h3>添加饮食</h3><div className="form-grid"><label>日期<input name="date" type="date" defaultValue={today} required /></label><label>餐次<select name="mealType" defaultValue="breakfast"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option></select></label></div><label>吃了什么<textarea name="food" maxLength={500} placeholder="例如：鸡蛋 2 个、燕麦 50g、牛奶 250ml" required /></label><div className="nutrition-grid"><label>热量 kcal<input name="calories" type="number" min="0" /></label><label>蛋白质 g<input name="proteinGrams" type="number" min="0" step="0.1" /></label><label>碳水 g<input name="carbsGrams" type="number" min="0" step="0.1" /></label><label>脂肪 g<input name="fatGrams" type="number" min="0" step="0.1" /></label></div><label>备注<input name="notes" maxLength={300} /></label><button className="primary-button">保存饮食</button></form>;
}

function TrainingEntryForm({ today }: { today: string }) {
  return <form action={saveTrainingEntry} className="popover-form"><h3>添加每日训练</h3><label>日期<input name="date" type="date" defaultValue={today} required /></label><label>训练主题<input name="activity" maxLength={200} placeholder="例如：胸 + 肩 + 三头（Push）" required /></label><label>总时长（分钟）<input name="durationMinutes" type="number" min="1" max="1440" /></label><label>动作与备注<textarea name="notes" maxLength={300} placeholder={"1. 平板卧推：40kg × 12次 × 3组\n2. 侧平举：7.5kg × 12次 × 3组"} /></label><label className="inline-check"><input name="completed" type="checkbox" defaultChecked /> 已完成</label><button className="primary-button">保存训练</button></form>;
}

function TrainingPlanForm({ today }: { today: string }) {
  return <form action={saveTrainingPlan} className="popover-form"><h3>新建训练计划</h3><label>计划名称<input name="title" maxLength={100} placeholder="例如：四周增肌计划" required /></label><div className="form-grid"><label>开始日期<input name="startDate" type="date" defaultValue={today} required /></label><label>结束日期<input name="endDate" type="date" /></label></div><label>计划内容<textarea name="content" maxLength={3000} placeholder={"第1天 | 胸肩三头\n1. 平板卧推：40kg × 12次 × 3组\n2. 侧平举：7.5kg × 12次 × 3组\n\n第2天 | 腿部训练\n1. 深蹲：60kg × 8次 × 4组"} required /></label><button className="primary-button">保存计划</button></form>;
}

function ExpensePage({ selectedGroup, expenses, members, today, todayTotal, weekTotal, monthTotal }: { selectedGroup: Group | null; expenses: Expense[]; members: Member[]; today: string; todayTotal: number; weekTotal: number; monthTotal: number }) {
  if (!selectedGroup) return <EmptyGroup />;
  const byMember = members.map((member) => ({ label: member.display_name, value: expenses.filter((item) => item.user_id === member.user_id).reduce((sum, item) => sum + item.amount_cents, 0) }));
  return <section><div className="section-toolbar"><p className="muted">金额以人民币记录</p><details><summary className="primary-button">＋ 添加消费</summary><ExpenseForm groupId={selectedGroup.id} members={members} today={today} /></details></div><div className="stat-grid expense-stats"><article className="stat-card"><p>今日</p><strong>{formatMoney(todayTotal)}</strong></article><article className="stat-card"><p>本周</p><strong>{formatMoney(weekTotal)}</strong></article><article className="stat-card coral"><p>本月</p><strong>{formatMoney(monthTotal)}</strong></article></div><section className="page-grid expenses-layout"><article className="card"><div className="card-head"><h2>消费明细</h2><span className="pill">{expenses.length} 笔</span></div><div className="expense-list">{expenses.map((item) => <div key={item.id}><span className="category-dot">{item.category.slice(0, 1)}</span><div><strong>{item.item}</strong><small>{dateLabel(item.purchase_date)} · {item.display_name} · {item.category}</small></div><b>{formatMoney(item.amount_cents)}</b><details><summary className="icon-button">•••</summary><ExpenseForm groupId={selectedGroup.id} members={members} today={today} expense={item} /><form action={deleteExpense} className="delete-form"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="groupId" value={selectedGroup.id} /><button>删除这笔消费</button></form></details></div>)}{!expenses.length && <p className="muted list-empty">还没有消费记录。</p>}</div></article><aside className="side-column"><article className="card"><p className="eyebrow">WHO SPENT WHAT</p><h2>成员总金额</h2><ExpenseBars data={byMember} /></article><article className="privacy-note"><strong>统计口径</strong><p>今日按自然日，本周从周一开始，本月按自然月计算。</p></article></aside></section></section>;
}

function ExpenseForm({ groupId, members, today, expense }: { groupId: string; members: Member[]; today: string; expense?: Expense }) {
  return <form action={saveExpense} className="popover-form"><h3>{expense ? "编辑消费" : "添加消费"}</h3><input type="hidden" name="groupId" value={groupId} />{expense && <input type="hidden" name="id" value={expense.id} />}<label>日期<input name="date" type="date" defaultValue={expense?.purchase_date ?? today} required /></label><label>买了什么<input name="item" defaultValue={expense?.item} required maxLength={80} placeholder="例如：瑜伽垫" /></label><div className="form-grid"><label>金额（元）<input name="amount" type="number" min="0.01" max="1000000" step="0.01" defaultValue={expense ? expense.amount_cents / 100 : ""} required /></label><label>消费人<select name="payerId" defaultValue={expense?.user_id}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label></div><label>分类<input name="category" defaultValue={expense?.category ?? "其他"} maxLength={20} placeholder="装备 / 补剂 / 会员" /></label><label>备注<input name="notes" defaultValue={expense?.notes} maxLength={200} /></label><button className="primary-button">保存</button></form>;
}

function GroupPage({ selectedGroup, groups, members, profile }: { selectedGroup: Group | null; groups: Group[]; members: Member[]; profile: Profile }) {
  return <section className="page-grid"><div className="main-column">{selectedGroup ? <><article className="card group-hero"><p className="eyebrow">YOUR CREW</p><h2>{selectedGroup.name}</h2><p>{members.length} 位成员 · 由 {members.find((item) => item.role === "owner")?.display_name} 创建</p><div className="invite-code"><span>邀请码</span><strong>{selectedGroup.invite_code}</strong><small>发给朋友，对方登录后输入即可加入</small></div></article><article className="card"><div className="card-head"><h2>成员</h2><span className="pill">{members.length}/2</span></div><div className="member-list">{members.map((member) => <div key={member.user_id}><div className="avatar">{member.display_name.slice(0, 1)}</div><div><strong>{member.display_name}{member.user_id === profile.user_id ? "（你）" : ""}</strong><small>{member.email}</small></div><span>{member.height_cm} cm{member.share_weight ? ` · ${member.current_weight_kg.toFixed(1)} kg` : " · 体重保密"}</span><em>{member.role === "owner" ? "群主" : "成员"}</em></div>)}</div></article></> : <EmptyGroup />}</div><aside className="side-column"><article className="card"><h2>邀请朋友</h2><p className="muted">输入朋友登录 ChatGPT 使用的邮箱。朋友还需要被加入网站访问名单。</p>{selectedGroup?.owner_id === profile.user_id ? <form action={inviteMember} className="stack-form"><input type="hidden" name="groupId" value={selectedGroup.id} /><label>朋友邮箱<input name="email" type="email" placeholder="friend@example.com" required /></label><button className="primary-button">保存邀请</button></form> : <p className="pill">仅群主可邀请</p>}</article><article className="card"><h2>其他群组</h2><div className="group-links">{groups.map((group) => <Link key={group.id} href={queryLink("group", group.id)}>{group.name}<span>→</span></Link>)}</div><details><summary className="secondary-button full">＋ 新建群组</summary><form action={createGroup} className="popover-form"><label>群组名称<input name="name" required /></label><button className="primary-button">创建</button></form></details><details><summary className="text-button">使用邀请码加入</summary><form action={joinGroup} className="popover-form"><label>邀请码<input name="inviteCode" required /></label><button className="primary-button">加入</button></form></details></article></aside></section>;
}
