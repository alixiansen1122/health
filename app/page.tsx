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
  deleteWorkout,
  inviteMember,
  joinGroup,
  saveExpense,
  saveMeal,
  saveProfile,
  saveTrainingEntry,
  saveTrainingPlan,
  saveWeight,
  saveWorkout,
  toggleTrainingEntry,
  toggleTrainingPlan,
  toggleWorkout,
} from "./actions";
import { ExpenseBars, WeightChart } from "./charts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "并肩 · 双人健康记录",
  description: "和重要的人一起记录体重、安排运动、看清健身消费。",
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
type Workout = {
  id: string; group_id: string; user_id: string; workout_date: string; activity: string;
  duration_minutes: number | null; completed: number; notes: string; display_name: string;
};
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
  ["health", "✦", "记录"],
  ["expenses", "¥", "消费"],
  ["group", "◎", "群组"],
] as const;

function queryLink(view: string, groupId?: string) {
  const params = new URLSearchParams();
  if (view !== "home") params.set("view", view);
  if (groupId) params.set("group", groupId);
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

function mondayOf(date: Date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result.toISOString().slice(0, 10);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string; group?: string }> }) {
  const user = await requireAppUser("/");
  await ensureDatabase();
  const db = getD1();
  const params = await searchParams;
  const view = navItems.some(([key]) => key === params.view) ? params.view! : "home";

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
    db.prepare(`SELECT * FROM meal_entries WHERE user_id = ?
      ORDER BY record_date DESC, created_at DESC LIMIT 120`).bind(user.userId).all<Meal>().then(resultRows),
    db.prepare(`SELECT * FROM training_entries WHERE user_id = ?
      ORDER BY record_date DESC, created_at DESC LIMIT 120`).bind(user.userId).all<TrainingEntry>().then(resultRows),
    db.prepare(`SELECT * FROM training_plans WHERE user_id = ?
      ORDER BY active DESC, start_date DESC, created_at DESC LIMIT 30`).bind(user.userId).all<TrainingPlan>().then(resultRows),
  ]);

  let members: Member[] = [];
  let workouts: Workout[] = [];
  let expenses: Expense[] = [];
  if (selectedGroup) {
    [members, workouts, expenses] = await Promise.all([
      db.prepare(`SELECT p.*, gm.role FROM group_members gm JOIN profiles p ON p.user_id = gm.user_id
        WHERE gm.group_id = ? ORDER BY CASE gm.role WHEN 'owner' THEN 0 ELSE 1 END, p.display_name`)
        .bind(selectedGroup.id).all<Member>().then(resultRows),
      db.prepare(`SELECT w.*, p.display_name FROM workouts w JOIN profiles p ON p.user_id = w.user_id
        WHERE w.group_id = ? ORDER BY w.workout_date DESC, w.created_at DESC LIMIT 120`)
        .bind(selectedGroup.id).all<Workout>().then(resultRows),
      db.prepare(`SELECT e.*, p.display_name FROM expenses e JOIN profiles p ON p.user_id = e.user_id
        WHERE e.group_id = ? ORDER BY e.purchase_date DESC, e.updated_at DESC LIMIT 200`)
        .bind(selectedGroup.id).all<Expense>().then(resultRows),
    ]);
  }

  const currentWeight = weights.at(-1)?.weight_kg ?? profile.current_weight_kg;
  const startWeight = weights[0]?.weight_kg ?? currentWeight;
  const weightChange = currentWeight - startWeight;
  const nowDate = new Date();
  const todayValue = nowDate.toISOString().slice(0, 10);
  const monthStart = todayValue.slice(0, 8) + "01";
  const weekStart = mondayOf(nowDate);
  const todayExpenses = expenses.filter((item) => item.purchase_date === todayValue).reduce((sum, item) => sum + item.amount_cents, 0);
  const weekExpenses = expenses.filter((item) => item.purchase_date >= weekStart).reduce((sum, item) => sum + item.amount_cents, 0);
  const monthExpenses = expenses.filter((item) => item.purchase_date >= monthStart).reduce((sum, item) => sum + item.amount_cents, 0);
  const upcoming = workouts.filter((item) => item.workout_date >= todayValue).sort((a, b) => a.workout_date.localeCompare(b.workout_date));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark">并</span><span>并肩<small>BETTER TOGETHER</small></span></Link>
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
            <p className="eyebrow">{selectedGroup ? selectedGroup.name : "你的健康空间"}</p>
            <h1>{view === "home" ? `晚上好，${profile.display_name}` : navItems.find(([key]) => key === view)?.[2]}</h1>
          </div>
          <div className="top-actions">
            {groups.length > 1 && <details className="group-switch"><summary>{selectedGroup?.name}⌄</summary><div>{groups.map((group) => <Link key={group.id} href={queryLink(view, group.id)}>{group.name}</Link>)}</div></details>}
            <a className="ghost-button" href={chatGPTSignOutPath("/")}>退出</a>
          </div>
        </header>

        {view === "home" && <Dashboard profile={profile} currentWeight={currentWeight} weightChange={weightChange} weights={weights} selectedGroup={selectedGroup} upcoming={upcoming} monthExpenses={monthExpenses} members={members} today={todayValue} />}
        {view === "weight" && <WeightPage profile={profile} weights={weights} currentWeight={currentWeight} weightChange={weightChange} />}
        {view === "workouts" && <WorkoutPage selectedGroup={selectedGroup} workouts={workouts} members={members} today={todayValue} />}
        {view === "health" && <HealthSyncPage meals={meals} trainingEntries={trainingEntries} trainingPlans={trainingPlans} today={todayValue} />}
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
      <div className="brand-mark large">并</div>
      <p className="eyebrow">WELCOME TO 并肩</p>
      <h1>两个人，也能把坚持变得更简单。</h1>
      <p>记录真实变化，共享运动计划，看清每一笔健身投入。你的身体数据由你决定是否分享。</p>
      <div className="welcome-points"><span>✓ 每日体重趋势</span><span>✓ 双人运动日历</span><span>✓ 消费清晰统计</span></div>
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

function Dashboard({ profile, currentWeight, weightChange, weights, selectedGroup, upcoming, monthExpenses, members, today }: { profile: Profile; currentWeight: number; weightChange: number; weights: Weight[]; selectedGroup: Group | null; upcoming: Workout[]; monthExpenses: number; members: Member[]; today: string }) {
  return <>
    <section className="stat-grid">
      <article className="stat-card coral"><span className="stat-icon">↗</span><p>当前体重</p><strong>{currentWeight.toFixed(1)}<small> kg</small></strong><em className={weightChange <= 0 ? "good" : ""}>{weightChange > 0 ? "+" : ""}{weightChange.toFixed(1)} kg 自开始</em></article>
      <article className="stat-card mint"><span className="stat-icon">✓</span><p>本月已完成</p><strong>{upcoming.filter((item) => item.completed).length}<small> 项</small></strong><em>{upcoming.length} 个运动安排</em></article>
      <article className="stat-card yellow"><span className="stat-icon">¥</span><p>本月消费</p><strong>{formatMoney(monthExpenses)}</strong><em>{members.length || 1} 人共同记录</em></article>
    </section>
    <section className="dashboard-grid">
      <article className="card chart-card"><div className="card-head"><div><p className="eyebrow">WEIGHT TREND</p><h2>体重趋势</h2></div><Link href="/?view=weight">查看全部 →</Link></div><WeightChart entries={weights.slice(-30)} /></article>
      <article className="card plan-card"><div className="card-head"><div><p className="eyebrow">NEXT UP</p><h2>接下来的运动</h2></div>{selectedGroup && <details><summary className="mini-add">＋</summary><WorkoutForm groupId={selectedGroup.id} members={members} today={today} /></details>}</div>
        {!selectedGroup ? <p className="muted">创建群组后一起安排运动。</p> : upcoming.length ? <div className="compact-list">{upcoming.slice(0, 4).map((item) => <div key={item.id}><time>{dateLabel(item.workout_date)}</time><span className={item.completed ? "done-dot" : "pending-dot"}></span><div><strong>{item.activity}</strong><small>{item.display_name}{item.duration_minutes ? ` · ${item.duration_minutes} 分钟` : ""}</small></div></div>)}</div> : <p className="muted">还没有运动安排，添加第一项吧。</p>}
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
  return <form action={saveWeight} className="popover-form"><h3>记录体重</h3><label>日期<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>体重（kg）<input name="weightKg" type="number" min="20" max="400" step="0.1" required /></label><label>备注（选填）<input name="note" maxLength={120} placeholder="例如：晨起空腹" /></label><button className="primary-button">保存记录</button></form>;
}

const mealLabels = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

function HealthSyncPage({ meals, trainingEntries, trainingPlans, today }: { meals: Meal[]; trainingEntries: TrainingEntry[]; trainingPlans: TrainingPlan[]; today: string }) {
  const todayMeals = meals.filter((item) => item.record_date === today);
  const todayTraining = trainingEntries.filter((item) => item.record_date === today);
  const todayCalories = todayMeals.reduce((sum, item) => sum + (item.calories ?? 0), 0);
  const todayMinutes = todayTraining.reduce((sum, item) => sum + (item.duration_minutes ?? 0), 0);
  const activePlans = trainingPlans.filter((item) => item.active);

  return <>
    <section className="sync-hero">
      <div><p className="eyebrow">CHATGPT SYNC</p><h2>一句话记录，网站立即同步</h2><p>在 ChatGPT 中调用“并肩健康”工具，饮食、训练和计划会写入这里；网页添加的记录也会被 ChatGPT 读取。</p></div>
      <span>✦</span>
    </section>
    <section className="stat-grid health-stats">
      <article className="stat-card yellow"><p>今日饮食</p><strong>{todayMeals.length}<small> 餐</small></strong><em>{todayCalories ? `${todayCalories} kcal` : "可选填热量"}</em></article>
      <article className="stat-card mint"><p>今日训练</p><strong>{todayTraining.length}<small> 项</small></strong><em>{todayMinutes ? `${todayMinutes} 分钟` : "还没有时长"}</em></article>
      <article className="stat-card coral"><p>执行中计划</p><strong>{activePlans.length}<small> 个</small></strong><em>个人记录仅你可见</em></article>
    </section>
    <section className="page-grid health-layout">
      <div className="main-column">
        <article className="card">
          <div className="card-head"><div><p className="eyebrow">NUTRITION</p><h2>饮食记录</h2></div><details><summary className="primary-button small">＋ 添加饮食</summary><MealForm today={today} /></details></div>
          <div className="health-list">{meals.map((item) => <div className="health-list-row" key={item.id}>
            <span className="meal-badge">{mealLabels[item.meal_type]}</span>
            <div><strong>{item.food}</strong><small>{dateLabel(item.record_date)}{item.notes ? ` · ${item.notes}` : ""}</small><div className="macro-line">{item.calories !== null && <span>{item.calories} kcal</span>}{item.protein_grams !== null && <span>蛋白质 {item.protein_grams}g</span>}{item.carbs_grams !== null && <span>碳水 {item.carbs_grams}g</span>}{item.fat_grams !== null && <span>脂肪 {item.fat_grams}g</span>}</div></div>
            {item.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}
            <form action={deleteMeal}><input type="hidden" name="id" value={item.id} /><button className="icon-button" aria-label={`删除 ${item.food}`}>×</button></form>
          </div>)}{!meals.length && <p className="muted list-empty">还没有饮食记录。可以从网页添加，也可以让 ChatGPT 帮你记。</p>}</div>
        </article>
        <article className="card">
          <div className="card-head"><div><p className="eyebrow">PERSONAL TRAINING</p><h2>每日训练</h2></div><details><summary className="primary-button small">＋ 添加训练</summary><TrainingEntryForm today={today} /></details></div>
          <div className="health-list">{trainingEntries.map((item) => <div className={`health-list-row training-record ${item.completed ? "completed" : ""}`} key={item.id}>
            <form action={toggleTrainingEntry}><input type="hidden" name="id" value={item.id} /><button className="check-button" aria-label="切换训练完成状态">{item.completed ? "✓" : ""}</button></form>
            <div><strong>{item.activity}</strong><small>{dateLabel(item.record_date)}{item.duration_minutes ? ` · ${item.duration_minutes} 分钟` : ""}{item.notes ? ` · ${item.notes}` : ""}</small></div>
            {item.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}
            <form action={deleteTrainingEntry}><input type="hidden" name="id" value={item.id} /><button className="icon-button" aria-label={`删除 ${item.activity}`}>×</button></form>
          </div>)}{!trainingEntries.length && <p className="muted list-empty">还没有个人训练记录。</p>}</div>
        </article>
      </div>
      <aside className="side-column">
        <article className="card">
          <div className="card-head"><div><p className="eyebrow">TRAINING PLANS</p><h2>训练计划</h2></div><details><summary className="mini-add">＋</summary><TrainingPlanForm today={today} /></details></div>
          <div className="plan-list">{trainingPlans.map((plan) => <article className={plan.active ? "active" : ""} key={plan.id}>
            <header><strong>{plan.title}</strong>{plan.source === "chatgpt" && <em className="source-badge">ChatGPT</em>}</header>
            <small>{plan.start_date}{plan.end_date ? ` → ${plan.end_date}` : " 起"}</small>
            <p>{plan.content}</p>
            <div><form action={toggleTrainingPlan}><input type="hidden" name="id" value={plan.id} /><button className="text-button">{plan.active ? "标记完成" : "重新启用"}</button></form><form action={deleteTrainingPlan}><input type="hidden" name="id" value={plan.id} /><button className="text-button danger">删除</button></form></div>
          </article>)}{!trainingPlans.length && <p className="muted list-empty">还没有训练计划。</p>}</div>
        </article>
        <article className="privacy-note"><strong>同步说明</strong><p>普通 ChatGPT 对话不会被网站读取。只有你明确调用“并肩健康”工具时，相关字段才会写入本站。</p></article>
      </aside>
    </section>
  </>;
}

function MealForm({ today }: { today: string }) {
  return <form action={saveMeal} className="popover-form"><h3>添加饮食</h3><div className="form-grid"><label>日期<input name="date" type="date" defaultValue={today} required /></label><label>餐次<select name="mealType" defaultValue="breakfast"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option></select></label></div><label>吃了什么<textarea name="food" maxLength={500} placeholder="例如：鸡蛋 2 个、燕麦 50g、牛奶 250ml" required /></label><div className="nutrition-grid"><label>热量 kcal<input name="calories" type="number" min="0" /></label><label>蛋白质 g<input name="proteinGrams" type="number" min="0" step="0.1" /></label><label>碳水 g<input name="carbsGrams" type="number" min="0" step="0.1" /></label><label>脂肪 g<input name="fatGrams" type="number" min="0" step="0.1" /></label></div><label>备注<input name="notes" maxLength={300} /></label><button className="primary-button">保存饮食</button></form>;
}

function TrainingEntryForm({ today }: { today: string }) {
  return <form action={saveTrainingEntry} className="popover-form"><h3>添加每日训练</h3><label>日期<input name="date" type="date" defaultValue={today} required /></label><label>训练内容<input name="activity" maxLength={200} placeholder="例如：深蹲 5×5 + 慢跑 30 分钟" required /></label><label>总时长（分钟）<input name="durationMinutes" type="number" min="1" max="1440" /></label><label>备注<input name="notes" maxLength={300} /></label><label className="inline-check"><input name="completed" type="checkbox" defaultChecked /> 已完成</label><button className="primary-button">保存训练</button></form>;
}

function TrainingPlanForm({ today }: { today: string }) {
  return <form action={saveTrainingPlan} className="popover-form"><h3>新建训练计划</h3><label>计划名称<input name="title" maxLength={100} placeholder="例如：四周增肌计划" required /></label><div className="form-grid"><label>开始日期<input name="startDate" type="date" defaultValue={today} required /></label><label>结束日期<input name="endDate" type="date" /></label></div><label>计划内容<textarea name="content" maxLength={3000} placeholder="例如：周一胸肩，周三腿，周五背臂；每次训练后低强度有氧 20 分钟。" required /></label><button className="primary-button">保存计划</button></form>;
}

function WorkoutPage({ selectedGroup, workouts, members, today }: { selectedGroup: Group | null; workouts: Workout[]; members: Member[]; today: string }) {
  if (!selectedGroup) return <EmptyGroup />;
  const grouped = [...workouts]
    .sort((a, b) => b.workout_date.localeCompare(a.workout_date))
    .reduce((map, item) => {
      const list = map.get(item.workout_date) ?? [];
      list.push(item);
      map.set(item.workout_date, list);
      return map;
    }, new Map<string, Workout[]>());
  return <section><div className="section-toolbar"><div><p className="muted">自由填写项目，成员都可以共同维护</p></div><details><summary className="primary-button">＋ 添加运动</summary><WorkoutForm groupId={selectedGroup.id} members={members} today={today} /></details></div><div className="calendar-list">{Array.from(grouped).map(([date, items]) => <article className="card day-card" key={date}><header><time><strong>{new Date(`${date}T00:00:00`).getDate()}</strong><span>{dateLabel(date)}<small>{date === today ? "今天" : ""}</small></span></time><span>{items.filter((item) => item.completed).length}/{items.length} 完成</span></header><div>{items.map((item) => <div className={`workout-row ${item.completed ? "completed" : ""}`} key={item.id}><form action={toggleWorkout}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="groupId" value={selectedGroup.id} /><button className="check-button" aria-label="切换完成状态">{item.completed ? "✓" : ""}</button></form><div><strong>{item.activity}</strong><small>{item.display_name}{item.duration_minutes ? ` · ${item.duration_minutes} 分钟` : ""}{item.notes ? ` · ${item.notes}` : ""}</small></div><details><summary className="icon-button">•••</summary><WorkoutForm groupId={selectedGroup.id} members={members} today={today} workout={item} /><form action={deleteWorkout} className="delete-form"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="groupId" value={selectedGroup.id} /><button>删除这项运动</button></form></details></div>)}</div></article>)}{!workouts.length && <div className="card empty-state"><span className="empty-icon">◫</span><h2>还没有运动安排</h2><p>把你们想做的运动直接写进日历。</p></div>}</div></section>;
}

function WorkoutForm({ groupId, members, today, workout }: { groupId: string; members: Member[]; today: string; workout?: Workout }) {
  return <form action={saveWorkout} className="popover-form"><h3>{workout ? "编辑运动" : "添加运动"}</h3><input type="hidden" name="groupId" value={groupId} />{workout && <input type="hidden" name="id" value={workout.id} />}<label>日期<input name="date" type="date" defaultValue={workout?.workout_date ?? today} required /></label><label>运动项目<input name="activity" defaultValue={workout?.activity} placeholder="例如：慢跑 5 公里" required maxLength={80} /></label><div className="form-grid"><label>执行人<select name="assigneeId" defaultValue={workout?.user_id}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label><label>时长（分钟）<input name="durationMinutes" type="number" min="1" max="1440" defaultValue={workout?.duration_minutes ?? ""} /></label></div><label>备注<input name="notes" defaultValue={workout?.notes} maxLength={200} /></label><label className="inline-check"><input name="completed" type="checkbox" defaultChecked={Boolean(workout?.completed)} /> 已完成</label><button className="primary-button">保存</button></form>;
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
