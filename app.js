/* 理財勇者 — 核心邏輯（localStorage，無後端） */
'use strict';

/* ===================== 常數 ===================== */
const LS_KEY = 'frpg_v1';

const CATS = [
  { id: 'food', name: '餐飲／超市' },
  { id: 'transport', name: '交通' },
  { id: 'shopping', name: '購物' },
  { id: 'fun', name: '娛樂' },
  { id: 'bills', name: '帳單' },
  { id: 'other', name: '其他' },
];

const INTENTS = [
  { id: 'need', name: '生活必需' },
  { id: 'joy', name: '值得享受' },
  { id: 'impulse', name: '一時衝動' },
];

const SHOP = [
  { id: 'sword', name: '勇者之劍', cost: 300, once: true, desc: '對慾望魔王嘅攻擊力 +15%（儲蓄傷害加成）' },
  { id: 'charm', name: '幸運咒文', cost: 250, once: true, desc: '記帳時寶箱出現率 +10%' },
  { id: 'shield', name: '收隊徽章', cost: 120, once: true, desc: '永久裝備：每日完成金流盤點，額外獲得 10G' },
  { id: 'cape', name: '黃金披風', cost: 800, once: true, desc: '傳說裝飾：勇者全身發出金光，彰顯理財大師身份' },
];

const QUESTS = [
  { id: 'q_checkin', outcome: '日常掌控', name: '完成今日 Check-in', desc: '記低任何金流，或者確認今日零日常消費。', target: 1, gold: 20 },
  { id: 'q_review', outcome: '今日收隊', name: '完成今日金流盤點', desc: '睇一眼日常、固定、收入同還款，確認今日輪廓。', target: 1, gold: 30 },
  { id: 'q_story', outcome: '有意識選擇', name: '說清一個今日選擇', desc: '為支出補上故事；零日常消費亦係一次主動選擇。', target: 1, gold: 40 },
];
const WEEKLY_QUESTS = FinanceGameplay.WEEKLY_QUESTS;
const GOAL_TYPES = FinanceGameplay.GOAL_TYPES;

/* ===================== 狀態 ===================== */
const defaults = () => ({
  onboarded: false,
  heroName: '勇者',
  heroType: 'male',
  monthlyBudget: 8000,
  saveRate: 0.2,
  finProfile: null,        // {incomeType:'fixed'|'variable', income, savings}
  debts: [],               // {id, name, orig, balance}
  repayments: [],          // {id, ts, debtId, amount}
  creditCards: [],         // {id, name, last4, creditLimit, currentBalance, statementDay, dueDay, annualRate}
  installments: [],        // {id, cardId, principal, termMonths, schedule:[]}
  cardPayments: [],        // {id, cardId, amount, dateKey, ts}
  incomes: [],             // {id, ts, dateKey, source, amount}
  goals: [],               // {id, name, type, target, initialAmount, deadline, rewarded, completedAt}
  goalContributions: [],   // {id, goalId, amount, source:'new_saving'|'allocated', dateKey, ts}
  goalRewardWeeks: {},     // weekKey -> rewarded goal id
  activeGoalId: null,
  decisionEncounters: [],  // {id, name, amount, source, intent, status, revisitAt, createdAt}
  gold: 0, xp: 0, level: 1,
  streak: 0, lastLogDate: null, // streak 保留舊欄位名，現代表累積同行日
  items: { sword: 0, charm: 0, shield: 0, cape: 0 },
  expenses: [],            // {id, ts, dateKey, cat, amount, budgetImpact:'daily'|'committed', intent?}
  dayMeta: {},             // dateKey -> {chests, noSpend, reviewed, reviewRewarded, questsClaimed:[]}
  weekMeta: {},            // weekKey -> {questsClaimed:[], bonusClaimed:false}
  boss: { weekKey: null, claimed: false },
});

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const base = defaults();
      const state = Object.assign(base, parsed);
      state.items = Object.assign(defaults().items, parsed.items || {});
      state.dayMeta = state.dayMeta || {};
      state.weekMeta = state.weekMeta || {};
      state.goals = Array.isArray(state.goals) ? state.goals : [];
      state.goalContributions = Array.isArray(state.goalContributions) ? state.goalContributions : [];
      state.goalRewardWeeks = state.goalRewardWeeks && typeof state.goalRewardWeeks === 'object' ? state.goalRewardWeeks : {};
      state.decisionEncounters = Array.isArray(state.decisionEncounters) ? state.decisionEncounters : [];
      return state;
    }
  } catch (e) {}
  return defaults();
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(S)); }

/* ===================== 日期 ===================== */
const pad = (n) => String(n).padStart(2, '0');
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return keyOf(new Date()); }
function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return keyOf(d); }
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function mondayOf(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekKey() { return keyOf(mondayOf(new Date())); }
function weekDays() { // 本週一至今日嘅 dateKey
  const start = mondayOf(new Date()), out = [];
  const today = todayKey();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = keyOf(d);
    out.push(k);
    if (k === today) break;
  }
  return out;
}
function fullWeekDays() {
  const start = mondayOf(new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return keyOf(day);
  });
}

/* ===================== 衍生數值 ===================== */
const dailyBudget = () => Math.round(S.monthlyBudget / 30);
const weeklyBudget = () => dailyBudget() * 7;
const bossMaxHp = () => Math.max(1, Math.round(weeklyBudget() * S.saveRate));
const swordMult = () => (S.items.sword ? 1.15 : 1);
const chestChance = () => 0.3 + (S.items.charm ? 0.1 : 0);

function expenseBudgetImpact(expense) {
  if (expense && expense.budgetImpact === 'committed') return 'committed';
  if (expense && expense.source === 'installment') return 'committed';
  return 'daily';
}
function daySpend(k) {
  return S.expenses.reduce((sum, expense) => (
    expense.dateKey === k && expenseBudgetImpact(expense) === 'daily' ? sum + expense.amount : sum
  ), 0);
}
function dayCommittedSpend(k) {
  return S.expenses.reduce((sum, expense) => (
    expense.dateKey === k && expenseBudgetImpact(expense) === 'committed' ? sum + expense.amount : sum
  ), 0);
}
function safeToSpendToday() {
  const now = new Date();
  const mk = monthKey();
  const scheduledCommitments = window.FinanceAdvisor ? FinanceAdvisor.monthCommitments(S, mk) : 0;
  const base = Math.max(0, Math.round(S.monthlyBudget / 30));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const spentBeforeToday = S.expenses.reduce((sum, expense) => (
    expense.dateKey.startsWith(mk) && expense.dateKey < todayKey() && expenseBudgetImpact(expense) === 'daily' ? sum + expense.amount : sum
  ), 0);
  const priorActiveDays = new Set(S.expenses
    .filter((expense) => expense.dateKey.startsWith(mk) && expense.dateKey < todayKey())
    .map((expense) => expense.dateKey));
  Object.keys(S.dayMeta).forEach((key) => {
    if (key.startsWith(mk) && key < todayKey() && S.dayMeta[key].noSpend) priorActiveDays.add(key);
  });
  const remainingMonth = Math.max(0, S.monthlyBudget - spentBeforeToday);
  const rawSafe = Math.max(0, Math.round(remainingMonth / Math.max(1, daysLeft)));
  const calibrated = priorActiveDays.size > 0;
  const safe = calibrated ? Math.min(rawSafe, Math.round(base * 1.25)) : base;
  return { safe, base, rawSafe, calibrated, remainingMonth, daysLeft, spentBeforeToday, scheduledCommitments };
}
function dayActive(k) {
  return (S.dayMeta[k] && S.dayMeta[k].noSpend) || S.expenses.some((e) => e.dateKey === k);
}
function dayHasMoneyActivity(k) {
  return dayActive(k)
    || (S.incomes || []).some((entry) => entry.dateKey === k)
    || (S.cardPayments || []).some((entry) => entry.dateKey === k)
    || (S.goalContributions || []).some((entry) => entry.dateKey === k)
    || (S.repayments || []).some((entry) => entry.ts && keyOf(new Date(entry.ts)) === k);
}
function moneyActivityCount(k) {
  return S.expenses.filter((entry) => entry.dateKey === k).length
    + (S.incomes || []).filter((entry) => entry.dateKey === k).length
    + (S.cardPayments || []).filter((entry) => entry.dateKey === k).length
    + (S.goalContributions || []).filter((entry) => entry.dateKey === k).length
    + (S.repayments || []).filter((entry) => entry.ts && keyOf(new Date(entry.ts)) === k).length;
}
function meta(k) {
  if (!S.dayMeta[k]) S.dayMeta[k] = { chests: 0, noSpend: false, reviewed: false, reviewRewarded: false, questsClaimed: [] };
  if (typeof S.dayMeta[k].reviewed !== 'boolean') S.dayMeta[k].reviewed = false;
  if (typeof S.dayMeta[k].reviewRewarded !== 'boolean') S.dayMeta[k].reviewRewarded = false;
  if (!S.dayMeta[k].questsClaimed) S.dayMeta[k].questsClaimed = [];
  return S.dayMeta[k];
}
function invalidateReview(k) {
  if (k === todayKey()) meta(k).reviewed = false;
}
// 每日傷害有上限，讓魔王反映一週節奏，而唔係被單日數字扭曲。
function dayDmgCap() { return Math.ceil(bossMaxHp() / 5); }
function bossDamage() {
  let dmg = 0;
  for (const k of weekDays()) {
    if (!dayActive(k)) continue; // 唔記帳唔計儲蓄，防止「唔記＝儲晒」
    const saved = Math.max(0, dailyBudget() - daySpend(k));
    dmg += Math.min(saved * swordMult(), dayDmgCap());
  }
  return Math.min(bossMaxHp(), Math.round(dmg));
}
function xpNeed(l) { return Math.round(100 * Math.pow(l, 1.3)); }
function logsToday() { return S.expenses.filter((e) => e.dateKey === todayKey()).length; }
function dailyLogsToday() { return S.expenses.filter((e) => e.dateKey === todayKey() && expenseBudgetImpact(e) === 'daily').length; }
function totalDebt() { return S.debts.reduce((s, d) => s + d.balance, 0); }
function liveDebts() { return S.debts.filter((d) => d.balance > 0); }
// 雪球還債法：由最細餘額嗰條開始
function snowballOrder() { return [...liveDebts()].sort((a, b) => a.balance - b.balance); }
function armorInfo() {
  const savings = S.finProfile ? S.finProfile.savings : 0;
  const months = savings / Math.max(1, S.monthlyBudget);
  if (months < 1) return { name: '布衣', months, next: '儲夠 1 個月日常使費升級皮甲' };
  if (months < 3) return { name: '皮甲', months, next: '儲夠 3 個月日常使費升級鐵甲' };
  if (months < 6) return { name: '鐵甲', months, next: '儲夠 6 個月日常使費升級龍鱗甲' };
  return { name: '龍鱗甲', months, next: '' };
}

/* ===================== 藝術資源（PNG 未有時用 SVG 佔位） ===================== */
const P = {
  hero: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="38" y="14" width="24" height="20" rx="4" fill="#ffd9b3"/><rect x="36" y="8" width="28" height="10" rx="3" fill="#7a4a21"/><rect x="42" y="22" width="5" height="4" fill="#3b2a1a"/><rect x="54" y="22" width="5" height="4" fill="#3b2a1a"/><rect x="34" y="36" width="32" height="30" rx="6" fill="#2ea75f"/><rect x="30" y="38" width="8" height="22" rx="3" fill="#ffd9b3"/><rect x="62" y="38" width="8" height="22" rx="3" fill="#ffd9b3"/><rect x="40" y="68" width="8" height="18" rx="3" fill="#5a3d20"/><rect x="52" y="68" width="8" height="18" rx="3" fill="#5a3d20"/><rect x="66" y="26" width="6" height="26" rx="2" fill="#a97142" transform="rotate(18 69 39)"/><circle cx="30" cy="62" r="8" fill="#ffc93c"/><text x="30" y="66" font-size="9" text-anchor="middle" fill="#7a4a21" font-weight="bold">$</text></svg>`,
  boss: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="52" r="30" fill="#8b3df0"/><path d="M28 34 L36 16 L44 32 Z" fill="#8b3df0"/><path d="M72 34 L64 16 L56 32 Z" fill="#8b3df0"/><circle cx="40" cy="46" r="6" fill="#fff"/><circle cx="60" cy="46" r="6" fill="#fff"/><circle cx="41" cy="47" r="3" fill="#2a0a4a"/><circle cx="59" cy="47" r="3" fill="#2a0a4a"/><path d="M38 62 Q50 72 62 62" stroke="#2a0a4a" stroke-width="3" fill="none"/><rect x="18" y="60" width="14" height="16" rx="2" fill="#ff9f1c"/><rect x="68" y="60" width="14" height="16" rx="2" fill="#3ddc84"/></svg>`,
  'chest-closed': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="18" y="38" width="64" height="38" rx="6" fill="#8a5a2b"/><rect x="18" y="30" width="64" height="16" rx="8" fill="#a97142"/><rect x="18" y="52" width="64" height="5" fill="#6e441d"/><rect x="44" y="46" width="12" height="16" rx="2" fill="#ffc93c"/><circle cx="50" cy="53" r="2.5" fill="#7a4a21"/></svg>`,
  'chest-open': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 6 L54 22 L50 20 L46 22 Z" fill="#ffe27a"/><path d="M28 12 L38 26 L32 27 Z" fill="#ffe27a"/><path d="M72 12 L62 26 L68 27 Z" fill="#ffe27a"/><rect x="18" y="20" width="64" height="14" rx="7" fill="#a97142"/><rect x="18" y="44" width="64" height="32" rx="6" fill="#8a5a2b"/><ellipse cx="50" cy="46" rx="30" ry="8" fill="#ffc93c"/><circle cx="38" cy="42" r="5" fill="#ffd95c"/><circle cx="52" cy="40" r="5" fill="#ffd95c"/><circle cx="64" cy="43" r="5" fill="#ffd95c"/></svg>`,
  coin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="#ffc93c"/><circle cx="50" cy="50" r="26" fill="#ffb300"/><path d="M50 36 L54 46 L65 46 L56 53 L59 64 L50 57 L41 64 L44 53 L35 46 L46 46 Z" fill="#ffe27a"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 10 L82 22 V52 Q82 76 50 90 Q18 76 18 52 V22 Z" fill="#2f6df6"/><path d="M50 16 L76 26 V52 Q76 71 50 83 Q24 71 24 52 V26 Z" fill="#4b86ff"/><ellipse cx="50" cy="50" rx="14" ry="11" fill="#ff9fb6"/><circle cx="44" cy="48" r="1.8" fill="#5a2233"/><circle cx="56" cy="48" r="1.8" fill="#5a2233"/><ellipse cx="50" cy="54" rx="4" ry="3" fill="#e26e8f"/></svg>`,
  flame: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 8 Q64 28 72 44 Q80 62 68 76 Q58 88 50 88 Q42 88 32 76 Q20 62 28 44 Q36 28 50 8Z" fill="#ff7b2e"/><path d="M50 34 Q58 46 61 56 Q64 68 56 75 Q52 79 50 79 Q48 79 44 75 Q36 68 39 56 Q42 46 50 34Z" fill="#ffc93c"/><circle cx="45" cy="62" r="2.5" fill="#5a2a00"/><circle cx="55" cy="62" r="2.5" fill="#5a2a00"/></svg>`,
};
function svgUri(key) { return 'data:image/svg+xml;utf8,' + encodeURIComponent(P[key]); }
function initArt(root) {
  (root || document).querySelectorAll('img[data-art]').forEach((img) => {
    const key = img.dataset.art;
    img.onerror = () => {
      img.onerror = null;
      const fallbackKey = key === 'hero-female' ? 'hero' : key;
      if (P[fallbackKey]) img.src = svgUri(fallbackKey);
    };
    img.src = `assets/${key}.png`;
  });
}

function setHeroArt(img, heroType) {
  const key = heroType === 'female' ? 'hero-female' : 'hero';
  if (img.dataset.art === key && img.src.includes(`/assets/${key}.png`)) return;
  img.dataset.art = key;
  img.onerror = () => { img.onerror = null; img.src = svgUri('hero'); };
  img.src = `assets/${key}.png`;
}

/* ===================== SVG icons（避開 emoji） ===================== */
const I = {
  coin: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#ffc93c"/><circle cx="12" cy="12" r="6.2" fill="#ffb300"/><path d="M12 8.6l.9 2.1 2.3.2-1.7 1.5.5 2.2-2-1.2-2 1.2.5-2.2-1.7-1.5 2.3-.2z" fill="#ffe27a"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2c2.5 3.5 5.5 6.5 5.5 10.5S14.5 20 12 20s-5.5-3.5-5.5-7.5S9.5 5.5 12 2z" fill="#ff7b2e"/><path d="M12 9c1.2 1.8 2.2 3 2.2 4.8S13 17.5 12 17.5 9.8 15.6 9.8 13.8 10.8 10.8 12 9z" fill="#ffc93c"/></svg>`,
  swords: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l10 10M4 4v4M4 4h4M20 4L10 14M20 4v4M20 4h-4M7 17l-2 2M17 17l2 2M6 14l4 4M18 14l-4 4"/></svg>`,
  scroll: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H8a2 2 0 01-2-2V4z"/><path d="M6 4a2 2 0 00-2 2v2h4"/><path d="M10 9h6M10 13h6M10 17h4"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15zM19 13l.7 2.3L22 16l-2.3.7L19 19l-.7-2.3L16 16l2.3-.7L19 13z"/></svg>`,
  bag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8h14l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8z"/><path d="M8 8V6a4 4 0 018 0v2"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M20 20H4"/></svg>`,
  food: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffc93c" stroke-width="2" stroke-linecap="round"><path d="M4 11h16a8 8 0 01-16 0z" fill="#3a2b6b"/><path d="M8 8c0-1 .5-2 .5-2M12 8c0-1 .5-2 .5-2M16 8c0-1 .5-2 .5-2"/></svg>`,
  transport: `<svg viewBox="0 0 24 24" fill="none" stroke="#7fd0ff" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="13" rx="3" fill="#3a2b6b"/><path d="M4 10h16M8 21l1-4M16 21l-1-4"/><circle cx="8.5" cy="14" r="1" fill="#7fd0ff"/><circle cx="15.5" cy="14" r="1" fill="#7fd0ff"/></svg>`,
  shopping: `<svg viewBox="0 0 24 24" fill="none" stroke="#ff9fb6" stroke-width="2" stroke-linecap="round"><path d="M5 8h14l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8z" fill="#3a2b6b"/><path d="M8 8V6a4 4 0 018 0v2"/></svg>`,
  fun: `<svg viewBox="0 0 24 24" fill="none" stroke="#9d6bff" stroke-width="2" stroke-linecap="round"><rect x="3" y="7" width="18" height="11" rx="5" fill="#3a2b6b"/><path d="M8 11v4M6 13h4"/><circle cx="16" cy="12" r="1" fill="#9d6bff"/><circle cx="18.5" cy="14" r="1" fill="#9d6bff"/></svg>`,
  bills: `<svg viewBox="0 0 24 24" fill="none" stroke="#3ddc84" stroke-width="2" stroke-linecap="round"><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" fill="#3a2b6b"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>`,
  other: `<svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="2" fill="#a493d6"/><circle cx="12" cy="12" r="2" fill="#a493d6"/><circle cx="18" cy="12" r="2" fill="#a493d6"/></svg>`,
  sword: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffc93c" stroke-width="2" stroke-linecap="round"><path d="M5 19L17 7l2-4-4 2L3 17M5 19l-2 2M5 19l2 2M14 16l4 4"/></svg>`,
  charm: `<svg viewBox="0 0 24 24" fill="none" stroke="#9d6bff" stroke-width="2" stroke-linecap="round"><path d="M12 3l2.3 4.7 5.2.7-3.8 3.6.9 5.1L12 14.7 7.4 17.1l.9-5.1L4.5 8.4l5.2-.7z" fill="#3a2b6b"/></svg>`,
  cape: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffc93c" stroke-width="2" stroke-linecap="round"><path d="M12 3c-4 0-6 3-6 3l-2 14 5-3 3 4 3-4 5 3-2-14s-2-3-6-3z" fill="#5a4200"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="#3ddc84" stroke-width="3" stroke-linecap="round"><path d="M4 13l5 5L20 6"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a8 8 0 01-8 8H5l-3 2 1-5a9 9 0 1118-5z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.55.83l9-6.5a1 1 0 000-1.66l-9-6.5A1 1 0 008 5.5z"/></svg>`,
};
function initIcons(root) {
  (root || document).querySelectorAll('.icon[data-icon]').forEach((el) => {
    el.innerHTML = I[el.dataset.icon] || '';
  });
}

/* ===================== DOM helpers ===================== */
const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
function periodInfo() {
  const hour = new Date().getHours();
  if (hour < 6) return { id: 'night', label: '深夜', greeting: '夜深喇' };
  if (hour < 12) return { id: 'morning', label: '早晨', greeting: '早晨' };
  if (hour < 18) return { id: 'day', label: '午後', greeting: '午安' };
  return { id: 'night', label: '夜晚', greeting: '夜晚好' };
}

function softVibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern || 8);
}

function pulseScene() {
  const stage = $('camp-stage');
  if (!stage) return;
  stage.classList.remove('scene-pulse');
  void stage.offsetWidth;
  stage.classList.add('scene-pulse');
}

let dialogueTimer = null;
let dialogueFinish = null;
let activeDialogueKey = '';
let homeReminder = null;

function closeSceneDialogue() {
  clearInterval(dialogueTimer);
  dialogueTimer = null;
  dialogueFinish = null;
  $('dialogue-panel').classList.add('hidden');
  $('home-reminder-button').setAttribute('aria-expanded', 'false');
}

function renderDialogueChoices(choices) {
  const box = $('dialogue-choices');
  box.innerHTML = '';
  (choices || []).forEach((choice) => {
    const button = document.createElement('button');
    button.className = `dialogue-choice${choice.primary ? ' primary' : ''}`;
    button.textContent = choice.label;
    button.onclick = () => {
      softVibrate(6);
      closeSceneDialogue();
      choice.action();
    };
    box.appendChild(button);
  });
}

function speak(speaker, text, choices, immediate) {
  clearInterval(dialogueTimer);
  $('dialogue-panel').classList.remove('hidden');
  $('home-reminder-button').setAttribute('aria-expanded', 'true');
  const speakerEl = $('dialogue-speaker');
  const textEl = $('dialogue-text');
  const choiceBox = $('dialogue-choices');
  speakerEl.textContent = speaker;
  textEl.textContent = '';
  choiceBox.innerHTML = '';

  let index = 0;
  const finish = () => {
    clearInterval(dialogueTimer);
    textEl.textContent = text;
    renderDialogueChoices(choices);
    dialogueFinish = null;
  };
  dialogueFinish = finish;
  textEl.onclick = () => {
    if (dialogueFinish) dialogueFinish();
  };

  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }
  dialogueTimer = setInterval(() => {
    index++;
    textEl.textContent = text.slice(0, index);
    if (index >= text.length) finish();
  }, 18);
}

function sceneChoices(objective) {
  return [{ label: objective.label, primary: true, action: objective.action }];
}

function openHomeReminder() {
  if (!homeReminder) renderSceneDialogue();
  if (!homeReminder) return;
  speak(homeReminder.speaker, homeReminder.text, homeReminder.choices);
}

function maybeOpenDailyReminder() {
  if (!S.onboarded || !S.finProfile) return;
  const key = `finance-rpg-reminder-${todayKey()}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, 'shown');
  } catch (error) {
    // Storage can be unavailable in private browsing; the reminder still works manually.
  }
  setTimeout(() => {
    if (activeScreenName === 'home' && $('dialogue-panel').classList.contains('hidden')) openHomeReminder();
  }, 450);
}

function showAdviceDialogue() {
  activeDialogueKey = 'advice';
  const advice = buildAdvice()[0];
  const objective = buildObjective();
  const text = advice
    ? `${advice.t}。${advice.b}`
    : '你已經打好基礎。依家最重要係維持每日記帳，等每一個小決定都有跡可尋。';
  speak('錢錢軍師', text, [
    { label: '照住做', primary: true, action: objective.action },
    { label: '返回', action: () => renderSceneDialogue(true) },
  ]);
}

function showStatusDialogue() {
  activeDialogueKey = 'status';
  const spent = daySpend(todayKey());
  const committed = dayCommittedSpend(todayKey());
  const pace = safeToSpendToday();
  const left = pace.safe - spent;
  const dmg = bossDamage();
  const max = bossMaxHp();
  const commitmentNote = pace.scheduledCommitments > 0 ? `本月另有 ${fmt(pace.scheduledCommitments)} 分期承諾，會獨立顯示。` : '';
  const paceBasis = pace.calibrated
    ? `${commitmentNote}呢個數已按日常預算剩餘 ${fmt(pace.remainingMonth)} 同 ${pace.daysLeft} 日路程調整。`
    : `${commitmentNote}暫時先用日常預算每日平均 ${fmt(pace.base)}；有一日完整紀錄後，我先開始校準。`;
  const committedNote = committed > 0 ? `今日另記咗 ${fmt(committed)} 固定／預留支出，冇扣日常額度。` : '';
  const text = left >= 0
    ? `今日記咗 ${logsToday()} 筆，仲有 ${fmt(left)} 日常安心額。${committedNote}${paceBasis}本週對魔王造成咗 ${fmt(dmg)} 傷害。`
    : `今日記咗 ${logsToday()} 筆，暫時比安心額度多 ${fmt(Math.abs(left))}。唔需要懲罰自己，我哋已經知道情況，之後每一筆都可以重新選擇。`;
  speak('錢錢軍師', text, [
    { label: '返回今日提醒', primary: true, action: () => renderSceneDialogue(true) },
  ]);
}

function renderSceneDialogue(force) {
  const objective = buildObjective();
  const spent = daySpend(todayKey());
  const pace = safeToSpendToday();
  const active = dayHasMoneyActivity(todayKey());
  const returning = S.lastLogDate && S.lastLogDate < yesterdayKey();
  const dead = bossDamage() >= bossMaxHp();
  const period = periodInfo();
  const pendingDecision = dueDecision();
  const key = [todayKey(), S.heroName, pace.safe, bossMaxHp(), spent, logsToday(), bossDamage(), S.boss.claimed, S.lastLogDate, objective.label].join('|');
  if (!force && activeDialogueKey === key && homeReminder) return;
  activeDialogueKey = key;

  let text;
  if (dead && !S.boss.claimed) {
    text = `${S.heroName}，你做到了！慾望魔王已經倒下，今週每一次克制都冇白費。先收好獎勵啦。`;
  } else if (pendingDecision) {
    text = `${S.heroName}，「${pendingDecision.name}」已經喺卷軸入面休息咗 24 小時。依家再望一次數字同感受，答案可能比昨日清楚。`;
  } else if (!active && returning) {
    text = `${period.greeting}，${S.heroName}，歡迎返嚟。唔使補晒之前日子，過去努力亦冇消失；今日記一筆，就可以由而家重新開始。`;
  } else if (!active) {
    text = `${period.greeting}，${S.heroName}。今日有 ${fmt(pace.safe)} 日常安心額。固定承諾會另行記錄，唔會一筆打亂今日節奏。`;
  } else if (spent > pace.safe) {
    text = `今日已經用過安心額度。記帳唔係審判；肯望清楚發生咗咩，就已經停止咗逃避，下一筆仍然有選擇。`;
  } else if (!meta(todayKey()).reviewed) {
    text = `做得好，${S.heroName}。今日已有 ${moneyActivityCount(todayKey())} 個金流足印，仲有 ${fmt(Math.max(0, pace.safe - spent))} 可以安心使用。準備好就做今日盤點，唔需要為任務湊數。`;
  } else {
    text = '今日盤點完成。你嘅每筆選擇都已經寫入冒險手帳，剩返嘅能量會喺今晚化成對魔王嘅傷害。';
  }
  homeReminder = { speaker: '錢錢軍師', text, choices: sceneChoices(objective) };
  $('home-reminder-label').textContent = objective.label;
  $('home-reminder-button').setAttribute('aria-label', `軍師提醒：${objective.label}`);
  $('home-reminder-button').title = `軍師提醒：${objective.label}`;
  if (force) openHomeReminder();
}

let pendingChestTimer = null;
let pendingIntent = null;
function showExpenseReaction(cid, amount, first, expenseId) {
  const expense = S.expenses.find((item) => item.id === expenseId);
  if (!expense || expense.intent) return;
  pendingIntent = { cid, amount, first, expenseId };
  activeDialogueKey = `expense-${Date.now()}`;
  const cat = CATS.find((c) => c.id === cid);
  const left = safeToSpendToday().safe - daySpend(todayKey());
  const text = left >= 0
    ? `${cat.name} ${fmt(amount)}，收到。今日仲有 ${fmt(left)} 可以安心使用${first ? '，寶箱亦醒咗。' : '。'} 幫我補完故事：呢筆係？`
    : `${cat.name} ${fmt(amount)}，已經記低。雖然暫時多咗 ${fmt(Math.abs(left))}，但你冇逃避。唔需要解釋，只要話我知：呢筆係？`;
  pulseScene();
  speak('錢錢軍師', text, INTENTS.map((intent, index) => ({
    label: intent.name,
    primary: index === 0,
    action: () => tagExpenseIntent(expenseId, intent.id, first),
  })));
}

function tagExpenseIntent(expenseId, intentId, guaranteedChest) {
  const expense = S.expenses.find((item) => item.id === expenseId);
  const intent = INTENTS.find((item) => item.id === intentId);
  if (!expense || !intent) return;
  expense.intent = intentId;
  if (pendingIntent && pendingIntent.expenseId === expenseId) pendingIntent = null;
  save();
  renderAll();
  clearTimeout(pendingChestTimer);
  pendingChestTimer = setTimeout(() => maybeChest(guaranteedChest), 350);
  const replies = {
    need: '生活需要係地圖，唔係失敗。知道基本開支有幾多，之後先可以守住真正重要嘅選擇。',
    joy: '有意識嘅享受都值得被預算保護。你知道自己用錢換咗乜，呢筆就唔只係一個數字。',
    impulse: '肯承認一時衝動，已經打斷咗自動駕駛。下一次付款前停三秒，就係一個新選擇。',
  };
  activeDialogueKey = `intent-${expenseId}`;
  speak('錢錢軍師', replies[intentId], sceneChoices(buildObjective()));
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}
function closePopup() {
  $('pop-mask').classList.add('hidden');
}
function popup(title, bodyHtml, options) {
  const settings = options || {};
  const confirm = $('pop-close');
  const cancel = $('pop-cancel');
  $('pop-title').textContent = title;
  $('pop-body').innerHTML = bodyHtml;
  confirm.textContent = settings.confirmLabel || '好';
  cancel.textContent = settings.cancelLabel || '取消';
  cancel.classList.toggle('hidden', !settings.cancelLabel);
  confirm.onclick = () => {
    closePopup();
    if (settings.onConfirm) settings.onConfirm();
  };
  cancel.onclick = () => {
    closePopup();
    if (settings.onCancel) settings.onCancel();
  };
  $('pop-mask').classList.remove('hidden');
  initArt($('pop-box')); initIcons($('pop-box'));
}

/* ===================== 獎勵 ===================== */
function gainGold(n) { S.gold += n; }
function gainXp(n) {
  S.xp += n;
  let leveled = false;
  while (S.xp >= xpNeed(S.level)) {
    S.xp -= xpNeed(S.level);
    S.level++;
    leveled = true;
    gainGold(25 * S.level);
  }
  if (leveled) {
    popup(`升呢！Lv.${S.level}`, `<p style="color:var(--dim);font-size:13px;line-height:1.6">勇者更強大喇！<br>升級獎勵 <b style="color:var(--gold)">${25 * S.level} 金幣</b> 已入袋。</p>`);
  }
}

/* ===================== 累積同行日 ===================== */
function touchStreak() {
  const t = todayKey();
  if (S.lastLogDate === t) return;
  S.streak = Math.max(0, Number(S.streak) || 0) + 1;
  S.lastLogDate = t;
}

/* ===================== 寶箱 ===================== */
let chestPending = null;
function maybeChest(guaranteed) {
  if (guaranteed || Math.random() < chestChance()) {
    const r = Math.random();
    let gold;
    if (r < 0.05) gold = 100 + Math.floor(Math.random() * 50);
    else if (r < 0.35) gold = 25 + Math.floor(Math.random() * 35);
    else gold = 5 + Math.floor(Math.random() * 18);
    chestPending = { gold };
    const img = $('chest-img');
    img.dataset.art = 'chest-closed';
    img.onerror = () => { img.onerror = null; img.src = svgUri('chest-closed'); };
    img.src = 'assets/chest-closed.png';
    img.classList.add('shake'); img.classList.remove('opened');
    $('chest-title').textContent = '發現寶箱！';
    $('chest-hint').classList.remove('hidden');
    $('chest-reward').classList.add('hidden');
    $('chest-close').classList.add('hidden');
    $('chest-mask').classList.remove('hidden');
  }
}
function openChest() {
  if (!chestPending) return;
  const { gold } = chestPending;
  chestPending = null;
  const img = $('chest-img');
  img.classList.remove('shake');
  img.onerror = () => { img.onerror = null; img.src = svgUri('chest-open'); };
  img.src = 'assets/chest-open.png';
  img.classList.add('opened');
  $('chest-hint').classList.add('hidden');
  const rare = gold >= 100;
  $('chest-reward').innerHTML = `+${gold} 金幣${rare ? '<span class="sub">稀有大獎！</span>' : ''}`;
  $('chest-reward').classList.remove('hidden');
  $('chest-close').classList.remove('hidden');
  gainGold(gold);
  meta(todayKey()).chests++;
  gainXp(5);
  save(); renderAll();
  if (pendingIntent) {
    const prompt = pendingIntent;
    setTimeout(() => showExpenseReaction(prompt.cid, prompt.amount, prompt.first, prompt.expenseId), 120);
  }
}

/* ===================== 記帳 / 還債 sheet ===================== */
let selCat = null, amtStr = '0', sheetMode = 'expense', sheetBudgetImpact = 'daily', sheetRecordOptions = {};
function openLogSheet(mode, preset) {
  sheetMode = mode || 'expense';
  selCat = null; amtStr = '0'; sheetBudgetImpact = 'daily'; sheetRecordOptions = {};
  $('log-step-title').textContent = sheetMode === 'repay' ? '還俾邊條惡龍？' : '今日使咗喺邊度？';
  $('log-guide').textContent = sheetMode === 'repay'
    ? '揀一條債務惡龍。我建議先集中火力打最細嗰條。'
    : '慢慢諗，今日呢筆支出屬於邊一段生活？';
  $('log-cats').classList.remove('hidden');
  $('log-amount').classList.add('hidden');
  $('log-budget-impact').classList.add('hidden');
  renderCats();
  renderQuickLogs();
  $('log-mask').classList.remove('hidden');
  if (sheetMode === 'expense' && preset && CATS.some((category) => category.id === preset.category) && Number(preset.amount) > 0) {
    selCat = preset.category;
    amtStr = String(Number(preset.amount));
    sheetRecordOptions = {
      merchant: preset.merchant || null,
      cardId: preset.cardId || null,
      intent: preset.intent || null,
      source: preset.source || 'manual',
      decisionId: preset.decisionId || null,
    };
    const category = CATS.find((item) => item.id === selCat);
    $('log-step-title').textContent = `${category.name} — 確認呢筆支出`;
    $('log-guide').textContent = `軍師已經帶入 ${fmt(preset.amount)}；你仍然可以改金額同預算分類，確認後先會寫入手帳。`;
    $('log-quick').classList.add('hidden');
    $('log-cats').classList.add('hidden');
    $('log-amount').classList.remove('hidden');
    $('log-budget-impact').classList.remove('hidden');
    setSheetBudgetImpact(preset.budgetImpact);
    renderAmt();
  }
}
function closeLogSheet() { $('log-mask').classList.add('hidden'); }
function renderQuickLogs() {
  const quick = $('log-quick');
  const list = $('log-quick-list');
  if (sheetMode !== 'expense') {
    quick.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  const seen = new Set();
  const recent = [...S.expenses]
    .sort((a, b) => b.ts - a.ts)
    .filter((expense) => expense.source !== 'installment')
    .filter((expense) => {
      const key = `${expense.cat}:${expense.amount}:${expenseBudgetImpact(expense)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  quick.classList.toggle('hidden', recent.length === 0);
  list.innerHTML = recent.map((expense) => {
    const cat = CATS.find((item) => item.id === expense.cat);
    const impact = expenseBudgetImpact(expense);
    return `<button class="quick-log-btn" data-cat="${expense.cat}" data-amount="${expense.amount}" data-impact="${impact}"><span>${cat.name}</span><b>${fmt(expense.amount)}</b>${impact === 'committed' ? '<small>固定／預留</small>' : ''}</button>`;
  }).join('');
  list.querySelectorAll('.quick-log-btn').forEach((button) => {
    button.onclick = () => {
      closeLogSheet();
      if (logExpense(button.dataset.cat, Number(button.dataset.amount), { budgetImpact: button.dataset.impact })) switchScreen('home');
    };
  });
}
function renderCats() {
  if (sheetMode === 'repay') {
    $('log-cats').innerHTML = snowballOrder().map((d, i) =>
      `<button class="cat-btn debt-btn" data-cat="${d.id}"><span class="icon" data-icon="sword"></span>${d.name}${i === 0 ? '<span class="focus-tag">主攻</span>' : ''}<span class="cat-sub">${fmt(d.balance)}</span></button>`
    ).join('');
  } else {
    $('log-cats').innerHTML = CATS.map((c) =>
      `<button class="cat-btn" data-cat="${c.id}"><span class="icon" data-icon="${c.id}"></span>${c.name}</button>`
    ).join('');
  }
  initIcons($('log-cats'));
  $('log-cats').querySelectorAll('.cat-btn').forEach((b) => {
    b.onclick = () => {
      selCat = b.dataset.cat;
      if (sheetMode === 'repay') {
        const d = S.debts.find((x) => x.id === Number(selCat));
        $('log-step-title').textContent = `${d.name} — 還幾多？（尚欠 ${fmt(d.balance)}）`;
        $('log-guide').textContent = `每一蚊都係有效傷害。輸入今次想對 ${d.name} 造成幾多傷害。`;
      } else {
        const cat = CATS.find((c) => c.id === selCat);
        $('log-step-title').textContent = `${cat.name} — 使咗幾多？`;
        setSheetBudgetImpact(cat.id === 'bills' ? 'committed' : 'daily');
        $('log-budget-impact').classList.remove('hidden');
      }
      $('log-quick').classList.add('hidden');
      $('log-cats').classList.add('hidden');
      $('log-amount').classList.remove('hidden');
      amtStr = '0'; renderAmt();
    };
  });
}
function setSheetBudgetImpact(value) {
  sheetBudgetImpact = value === 'committed' ? 'committed' : 'daily';
  document.querySelectorAll('[data-budget-impact]').forEach((button) => {
    const active = button.dataset.budgetImpact === sheetBudgetImpact;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('log-impact-hint').textContent = sheetBudgetImpact === 'committed'
    ? '屋租、供款或已由另一筆預算預留；仍會計入總支出。'
    : '會扣減今日安心額，適合餐飲、交通同一般購物。';
  if (sheetMode === 'expense' && selCat) {
    const cat = CATS.find((item) => item.id === selCat);
    $('log-guide').textContent = sheetBudgetImpact === 'committed'
      ? `${cat.name}會獨立記錄，唔會扣減今日安心額。`
      : `${cat.name}會計入今日節奏，我會即時更新剩餘安心額。`;
  }
}
function renderAmt() { $('amt-text').textContent = Number(amtStr).toLocaleString('en-US'); }
function numpadPress(k) {
  if (k === 'C') amtStr = '0';
  else if (k === 'back') amtStr = amtStr.length > 1 ? amtStr.slice(0, -1) : '0';
  else { // digit
    if (amtStr === '0') amtStr = k; else if (amtStr.length < 7) amtStr += k;
  }
  renderAmt();
}
function logExpense(cid, amount, opts) {
  opts = opts || {};
  if (!CATS.some((c) => c.id === cid) || !(amount > 0)) return false;
  const requestedDate = String(opts.dateKey || todayKey());
  const t = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayKey();
  const isToday = t === todayKey();
  const budgetImpact = opts.budgetImpact === 'committed' || opts.source === 'installment' ? 'committed' : 'daily';
  const first = isToday && budgetImpact === 'daily' && dailyLogsToday() === 0 && !(S.dayMeta[t] && S.dayMeta[t].noSpend);
  const entryId = Date.now();
  S.expenses.push({
    id: entryId, ts: entryId, dateKey: t, cat: cid, amount: Number(amount),
    merchant: opts.merchant || null, cardId: opts.cardId || null,
    installmentId: opts.installmentId || null, intent: opts.intent || null,
    installmentPaymentIndex: Number.isInteger(opts.installmentPaymentIndex) ? opts.installmentPaymentIndex : null,
    source: opts.source || 'manual', budgetImpact,
  });
  if (opts.cardId && opts.source !== 'installment') {
    const card = S.creditCards.find((item) => item.id === opts.cardId);
    if (card) card.currentBalance = Number(card.currentBalance || 0) + Number(amount);
  }
  if (isToday) invalidateReview(t);
  if (isToday && budgetImpact === 'daily' && meta(t).noSpend) { meta(t).noSpend = false; toast('今日零消費標記已取消'); }
  if (isToday) {
    touchStreak();
    gainXp(10);
  }
  save();
  renderAll();
  toast(isToday
    ? (budgetImpact === 'committed' ? `已記低 ${fmt(amount)} · 固定／預留，不扣今日額度` : `已記低 ${fmt(amount)} · XP +10`)
    : `已補記 ${t} · ${fmt(amount)}`);
  softVibrate([8, 30, 8]);
  if (isToday) {
    clearTimeout(pendingChestTimer);
    if (budgetImpact === 'daily' && !opts.skipDialogue && !opts.intent) {
      setTimeout(() => showExpenseReaction(cid, amount, first, entryId), 80);
      pendingChestTimer = setTimeout(() => maybeChest(first), 12000);
    } else {
      pendingChestTimer = setTimeout(() => maybeChest(first), 450);
    }
  }
  return entryId;
}
function saveSheet() {
  const amount = Number(amtStr);
  if (!selCat || amount <= 0) { toast('輸入返個銀碼先'); return; }
  if (sheetMode === 'repay') {
    closeLogSheet();
    repayDebt(Number(selCat), amount);
  } else {
    closeLogSheet();
    const expenseId = logExpense(selCat, amount, { ...sheetRecordOptions, budgetImpact: sheetBudgetImpact });
    if (expenseId) {
      if (sheetRecordOptions.decisionId) {
        const decision = (S.decisionEncounters || []).find((entry) => entry.id === sheetRecordOptions.decisionId);
        if (decision) {
          decision.status = 'recorded';
          decision.expenseId = expenseId;
          decision.recordedAt = Date.now();
          save(); renderAll();
        }
      }
      switchScreen('home');
    }
  }
}

/* ===================== 還債（斬龍） ===================== */
function repayDebt(debtId, amount) {
  const d = S.debts.find((x) => x.id === debtId);
  if (!d || d.balance <= 0) return;
  const pay = Math.min(amount, d.balance);
  d.balance -= pay;
  S.repayments.push({ id: Date.now(), ts: Date.now(), debtId, amount: pay });
  invalidateReview(todayKey());
  touchStreak();
  gainGold(20);
  if (d.balance === 0) {
    gainGold(300);
    gainXp(500);
    save(); renderAll();
    const remain = liveDebts().length;
    popup('惡龍被消滅！', `<img class="art" data-art="boss" style="width:90px;height:90px;object-fit:contain;filter:grayscale(1) brightness(.6)"><p style="color:var(--dim);font-size:13px;line-height:1.7"><b style="color:var(--text)">${d.name}</b> 全數還清！<br><b style="color:var(--gold)">+300 金幣 · +500 XP</b><br>${remain > 0 ? `雪球滾大咗：將呢筆月供全數加落下一條龍「${snowballOrder()[0].name}」身上！` : '你已經無債一身輕，開始儲應急庫啦！'}</p>`);
  } else {
    gainXp(30);
    save(); renderAll();
    popup('斬龍成功！', `<p style="color:var(--dim);font-size:13px;line-height:1.7">對 <b style="color:var(--text)">${d.name}</b> 造成 <b style="color:var(--hp2)">${fmt(pay)}</b> 傷害！<br>尚欠 ${fmt(d.balance)}<br><b style="color:var(--gold)">+20 金幣 · +30 XP</b></p>`);
  }
  softVibrate([12, 35, 18]);
  pulseScene();
}

/* ===================== 零消費 ===================== */
function markNoSpend() {
  const t = todayKey();
  if (dailyLogsToday() > 0) { toast('今日已經有日常支出紀錄喇'); return; }
  if (meta(t).noSpend) { toast('今日已經標記咗零消費'); return; }
  meta(t).noSpend = true;
  invalidateReview(t);
  touchStreak();
  gainGold(30);
  gainXp(50);
  save(); renderAll();
  softVibrate([8, 25, 8]);
  pulseScene();
  popup('零日常消費達成！', `<p style="color:var(--dim);font-size:13px;line-height:1.7">勇者今日冇動用日常安心額！固定承諾仍然會留喺手帳，但唔影響今次成果。<br><b style="color:var(--gold)">+30 金幣 · +50 XP</b><br>成日嘅日常預算全數化為攻擊力。</p>`);
  setTimeout(() => maybeChest(true), 400);
}

/* ===================== 任務 ===================== */
function expeditionMeta(key) {
  const wk = key || weekKey();
  if (!S.weekMeta[wk]) S.weekMeta[wk] = { questsClaimed: [], bonusClaimed: false };
  if (!Array.isArray(S.weekMeta[wk].questsClaimed)) S.weekMeta[wk].questsClaimed = [];
  if (typeof S.weekMeta[wk].bonusClaimed !== 'boolean') S.weekMeta[wk].bonusClaimed = false;
  if (!Number.isInteger(S.weekMeta[wk].targetDays) || S.weekMeta[wk].targetDays < 1 || S.weekMeta[wk].targetDays > 3) {
    const remainingDays = fullWeekDays().filter((dateKey) => dateKey >= todayKey()).length;
    S.weekMeta[wk].targetDays = FinanceGameplay.expeditionTargetDays(remainingDays);
  }
  return S.weekMeta[wk];
}

function weeklyProgressStats() {
  const today = todayKey();
  const elapsedDays = fullWeekDays().filter((key) => key <= today);
  const activeDays = elapsedDays.filter(dayHasMoneyActivity).length;
  const reviewDays = elapsedDays.filter((key) => S.dayMeta[key] && S.dayMeta[key].reviewed).length;
  const storyDays = elapsedDays.filter((key) => (
    (S.dayMeta[key] && S.dayMeta[key].noSpend)
    || S.expenses.some((expense) => (
      expense.dateKey === key && expenseBudgetImpact(expense) === 'daily' && expense.intent
    ))
  )).length;
  return { activeDays, reviewDays, storyDays };
}

function weeklyQuestProgress(quest) {
  const effectiveQuest = { ...quest, target: expeditionMeta().targetDays };
  return FinanceGameplay.weeklyQuestProgress(effectiveQuest, weeklyProgressStats());
}

function claimWeeklyQuest(qid) {
  const baseQuest = WEEKLY_QUESTS.find((item) => item.id === qid);
  const state = expeditionMeta();
  const quest = baseQuest ? { ...baseQuest, target: state.targetDays } : null;
  if (!quest || state.questsClaimed.includes(qid) || weeklyQuestProgress(quest) < quest.target) return;
  state.questsClaimed.push(qid);
  gainGold(quest.gold);
  gainXp(quest.xp);
  save(); renderAll();
  softVibrate([8, 24, 8]);
  toast(FinanceGameplay.expeditionComplete(state.questsClaimed)
    ? `路標完成！遠征寶箱已解鎖`
    : `本週路標完成 · +${quest.gold}G · +${quest.xp} XP`);
}

function claimExpeditionBonus() {
  const state = expeditionMeta();
  if (state.bonusClaimed || !FinanceGameplay.expeditionComplete(state.questsClaimed)) return;
  state.bonusClaimed = true;
  gainGold(180);
  gainXp(180);
  save(); renderAll();
  softVibrate([12, 30, 12]);
  popup('七日遠征寶箱', `<img class="art expedition-popup-chest" data-art="chest-open" alt="已打開嘅遠征寶箱"><p class="expedition-popup-copy">你唔需要每日完美，只係一星期入面幾次願意看清楚。<br><b>+180 金幣 · +180 XP</b></p>`);
}

function questProgress(q) {
  const t = todayKey(), m = meta(t);
  if (q.id === 'q_checkin') return dayHasMoneyActivity(t) ? 1 : 0;
  if (q.id === 'q_review') return m.reviewed ? 1 : 0;
  if (q.id === 'q_story') return (m.noSpend || S.expenses.some((expense) => expense.dateKey === t && expenseBudgetImpact(expense) === 'daily' && expense.intent)) ? 1 : 0;
  return 0;
}
function claimQuest(qid) {
  const q = QUESTS.find((x) => x.id === qid);
  const m = meta(todayKey());
  if (m.questsClaimed.includes(qid) || questProgress(q) < q.target) return;
  m.questsClaimed.push(qid);
  gainGold(q.gold);
  gainXp(20);
  save(); renderAll();
  toast(`任務完成！+${q.gold} 金幣 · +20 XP`);
}

function reviewToday() {
  const t = todayKey();
  const m = meta(t);
  if (m.reviewed) {
    toast('今日金流已經盤點完成');
    return;
  }
  if (!dayHasMoneyActivity(t)) {
    switchScreen('home');
    toast('先記一筆，或者確認今日零日常消費');
    return;
  }
  const daily = daySpend(t);
  const committed = dayCommittedSpend(t);
  const income = (S.incomes || []).filter((entry) => entry.dateKey === t).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const cardPaid = (S.cardPayments || []).filter((entry) => entry.dateKey === t).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const debtPaid = (S.repayments || []).filter((entry) => entry.ts && keyOf(new Date(entry.ts)) === t).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const goalSavedToday = (S.goalContributions || []).filter((entry) => entry.dateKey === t).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const noSpend = m.noSpend && daily === 0;
  popup('今日金流盤點', `<div class="review-summary">
    <p>收隊前望一眼就夠，唔需要為咗完成任務而製造更多紀錄。</p>
    <div><span>日常支出</span><b>${noSpend ? '已確認 $0' : fmt(daily)}</b></div>
    <div><span>固定／預留</span><b>${fmt(committed)}</b></div>
    <div><span>今日收入</span><b class="positive">${fmt(income)}</b></div>
    <div><span>還卡／還債</span><b>${fmt(cardPaid + debtPaid)}</b></div>
    <div><span>願望儲蓄</span><b class="positive">${fmt(goalSavedToday)}</b></div>
  </div>`, {
    confirmLabel: '完成盤點',
    cancelLabel: '再檢查一下',
    onConfirm: () => {
      const firstReview = !m.reviewRewarded;
      m.reviewed = true;
      if (firstReview) {
        m.reviewRewarded = true;
        gainXp(15);
        if (S.items.shield > 0) gainGold(10);
      }
      save(); renderAll();
      softVibrate([8, 24, 8]);
      toast(firstReview ? `今日收隊完成 · +15 XP${S.items.shield > 0 ? ' · +10G' : ''}` : '今日盤點已更新');
    },
  });
}

function startQuest(qid) {
  if (qid === 'q_review') {
    reviewToday();
    return;
  }
  if (qid === 'q_story') {
    const expense = [...S.expenses].reverse().find((item) => item.dateKey === todayKey() && expenseBudgetImpact(item) === 'daily' && !item.intent);
    if (expense) {
      switchScreen('home');
      showExpenseReaction(expense.cat, expense.amount, false, expense.id);
      return;
    }
  }
  openLogSheet('expense');
}

/* ===================== 魔王 ===================== */
function ensureBoss() {
  const wk = weekKey();
  if (S.boss.weekKey !== wk) S.boss = { weekKey: wk, claimed: false };
}
function claimBoss() {
  ensureBoss();
  if (S.boss.claimed || bossDamage() < bossMaxHp()) return;
  S.boss.claimed = true;
  gainGold(150);
  gainXp(200);
  save(); renderAll();
  popup('魔王被擊倒！', `<img class="art" data-art="boss" style="width:90px;height:90px;object-fit:contain;filter:grayscale(1) brightness(.6)"><p style="color:var(--dim);font-size:13px;line-height:1.7">本週儲蓄目標達成，慾望魔王倒下！<br><b style="color:var(--gold)">+150 金幣 · +200 XP</b><br>下星期一佢會滿血復活，繼續努力。</p>`);
}

/* ===================== 軍師建議（規則式，一般理財教育） ===================== */
function buildAdvice() {
  const out = [];
  const fp = S.finProfile || { income: 0, savings: 0, incomeType: 'fixed' };
  const debts = liveDebts();
  if (debts.length) {
    const order = snowballOrder();
    out.push({
      t: '雪球還債法',
      b: `你有 ${debts.length} 條惡龍（共 ${fmt(totalDebt())}）。打法：每月先俾齊所有債嘅最低還款，剩返嘅火力全部集中斬最細嗰條 —「${order[0].name}」（${fmt(order[0].balance)}）。消滅一條，就將佢嘅月供成筆滾落下一條度。細龍死得快，你嘅士氣同還款力會好似雪球咁愈滾愈大。`,
    });
  }
  const ai = armorInfo();
  if (!debts.length && ai.months < 3) {
    out.push({
      t: '應急庫任務',
      b: `以目前日常預算估算，你嘅護甲係「${ai.name}」（存款夠用 ${ai.months.toFixed(1)} 個月日常使費）。下一個目標：先儲到 ${fmt(S.monthlyBudget * 3)}；固定承諾仍要另外計入完整應急庫。`,
    });
  }
  if (fp.incomeType === 'variable') {
    out.push({
      t: '浮動收入攻略',
      b: '預算以淡月收入做基準。旺月多賺嘅錢係「額外戰利品」：一半入應急庫，一半還債或增值自己，切忌用嚟加大日常使費。',
    });
  }
  if (!debts.length && ai.months >= 3) {
    out.push({
      t: '先儲後使',
      b: '應急庫已經穩陣。下一步：出糧當日自動轉走儲蓄目標（先儲後使），剩返嘅先係生活費，令儲錢變成唔使意志力嘅被動技能。',
    });
  }
  return out.slice(0, 2);
}

function buildObjective() {
  const t = todayKey();
  const dmg = bossDamage();
  const max = bossMaxHp();
  const debt = snowballOrder()[0];
  const goal = activeGoal();
  const affordable = SHOP.find((it) => S.gold >= it.cost && !(it.once && S.items[it.id] > 0));
  const todayMeta = meta(t);
  const pendingDecision = dueDecision();
  const untaggedExpense = [...S.expenses].reverse().find((item) => item.dateKey === t && expenseBudgetImpact(item) === 'daily' && !item.intent);
  const claimableQuest = QUESTS.find((q) => questProgress(q) >= q.target && !todayMeta.questsClaimed.includes(q.id));

  if (dmg >= max && !S.boss.claimed) {
    return {
      reward: '+150G · +200 XP',
      body: '本週魔王已經倒地。領咗勝利獎勵，再將金幣拎去商店升裝。',
      label: '領取魔王獎勵',
      action: claimBoss,
    };
  }
  if (pendingDecision) {
    return {
      reward: '自主選擇',
      body: `<b>${escapeHtml(pendingDecision.name)}</b> 已經封存滿 24 小時。重新推演一次，再決定準備記帳或者放下。`,
      label: '回看消費遭遇',
      action: () => openDecisionEncounter(pendingDecision.id),
    };
  }
  if (!dayHasMoneyActivity(t)) {
    return {
      reward: '必爆寶箱',
      body: '今日未出動。記低第一筆支出，或者真係冇使錢就標記零消費，先會計入本週打魔王傷害。',
      label: '記第一筆支出',
      action: () => openLogSheet('expense'),
    };
  }
  if (untaggedExpense) {
    return {
      reward: '+40G 任務',
      body: '呢筆支出已經看見。補上「生活必需、值得享受、定一時衝動」，先會變成對下一次選擇有用嘅故事。',
      label: '補上故事',
      action: () => {
        switchScreen('home');
        showExpenseReaction(untaggedExpense.cat, untaggedExpense.amount, false, untaggedExpense.id);
      },
    };
  }
  if (!todayMeta.reviewed) {
    return {
      reward: '+30G 任務',
      body: `今日已有 <b>${moneyActivityCount(t)}</b> 個金流足印。收隊前望一眼日常、固定、收入同還款，唔使為湊數再記。`,
      label: '完成今日盤點',
      action: reviewToday,
    };
  }
  if (claimableQuest) {
    return {
      reward: `${claimableQuest.gold}G`,
      body: `<b>${claimableQuest.name}</b> 已經完成。去任務頁收低獎勵，今日進度就會一直保留。`,
      label: '領取任務獎勵',
      action: () => switchScreen('quests'),
    };
  }
  if (debt) {
    return {
      reward: '+20G · +30 XP',
      body: `雪球法主攻目標係 <b>${debt.name}</b>（尚欠 ${fmt(debt.balance)}）。有額外現金就優先斬呢條龍。`,
      label: '還債斬龍',
      action: () => openLogSheet('repay'),
    };
  }
  if (!goal) {
    return {
      reward: '+25 XP',
      body: '遊戲入面嘅金幣只係陪伴。建立一個真正重要嘅願望，先可以將每次看見金流連返去你想要嘅生活。',
      label: '建立願望任務',
      action: () => { switchGrowthView('goals'); switchScreen('shop'); },
    };
  }
  if (affordable) {
    return {
      reward: `${affordable.cost}G`,
      body: `金幣夠買 <b>${affordable.name}</b>。升裝可以強化記帳獎勵或者打魔王效率。`,
      label: '去商店',
      action: () => { switchGrowthView('gear'); switchScreen('shop'); },
    };
  }
  return {
    reward: `${fmt(Math.max(0, max - dmg))} HP`,
    body: `魔王仲有 <b>${fmt(Math.max(0, max - dmg))}</b> HP。聽日再記帳，將每日慳落嘅錢變成下一刀。`,
    label: '查看戰績',
    action: () => switchScreen('stats'),
  };
}

function buildWeeklyReflection() {
  const days = weekDays();
  const daySet = new Set(days);
  const expenses = S.expenses.filter((expense) => daySet.has(expense.dateKey) && expenseBudgetImpact(expense) === 'daily');
  const activeDays = days.filter(dayHasMoneyActivity).length;
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const byCat = {};
  const byIntent = {};
  expenses.forEach((expense) => {
    byCat[expense.cat] = (byCat[expense.cat] || 0) + expense.amount;
    if (expense.intent) byIntent[expense.intent] = (byIntent[expense.intent] || 0) + expense.amount;
  });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  if (!activeDays) {
    return {
      title: '故事可以由今日開始',
      body: '唔使補返之前每一日。記低眼前一筆，就足夠令理財重新變得可見。',
      label: '記眼前一筆',
      action: () => openLogSheet('expense'),
    };
  }
  if (!expenses.length) {
    return {
      title: `本週有 ${activeDays} 日完成記錄`,
      body: '暫時未有日常支出；固定承諾、收入同還款仍然留喺手帳，唔會扭曲日常消費洞察。',
      label: '查看本週節奏',
      action: () => switchScreen('stats'),
    };
  }
  if (byIntent.impulse) {
    return {
      title: `你捉到 ${fmt(byIntent.impulse)} 自動消費`,
      body: '標記衝動唔係責備，而係令下一次付款前多出三秒選擇空間。',
      label: '記下一筆前停一停',
      action: () => openLogSheet('expense'),
    };
  }
  if (activeDays >= 3) {
    return {
      title: `你有 ${activeDays} 日願意面對數字`,
      body: `本週已記 ${fmt(total)}。持續看見，比追求一份完美預算更有用。`,
      label: '查看本週節奏',
      action: () => switchScreen('stats'),
    };
  }
  const cat = CATS.find((item) => item.id === top[0]);
  return {
    title: `最大章節係${cat.name} ${fmt(top[1])}`,
    body: '先看最大一類已經夠。下一筆補上消費故事，你會更清楚呢啲錢換返咗甚麼。',
    label: '為下一筆加故事',
    action: () => openLogSheet('expense'),
  };
}

/* ===================== 消費決策遭遇 ===================== */
let selectedDecisionSource = 'daily';
let selectedDecisionIntent = 'unsure';
let selectedDecisionRepayment = 'full';
let activeDecisionId = null;
let activeDecisionResult = null;
let decisionReminderTimer = null;

function dueDecision() {
  return (S.decisionEncounters || [])
    .filter((entry) => entry.status === 'waiting' && Number(entry.revisitAt || 0) <= Date.now())
    .sort((a, b) => Number(a.revisitAt || 0) - Number(b.revisitAt || 0))[0] || null;
}

function scheduleDecisionReminder() {
  clearTimeout(decisionReminderTimer);
  decisionReminderTimer = null;
  const next = (S.decisionEncounters || [])
    .filter((entry) => entry.status === 'waiting' && Number(entry.revisitAt || 0) > Date.now())
    .sort((a, b) => Number(a.revisitAt) - Number(b.revisitAt))[0];
  if (!next) return;
  decisionReminderTimer = setTimeout(() => {
    renderAll();
    if (activeScreenName === 'home' && $('dialogue-panel').classList.contains('hidden')) renderSceneDialogue(true);
  }, Math.min(2147483647, Math.max(250, Number(next.revisitAt) - Date.now())));
}

function decisionGoalContext() {
  const incomplete = (S.goals || []).filter((goal) => !FinanceGameplay.goalProgress(goal, S.goalContributions).complete);
  const goal = incomplete.find((item) => item.id === S.activeGoalId) || incomplete[incomplete.length - 1] || null;
  if (!goal) return { goal: null, progress: null, pace: null };
  return {
    goal,
    progress: FinanceGameplay.goalProgress(goal, S.goalContributions),
    pace: FinanceGameplay.goalPace(goal, S.goalContributions, todayKey()),
  };
}

function setDecisionSegment(attribute, value) {
  const buttons = document.querySelectorAll(`[data-${attribute}]`);
  buttons.forEach((button) => {
    const active = button.dataset[attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setDecisionSource(value) {
  if (!['daily', 'savings', 'credit'].includes(value)) return;
  selectedDecisionSource = value;
  if (value !== 'credit' && selectedDecisionRepayment === 'installment') selectedDecisionRepayment = 'full';
  setDecisionSegment('decision-source', value);
  $('decision-credit').classList.toggle('hidden', value !== 'credit');
  setDecisionRepayment(selectedDecisionRepayment);
}

function setDecisionIntent(value) {
  if (!['need', 'joy', 'unsure'].includes(value)) return;
  selectedDecisionIntent = value;
  setDecisionSegment('decision-intent', value);
}

function setDecisionRepayment(value) {
  if (!['full', 'installment'].includes(value)) return;
  selectedDecisionRepayment = value;
  setDecisionSegment('decision-repayment', value);
  const financed = value === 'installment' && selectedDecisionSource === 'credit';
  $('decision-finance').classList.toggle('hidden', !financed);
  $('decision-months').required = financed;
  $('decision-apr').required = financed;
}

function populateDecisionCards(selectedId) {
  const cards = S.creditCards || [];
  $('decision-card').innerHTML = cards.length
    ? cards.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}${card.last4 ? ` •••• ${escapeHtml(card.last4)}` : ''}</option>`).join('')
    : '<option value="">未設定信用卡</option>';
  if (selectedId && cards.some((card) => card.id === selectedId)) $('decision-card').value = selectedId;
  const card = cards.find((item) => item.id === $('decision-card').value);
  if (card && card.annualRate != null) $('decision-apr').value = card.annualRate;
}

function closeDecisionEncounter() { $('decision-mask').classList.add('hidden'); }

function decisionInput() {
  const amount = Number($('decision-amount').value);
  const card = (S.creditCards || []).find((item) => item.id === $('decision-card').value) || null;
  const goalContext = decisionGoalContext();
  const pace = safeToSpendToday();
  return {
    name: $('decision-name').value.trim().slice(0, 36) || '呢次消費',
    amount,
    category: $('decision-category').value,
    source: selectedDecisionSource,
    intent: selectedDecisionIntent,
    repayment: selectedDecisionRepayment,
    cardId: card ? card.id : null,
    cardName: card ? card.name : null,
    installmentMonths: Number($('decision-months').value || 12),
    annualRate: Number($('decision-apr').value || 0),
    safeToday: Math.max(0, pace.safe - daySpend(todayKey())),
    savings: Number((S.finProfile && S.finProfile.savings) || 0),
    monthlyBudget: S.monthlyBudget,
    income: Number((S.finProfile && S.finProfile.income) || 0),
    goalId: goalContext.goal ? goalContext.goal.id : null,
    goalName: goalContext.goal ? goalContext.goal.name : null,
    goalRemaining: goalContext.progress ? goalContext.progress.remaining : 0,
    goalWeeklySuggested: goalContext.pace ? goalContext.pace.weeklySuggested : 0,
  };
}

function decisionSignalCopy(signal) {
  if (signal === 'arrange') return { label: '先安排路線', tone: 'arrange', copy: '呢條路會穿過至少一個財務界線。唔代表唔可以買，但先改金額、日期或付款方式，會令之後嘅自己更容易接住。' };
  if (signal === 'pause') return { label: '留一晚再望', tone: 'pause', copy: '數字未必危險，但仍有一個重要取捨。暫停唔係拒絕享受，而係確認聽日仍然覺得值得。' };
  return { label: '路線有空間', tone: 'clear', copy: '按目前已記資料，買完仍保留一定空間。你可以放心選擇，亦可以繼續比較，兩邊都唔會扣分。' };
}

function renderDecisionResult(input, result) {
  activeDecisionResult = { input, result };
  const signal = decisionSignalCopy(result.signal);
  const dailyCopy = result.dailyImpact > 0
    ? result.dailyAfter >= 0 ? `${fmt(result.dailyAfter)} 尚餘` : `超出 ${fmt(Math.abs(result.dailyAfter))}`
    : '不直接扣今日';
  const armorCopy = input.source === 'savings'
    ? `${result.armorBefore.toFixed(1)} → ${result.armorAfter.toFixed(1)} 個月`
    : `${result.armorBefore.toFixed(1)} 個月不變`;
  let goalCopy = '未有進行中願望';
  if (input.goalName && result.goalEquivalentWeeks != null) goalCopy = `${escapeHtml(input.goalName)} 約 ${result.goalEquivalentWeeks.toFixed(1)} 週補給`;
  else if (input.goalName && result.goalEquivalentPct != null) goalCopy = `${escapeHtml(input.goalName)} 尚餘額嘅 ${Math.round(result.goalEquivalentPct)}%`;
  const creditCopy = input.source !== 'credit'
    ? '今次不使用信用卡'
    : result.financed
      ? `${input.installmentMonths} 期 × ${fmt(result.monthlyPayment)} · 成本 ${fmt(result.financeCost)}`
      : `${escapeHtml(input.cardName || '信用卡')} · 全數還清則預計 $0 利息`;
  $('decision-form').classList.add('hidden');
  $('decision-result').innerHTML = `<div class="decision-result-head ${signal.tone}">
      <span>${signal.label}</span><button class="icon-btn" id="decision-edit" type="button" aria-label="修改推演資料" title="修改"><span class="icon" data-icon="edit"></span></button>
      <h3>${escapeHtml(input.name)} · ${fmt(input.amount)}</h3>
      <div class="decision-signal" aria-label="決策訊號 ${signal.label}"><i></i><i></i><i></i><b></b></div>
    </div>
    <div class="decision-impact-list">
      <div><span>今日步速</span><b>${dailyCopy}</b></div>
      <div><span>應急護甲</span><b>${armorCopy}</b></div>
      <div><span>願望對照</span><b>${goalCopy}</b></div>
      <div><span>信用成本</span><b>${creditCopy}</b></div>
    </div>
    <div class="decision-advice"><img class="art" data-art="strategist" alt="錢錢軍師"><p>${signal.copy}</p></div>
    <p class="decision-caveat">推演只用目前已記資料，未包括未輸入嘅固定承諾；係決策提示，不係產品或投資建議。</p>
    <div class="decision-actions">
      <button class="btn primary" id="decision-record" type="button">確認路線，準備記帳</button>
      <button class="btn ghost" id="decision-wait" type="button">封存 24 小時</button>
      <button class="decision-pass" id="decision-pass" type="button">今次放下</button>
    </div>`;
  $('decision-result').classList.remove('hidden');
  initArt($('decision-result')); initIcons($('decision-result'));
  $('decision-edit').onclick = () => { $('decision-result').classList.add('hidden'); $('decision-form').classList.remove('hidden'); };
  $('decision-wait').onclick = waitDecisionEncounter;
  $('decision-pass').onclick = () => resolveDecisionEncounter('passed');
  $('decision-record').onclick = () => resolveDecisionEncounter('ready');
}

function previewDecisionEncounter(event) {
  if (event) event.preventDefault();
  if (!$('decision-form').checkValidity()) { $('decision-form').reportValidity(); return; }
  const input = decisionInput();
  if (!(input.amount > 0)) { toast('請輸入今次金額'); return; }
  renderDecisionResult(input, FinanceGameplay.purchaseEncounter(input));
}

function openDecisionEncounter(decisionId) {
  if (window.FinanceAdvisor) FinanceAdvisor.close();
  const existing = (S.decisionEncounters || []).find((entry) => entry.id === decisionId) || null;
  activeDecisionId = existing ? existing.id : null;
  activeDecisionResult = null;
  $('decision-name').value = existing ? existing.name : '';
  $('decision-amount').value = existing ? existing.amount : '';
  $('decision-category').value = existing ? existing.category : 'shopping';
  $('decision-months').value = existing ? existing.installmentMonths || 12 : 12;
  $('decision-apr').value = existing && existing.annualRate != null ? existing.annualRate : '';
  populateDecisionCards(existing && existing.cardId);
  setDecisionIntent(existing ? existing.intent : 'unsure');
  setDecisionRepayment(existing ? existing.repayment : 'full');
  setDecisionSource(existing ? existing.source : 'daily');
  $('decision-result').classList.add('hidden');
  $('decision-form').classList.remove('hidden');
  $('decision-mask').classList.remove('hidden');
  if (existing) previewDecisionEncounter();
}

function persistDecision(status) {
  const input = activeDecisionResult ? activeDecisionResult.input : decisionInput();
  let entry = (S.decisionEncounters || []).find((item) => item.id === activeDecisionId) || null;
  if (!entry) {
    entry = { id: `decision-${Date.now()}-${Math.floor(Math.random() * 10000)}`, createdAt: Date.now() };
    S.decisionEncounters.push(entry);
    activeDecisionId = entry.id;
  }
  Object.assign(entry, input, { status, updatedAt: Date.now() });
  return entry;
}

function rewardDecisionReflection() {
  const todayMeta = meta(todayKey());
  if (todayMeta.decisionReflectionRewarded) return 0;
  todayMeta.decisionReflectionRewarded = true;
  gainXp(15);
  return 15;
}

function waitDecisionEncounter() {
  const entry = persistDecision('waiting');
  entry.revisitAt = Date.now() + 24 * 60 * 60 * 1000;
  save(); closeDecisionEncounter(); renderAll(); switchScreen('home');
  activeDialogueKey = `decision-wait-${entry.id}`;
  speak('錢錢軍師', `「${entry.name}」卷軸已封存。24 小時後我會喺營地提醒你再望一次；等待期間，願望同進度都唔會扣分。`, [
    { label: '知道', primary: true, action: closeSceneDialogue },
  ]);
}

function resolveDecisionEncounter(status) {
  const entry = persistDecision(status);
  entry.resolvedAt = Date.now();
  entry.revisitAt = null;
  const xp = rewardDecisionReflection();
  save(); closeDecisionEncounter(); renderAll();
  if (status === 'passed') {
    switchScreen('home');
    activeDialogueKey = `decision-pass-${entry.id}`;
    speak('錢錢軍師', `「${entry.name}」今次收起咗。買或者唔買都唔係勝負；你停低望清楚先選，先係真正嘅自主。${xp ? '今日反思 XP +15。' : ''}`, [
      { label: '返回營地', primary: true, action: closeSceneDialogue },
    ]);
    return;
  }
  if (entry.source === 'credit' && entry.repayment === 'installment') {
    const cardCopy = entry.cardName ? `，信用卡係${entry.cardName}` : '';
    FinanceAdvisor.open(`我想記一個${entry.name}分期，本金${entry.amount}，${entry.installmentMonths}期，APR ${entry.annualRate}%${cardCopy}`);
    return;
  }
  if (entry.source === 'credit' && !entry.cardId) {
    openCardForm();
    toast('先補上信用卡資料，再完成記帳');
    return;
  }
  openLogSheet('expense', {
    category: entry.category,
    amount: entry.amount,
    budgetImpact: entry.category === 'bills' ? 'committed' : 'daily',
    merchant: entry.name,
    cardId: entry.source === 'credit' ? entry.cardId : null,
    intent: entry.intent === 'unsure' ? null : entry.intent,
    source: 'decision',
    decisionId: entry.id,
  });
  if (xp) toast('推演完成 · 今日反思 XP +15');
}

/* ===================== 商店 ===================== */
let activeGrowthView = 'goals';
let selectedGoalType = 'emergency';
let selectedGoalFunding = 'new_saving';

function switchGrowthView(view) {
  if (!['goals', 'gear'].includes(view)) return;
  activeGrowthView = view;
  document.querySelectorAll('[data-growth-view]').forEach((button) => {
    const active = button.dataset.growthView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-growth-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.growthPanel === view);
  });
}

function activeGoal() {
  let goal = S.goals.find((item) => item.id === S.activeGoalId) || null;
  if (!goal) {
    goal = [...S.goals].reverse().find((item) => !FinanceGameplay.goalProgress(item, S.goalContributions).complete) || null;
    if (goal) S.activeGoalId = goal.id;
  }
  return goal;
}

function goalTypeInfo(type) {
  return GOAL_TYPES.find((item) => item.id === type) || GOAL_TYPES[1];
}

function setGoalType(type) {
  if (!GOAL_TYPES.some((item) => item.id === type)) return;
  selectedGoalType = type;
  document.querySelectorAll('[data-goal-type]').forEach((button) => {
    const active = button.dataset.goalType === type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function closeGoalForm() { $('goal-form-mask').classList.add('hidden'); }
function openGoalForm(goalId) {
  const goal = S.goals.find((item) => item.id === goalId) || null;
  $('goal-form-id').value = goal ? goal.id : '';
  $('goal-form-title').textContent = goal ? '編輯願望任務' : '建立願望任務';
  $('goal-name').value = goal ? goal.name : '';
  $('goal-target').value = goal ? goal.target : '';
  $('goal-initial').value = goal ? Number(goal.initialAmount || 0) : '';
  $('goal-deadline').value = goal && goal.deadline ? goal.deadline : '';
  $('goal-delete').classList.toggle('hidden', !goal);
  setGoalType(goal ? goal.type : 'emergency');
  $('goal-form-mask').classList.remove('hidden');
}

function saveGoalForm(event) {
  event.preventDefault();
  const existing = S.goals.find((item) => item.id === $('goal-form-id').value) || null;
  const name = $('goal-name').value.trim().slice(0, 28);
  const target = Number($('goal-target').value);
  const initialAmount = Math.max(0, Number($('goal-initial').value || 0));
  const deadline = $('goal-deadline').value || null;
  if (!name || !(target > 0)) { toast('請填願望名稱同目標金額'); return; }
  const data = { name, type: selectedGoalType, target, initialAmount, deadline };
  let goal;
  let creationRewarded = false;
  if (existing) {
    Object.assign(existing, data);
    goal = existing;
  } else {
    goal = {
      id: `goal-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      ...data,
      createdAt: Date.now(), completedAt: null, rewarded: false,
    };
    S.goals.push(goal);
    S.activeGoalId = goal.id;
    const todayMeta = meta(todayKey());
    if (!todayMeta.goalCreateRewarded) {
      todayMeta.goalCreateRewarded = true;
      creationRewarded = true;
      gainXp(25);
    }
  }
  const progress = FinanceGameplay.goalProgress(goal, S.goalContributions);
  if (progress.complete) {
    goal.completedAt = goal.completedAt || Date.now();
    goal.rewarded = true;
  } else {
    goal.completedAt = null;
  }
  save(); closeGoalForm(); renderAll();
  toast(existing ? '願望任務已更新' : `新主線已加入${creationRewarded ? ' · +25 XP' : ''}`);
}

function deleteGoal() {
  const goal = S.goals.find((item) => item.id === $('goal-form-id').value);
  if (!goal) return;
  closeGoalForm();
  popup('刪除願望任務？', `<p class="confirm-copy"><b>${escapeHtml(goal.name)}</b><br>願望同分配紀錄會移除；已經新儲起嘅真實存款仍然留喺護甲，唔會被扣走。</p>`, {
    confirmLabel: '確認刪除',
    cancelLabel: '保留願望',
    onConfirm: () => {
      S.goals = S.goals.filter((item) => item.id !== goal.id);
      S.goalContributions = S.goalContributions.filter((item) => item.goalId !== goal.id);
      if (S.activeGoalId === goal.id) S.activeGoalId = null;
      save(); renderAll(); toast('願望任務已刪除');
    },
  });
}

function setGoalFunding(source) {
  if (!['new_saving', 'allocated'].includes(source)) return;
  selectedGoalFunding = source;
  document.querySelectorAll('[data-goal-funding]').forEach((button) => {
    const active = button.dataset.goalFunding === source;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('goal-funding-hint').textContent = source === 'new_saving'
    ? '會同步增加護甲存款，但不會扣日常安心額。'
    : '只將現有存款分配到願望，總存款不會再次增加。';
}

function closeGoalContribution() { $('goal-contribution-mask').classList.add('hidden'); }
function openGoalContribution() {
  const goal = activeGoal();
  if (!goal) return;
  const progress = FinanceGameplay.goalProgress(goal, S.goalContributions);
  if (progress.complete) { toast('呢個願望已經完成'); return; }
  $('goal-contribution-title').textContent = `存入「${goal.name}」`;
  $('goal-contribution-status').textContent = `已準備 ${fmt(progress.saved)}，尚餘 ${fmt(progress.remaining)}。`;
  $('goal-contribution-amount').value = '';
  setGoalFunding('new_saving');
  $('goal-contribution-mask').classList.remove('hidden');
}

function saveGoalContribution(event) {
  event.preventDefault();
  const goal = activeGoal();
  const amount = Number($('goal-contribution-amount').value);
  if (!goal || !(amount > 0)) { toast('請輸入今次存入金額'); return; }
  const before = FinanceGameplay.goalProgress(goal, S.goalContributions);
  const dateKey = todayKey();
  const todayMeta = meta(dateKey);
  const firstToday = !todayMeta.goalContributionRewarded;
  S.goalContributions.push({
    id: `goal-save-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    goalId: goal.id, amount, source: selectedGoalFunding, dateKey, ts: Date.now(),
  });
  if (selectedGoalFunding === 'new_saving' && S.finProfile) {
    S.finProfile.savings = Math.max(0, Number(S.finProfile.savings || 0) + amount);
  }
  touchStreak();
  invalidateReview(dateKey);
  const levelBeforeContribution = S.level;
  if (firstToday) {
    todayMeta.goalContributionRewarded = true;
    gainXp(20);
  }
  const after = FinanceGameplay.goalProgress(goal, S.goalContributions);
  const newlyCompleted = !before.complete && after.complete;
  let completionRewarded = false;
  let completionBlockedByWeek = false;
  if (newlyCompleted) {
    goal.completedAt = Date.now();
    if (!goal.rewarded) {
      goal.rewarded = true;
      const wk = weekKey();
      if (!S.goalRewardWeeks[wk]) {
        S.goalRewardWeeks[wk] = goal.id;
        completionRewarded = true;
        gainGold(250);
        gainXp(300);
      } else {
        completionBlockedByWeek = true;
      }
    }
  }
  let contributionLevelBonus = 0;
  for (let level = levelBeforeContribution + 1; level <= S.level; level++) contributionLevelBonus += 25 * level;
  save(); closeGoalContribution(); renderAll();
  softVibrate(newlyCompleted ? [12, 30, 12] : [8, 22, 8]);
  if (newlyCompleted) {
    const rewardCopy = completionRewarded
      ? `+250 金幣 · +300 XP${contributionLevelBonus ? `<br>升級獎勵另加 ${contributionLevelBonus} 金幣` : ''}`
      : `${completionBlockedByWeek ? '本週願望寶箱已領取；新一週會再開放。' : '願望重新達到目標；本章獎勵之前已經領取。'}${contributionLevelBonus ? `<br>今次補給升級，另加 ${contributionLevelBonus} 金幣。` : ''}`;
    popup('真實主線完成！', `<img class="art goal-complete-art" data-art="chest-open" alt="願望寶箱"><p class="expedition-popup-copy"><b>${escapeHtml(goal.name)}</b> 已經準備完成。呢個獎勵來自你真實建立嘅選擇空間。<br><b>${rewardCopy}</b></p>`);
  } else {
    toast(`願望進度 +${fmt(amount)}${firstToday ? ' · +20 XP' : ''}`);
  }
}

function removeGoalContribution(contributionId) {
  const entry = S.goalContributions.find((item) => item.id === contributionId);
  const goal = entry && S.goals.find((item) => item.id === entry.goalId);
  if (!entry || !goal) return;
  popup('刪除呢次願望存入？', `<p class="confirm-copy"><b>${escapeHtml(goal.name)} · ${fmt(entry.amount)}</b><br>${entry.source === 'new_saving' ? '護甲存款會同步扣回呢筆誤記金額。' : '只會移除願望分配，總存款不受影響。'}</p>`, {
    confirmLabel: '確認刪除',
    cancelLabel: '保留紀錄',
    onConfirm: () => {
      S.goalContributions = S.goalContributions.filter((item) => item.id !== entry.id);
      if (entry.source === 'new_saving' && S.finProfile) {
        S.finProfile.savings = Math.max(0, Number(S.finProfile.savings || 0) - Number(entry.amount || 0));
      }
      if (!FinanceGameplay.goalProgress(goal, S.goalContributions).complete) goal.completedAt = null;
      invalidateReview(entry.dateKey);
      save(); renderAll(); toast('願望存入紀錄已刪除');
    },
  });
}

function buy(id) {
  const it = SHOP.find((x) => x.id === id);
  if (it.once && S.items[id] > 0) return;
  if (S.gold < it.cost) { toast('金幣唔夠，做任務贏返嚟先！'); return; }
  S.gold -= it.cost;
  S.items[id]++;
  save(); renderAll();
  toast(`買咗 ${it.name}！`);
}

/* ===================== Render ===================== */
function renderHud() {
  $('hud-level').textContent = S.level;
  $('hud-gold').textContent = S.gold.toLocaleString('en-US');
  $('hud-streak').textContent = S.streak;
  const need = xpNeed(S.level);
  $('hud-xpfill').style.width = Math.min(100, (S.xp / need) * 100) + '%';
  $('hud-xptext').textContent = `Lv.${S.level} · ${S.xp}/${need} XP`;
}
function renderHome() {
  ensureBoss();
  const period = periodInfo();
  document.body.dataset.period = period.id;
  $('scene-period').textContent = period.label;
  $('scene-date').textContent = new Intl.DateTimeFormat('zh-HK', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  $('scene-streak-copy').textContent = S.streak > 0 ? `累積 ${S.streak} 日同行` : '今日冒險';
  $('hero-name').textContent = S.heroName;
  setHeroArt($('hero-img'), S.heroType);
  $('hero-img').classList.toggle('cape', S.items.cape > 0);
  // 今日 HP
  const spent = daySpend(todayKey());
  const committed = dayCommittedSpend(todayKey());
  const pace = safeToSpendToday();
  const rawLeft = pace.safe - spent;
  const left = Math.max(0, rawLeft);
  const pct = pace.safe > 0 ? Math.max(0, Math.min(100, (left / pace.safe) * 100)) : 0;
  const fill = $('hero-hpfill');
  fill.style.width = pct + '%';
  fill.classList.toggle('ok', pct > 40);
  $('hero-hptext').textContent = `${fmt(left)} / ${fmt(pace.safe)}`;
  $('today-safe-amount').textContent = fmt(left);
  $('today-spent-copy').textContent = committed > 0
    ? `日常 ${fmt(spent)} · 固定／預留 ${fmt(committed)}`
    : (spent > 0 ? `今日日常已用 ${fmt(spent)}` : '今日未有日常支出');
  const paceShift = pace.safe - pace.base;
  const commitmentNote = pace.scheduledCommitments > 0 ? `本月另列分期承諾 ${fmt(pace.scheduledCommitments)}。` : '';
  const paceNote = commitmentNote + (!pace.calibrated
    ? '先用固定日平均，累積一個完整記錄日後開始校準'
    : paceShift < 0
    ? `按本月餘額，今日比固定平均收細 ${fmt(Math.abs(paceShift))}`
    : paceShift > 0
      ? `本月尚有空間，今日比固定平均多 ${fmt(paceShift)}`
      : `按本月剩餘 ${pace.daysLeft} 日平均分配`);
  $('hero-sub').textContent = rawLeft < 0
    ? `今日比安心額度多 ${fmt(Math.abs(rawLeft))}；唔使補償，下一筆重新選擇。${paceNote}`
    : (dayHasMoneyActivity(todayKey()) ? `今日仲有 ${fmt(left)} 日常安心額。固定／預留支出唔會喺今日再扣。${paceNote}` : `今日未記帳。日常安心額係 ${fmt(pace.safe)}，第一筆有必爆寶箱。${paceNote}`);
  $('budget-status').textContent = !dayHasMoneyActivity(todayKey())
    ? '等待第一步'
    : (rawLeft < 0 ? '已經看見' : (pct > 40 ? '步調輕鬆' : '慢慢使用'));
  $('hero-mood').textContent = rawLeft < 0
    ? '仍然同行'
    : (dayHasMoneyActivity(todayKey()) ? '節奏穩定' : '準備出發');
  // 魔王
  const dmg = bossDamage(), max = bossMaxHp();
  const hp = Math.max(0, max - dmg);
  $('boss-hpfill').style.width = (hp / max) * 100 + '%';
  $('boss-hptext').textContent = `${fmt(hp)} / ${fmt(max)}`;
  const dead = dmg >= max;
  $('boss-hint').textContent = dead
    ? (S.boss.claimed ? '本週已擊倒魔王，下週一佢會復活再戰。' : '魔王倒地喇！快啲領獎。')
    : `本週目標儲 ${fmt(max)}。每個有紀錄嘅日子，剩低嘅安心額度都會變成攻擊力。`;
  $('boss-claim').classList.toggle('hidden', !dead || S.boss.claimed);
  // 零消費按鈕
  const ns = $('btn-nospend');
  const done = meta(todayKey()).noSpend;
  ns.disabled = done || dailyLogsToday() > 0;
  ns.textContent = done ? '零日常 ✓' : '零日常';
  // 下一步
  const obj = buildObjective();
  $('objective-reward').textContent = obj.reward;
  $('objective-main').innerHTML = obj.body;
  $('objective-action').textContent = obj.label;
  $('objective-action').onclick = obj.action;
  // 每週只留一個洞察同一個下一步
  const reflection = buildWeeklyReflection();
  $('reflection-title').textContent = reflection.title;
  $('reflection-main').textContent = reflection.body;
  $('reflection-action').textContent = reflection.label;
  $('reflection-action').onclick = reflection.action;
  // 護甲
  const ai = armorInfo();
  $('armor-line').innerHTML = S.finProfile
    ? `護甲：<b>${ai.name}</b>（估算可應付 ${ai.months.toFixed(1)} 個月日常使費）${ai.next ? `<span class="armor-next">${ai.next}</span>` : ''}`
    : '';
  $('wellbeing-control').textContent = meta(todayKey()).reviewed
    ? '今日已盤點'
    : (meta(todayKey()).noSpend ? '零消費已確認' : (dayHasMoneyActivity(todayKey()) ? `${moneyActivityCount(todayKey())} 個足印已看見` : '等待第一步'));
  $('wellbeing-resilience').textContent = `${ai.months.toFixed(1)} 個月`;
  $('wellbeing-goal').textContent = `${Math.round((dmg / max) * 100)}%`;
  $('wellbeing-freedom').textContent = fmt(left);
  // 債務惡龍
  const debts = snowballOrder();
  $('debt-card').classList.toggle('hidden', debts.length === 0);
  if (debts.length) {
    $('debt-list').innerHTML = debts.map((d, i) => `
      <div class="debt-row">
        <div class="d-head"><span>${d.name}${i === 0 ? '<span class="focus-tag">主攻</span>' : ''}</span><b>${fmt(d.balance)}</b></div>
        <div class="hpbar debt-hp"><div style="width:${Math.max(2, (d.balance / d.orig) * 100)}%"></div><span>${Math.round((1 - d.balance / d.orig) * 100)}% 已消滅</span></div>
      </div>`).join('') +
      `<button class="btn primary" id="btn-repay">還債（斬龍）</button>`;
    $('btn-repay').onclick = () => openLogSheet('repay');
  }
  // 軍師建議
  const adv = buildAdvice();
  $('advice-card').innerHTML = adv.length
    ? `<div class="sec-head">軍師建議</div>` +
      adv.map((a) => `<div class="adv"><b>${a.t}</b><p>${a.b}</p></div>`).join('') +
      `<p class="disclaimer">一般理財教育資訊，唔構成專業財務意見。</p>`
    : '';
  renderSceneDialogue();
}
let activeQuestView = 'daily';
function switchQuestView(view) {
  if (!['daily', 'weekly'].includes(view)) return;
  activeQuestView = view;
  document.querySelectorAll('[data-quest-view]').forEach((button) => {
    const active = button.dataset.questView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-quest-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.questPanel === view);
  });
}

function renderExpedition() {
  const days = fullWeekDays();
  const today = todayKey();
  const route = FinanceGameplay.routeModel(days, today, days.filter(dayHasMoneyActivity));
  const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  const statusLabels = { cleared: '足印', rest: '休整', current: '今日', future: '未到' };
  const stats = weeklyProgressStats();
  const chapter = FinanceGameplay.chapterFor(S.streak);
  const start = new Date(`${days[0]}T12:00:00`);
  const end = new Date(`${days[6]}T12:00:00`);
  const dateFormat = new Intl.DateTimeFormat('zh-HK', { month: 'numeric', day: 'numeric' });

  $('expedition-week').textContent = `${dateFormat.format(start)} – ${dateFormat.format(end)}`;
  $('expedition-chapter').textContent = `第 ${chapter.number} 章 · ${chapter.name}`;
  $('expedition-days').textContent = `${stats.activeDays} 日同行`;
  setHeroArt($('expedition-hero'), S.heroType);
  $('expedition-route').innerHTML = route.map((day) => `
    <div class="route-stop ${day.status}${day.dateKey === today ? ' today' : ''}" aria-label="星期${weekdayLabels[day.index]}，${statusLabels[day.status]}">
      <span class="route-day">${weekdayLabels[day.index]}</span>
      <span class="route-node">${day.status === 'cleared' ? '<span class="icon" data-icon="check"></span>' : day.index + 1}</span>
      <small>${statusLabels[day.status]}</small>
    </div>`).join('');
  initIcons($('expedition-route'));

  const damage = bossDamage();
  const max = bossMaxHp();
  const hp = Math.max(0, max - damage);
  $('expedition-boss-fill').style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
  $('expedition-boss-hp').textContent = `${fmt(hp)} / ${fmt(max)}`;
  const targetDays = expeditionMeta().targetDays;
  $('expedition-encouragement').textContent = targetDays < 3
    ? `今週較後加入，路標已調整為 ${targetDays} 日；之前日子唔需要補交。`
    : stats.activeDays === 0
    ? '路線未開始。今日留低一個足印就夠，之前日子唔需要補交。'
    : stats.activeDays < 3
      ? `已經行咗 ${stats.activeDays} 日。休整唔會令進度歸零，再揀一日看清楚就可以。`
      : `本週主線已站穩：${stats.activeDays} 日願意面對數字，剩低係自由探索。`;
  $('chapter-current-copy').textContent = `${chapter.name} · 累積同行 ${S.streak} 日`;
  $('chapter-next-copy').textContent = chapter.next
    ? `再 ${chapter.daysToNext} 日到 ${chapter.next.name}`
    : '目前最高章節';
  $('chapter-progress-fill').style.width = `${chapter.progressPct}%`;
}

function renderQuests() {
  renderExpedition();
  const m = meta(todayKey());
  const dailyDone = QUESTS.filter((quest) => questProgress(quest) >= quest.target).length;
  $('daily-quest-count').textContent = `${dailyDone} / ${QUESTS.length}`;
  $('quest-list').innerHTML = QUESTS.map((q) => {
    const p = questProgress(q);
    const claimed = m.questsClaimed.includes(q.id);
    const done = p >= q.target;
    return `<div class="quest${done ? ' done' : ''}" data-quest-id="${q.id}">
      <div class="q-info">
        <div class="q-outcome">${q.outcome}</div>
        <div class="q-name">${q.name}</div>
        <div class="q-desc">${q.desc}</div>
        <div class="q-prog">${claimed ? '已領取' : `${p}/${q.target}`}</div>
        <div class="q-bar"><div style="width:${(p / q.target) * 100}%"></div></div>
      </div>
      ${claimed
        ? `<span class="icon" data-icon="check"></span>`
        : done
          ? `<button class="btn small primary" data-claim="${q.id}">領 ${q.gold}G</button>`
          : `<div class="q-action"><span class="q-reward">${q.gold}G</span><button class="btn small ghost" data-quest-go="${q.id}">開始</button></div>`}
    </div>`;
  }).join('');
  initIcons($('quest-list'));
  $('quest-list').querySelectorAll('[data-claim]').forEach((b) => (b.onclick = () => claimQuest(b.dataset.claim)));
  $('quest-list').querySelectorAll('[data-quest-go]').forEach((b) => (b.onclick = () => startQuest(b.dataset.questGo)));

  const weekState = expeditionMeta();
  const weeklyDone = WEEKLY_QUESTS.filter((quest) => weeklyQuestProgress(quest) >= weekState.targetDays).length;
  $('weekly-quest-count').textContent = `${weeklyDone} / ${WEEKLY_QUESTS.length}`;
  $('weekly-quest-list').innerHTML = WEEKLY_QUESTS.map((quest) => {
    const target = weekState.targetDays;
    const progress = weeklyQuestProgress(quest);
    const claimed = weekState.questsClaimed.includes(quest.id);
    const done = progress >= target;
    const questName = quest.name.replace('3', String(target));
    return `<div class="quest weekly-quest${done ? ' done' : ''}" data-weekly-quest-id="${quest.id}">
      <div class="q-info">
        <div class="q-outcome">${quest.outcome}</div>
        <div class="q-name">${questName}</div>
        <div class="q-desc">${quest.desc}</div>
        <div class="q-prog">${claimed ? '獎勵已領取' : `${progress}/${target} · ${quest.gold}G + ${quest.xp} XP`}</div>
        <div class="q-bar"><div style="width:${(progress / target) * 100}%"></div></div>
      </div>
      ${claimed
        ? '<span class="icon" data-icon="check"></span>'
        : done
          ? `<button class="btn small primary" data-weekly-claim="${quest.id}">領取</button>`
          : `<button class="btn small ghost" data-weekly-go="${quest.id}">今日行動</button>`}
    </div>`;
  }).join('');
  initIcons($('weekly-quest-list'));
  $('weekly-quest-list').querySelectorAll('[data-weekly-claim]').forEach((button) => {
    button.onclick = () => claimWeeklyQuest(button.dataset.weeklyClaim);
  });
  $('weekly-quest-list').querySelectorAll('[data-weekly-go]').forEach((button) => {
    button.onclick = () => switchQuestView('daily');
  });

  const expeditionComplete = FinanceGameplay.expeditionComplete(weekState.questsClaimed);
  const rewardClaimed = weekState.bonusClaimed;
  const rewardImage = $('expedition-reward').querySelector('img');
  rewardImage.dataset.art = rewardClaimed ? 'chest-open' : 'chest-closed';
  rewardImage.src = `assets/${rewardImage.dataset.art}.png`;
  $('expedition-reward').classList.toggle('ready', expeditionComplete && !rewardClaimed);
  $('expedition-reward').classList.toggle('claimed', rewardClaimed);
  $('expedition-reward-title').textContent = rewardClaimed
    ? '本週遠征寶箱已領取'
    : expeditionComplete ? '遠征寶箱已解鎖' : '遠征寶箱未解鎖';
  $('expedition-reward-copy').textContent = rewardClaimed
    ? '獎勵已經收好。剩低日子可以按自己節奏探索。'
    : expeditionComplete
      ? '三個路標都已領取，帶走 180G 同 180 XP。'
      : weekState.targetDays < 3
        ? `今週較後加入，每個路標已調整為 ${weekState.targetDays} 日。領取三項獎勵後開箱。`
        : '完成並領取三個本週路標，就可以帶走章節獎勵。';
  $('expedition-claim').disabled = !expeditionComplete || rewardClaimed;
  $('expedition-claim').textContent = rewardClaimed ? '已領取' : '領取';
  switchQuestView(activeQuestView);
}
function renderGoal() {
  const goal = activeGoal();
  const content = $('goal-content');
  if (!goal) {
    content.innerHTML = `<section class="goal-empty">
      <img class="art" data-art="strategist" alt="錢錢軍師">
      <div><span>真實主線未開始</span><h3>你想為邊一種生活留低選擇？</h3><p>應急庫、旅行、進修或者一筆自由基金都可以。願望唔會扣分，亦唔需要完美期限。</p></div>
      <button class="btn primary" data-goal-create><span class="icon" data-icon="plus"></span>建立願望任務</button>
    </section>`;
  } else {
    const type = goalTypeInfo(goal.type);
    const progress = FinanceGameplay.goalProgress(goal, S.goalContributions);
    const pace = FinanceGameplay.goalPace(goal, S.goalContributions, todayKey());
    const deadlineCopy = goal.deadline
      ? new Intl.DateTimeFormat('zh-HK', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${goal.deadline}T12:00:00`))
      : '自主節奏';
    const paceCopy = progress.complete
      ? '目標已完成。你可以保留呢一章，或者開始下一個真正重要嘅願望。'
      : pace.daysLeft == null
        ? '冇設定死線；每次有空間先行一步，進度唔會因休息倒退。'
        : pace.daysLeft === 0
          ? '原定日期已到，但願望唔會失敗。可以調整日期，或者繼續按目前節奏前進。'
          : `距離希望日期仲有 ${pace.daysLeft} 日；平均每週約 ${fmt(pace.weeklySuggested)} 就可以到達。`;
    const contributions = S.goalContributions
      .filter((entry) => entry.goalId === goal.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);
    content.innerHTML = `<section class="goal-journey${progress.complete ? ' complete' : ''}">
      <div class="goal-head">
        <div><span>${type.name}</span><h3>${escapeHtml(goal.name)}</h3></div>
        <button class="icon-btn" data-goal-edit aria-label="編輯願望任務" title="編輯"><span class="icon" data-icon="edit"></span></button>
      </div>
      <div class="goal-stage">
        <img class="art" data-art="${type.art}" alt="${type.name}">
        <div class="goal-stage-copy"><span>${progress.complete ? '主線完成' : type.prompt}</span><strong>${Math.round(progress.progressPct)}%</strong><small>${deadlineCopy}</small></div>
      </div>
      <div class="goal-track" aria-label="願望進度 ${Math.round(progress.progressPct)}%"><span style="width:${progress.progressPct}%"></span></div>
      <div class="goal-milestones" aria-hidden="true">${progress.milestones.map((milestone) => `<span class="${milestone.reached ? 'reached' : ''}"><i></i><small>${milestone.percent}%</small></span>`).join('')}</div>
      <div class="goal-metrics">
        <div><span>已準備</span><b>${fmt(progress.saved)}</b></div>
        <div><span>目標</span><b>${fmt(progress.target)}</b></div>
        <div><span>尚餘</span><b>${fmt(progress.remaining)}</b></div>
      </div>
      <p class="goal-pace">${paceCopy}</p>
      <button class="btn primary big goal-main-action" ${progress.complete ? 'data-goal-new' : 'data-goal-add'}>${progress.complete ? '<span class="icon" data-icon="plus"></span>開始下一個願望' : '存入願望進度'}</button>
    </section>
    <section class="goal-log-section">
      <div class="quest-section-head"><h3>最近補給</h3><span>${contributions.length ? `共 ${S.goalContributions.filter((entry) => entry.goalId === goal.id).length} 次` : '未有紀錄'}</span></div>
      <div class="goal-log-list">${contributions.length ? contributions.map((entry) => `
        <div class="goal-log-row">
          <div><b>${fmt(entry.amount)}</b><span>${entry.dateKey.slice(5)} · ${entry.source === 'new_saving' ? '新儲起' : '現有存款撥入'}</span></div>
          <button class="icon-btn" data-goal-contribution-delete="${entry.id}" aria-label="刪除願望存入紀錄" title="刪除"><span class="icon" data-icon="trash"></span></button>
        </div>`).join('') : '<p class="tip">第一次存入會留下足印，亦會計入今日金流盤點。</p>'}</div>
    </section>`;
  }
  initArt(content); initIcons(content);
  content.querySelectorAll('[data-goal-create], [data-goal-new]').forEach((button) => (button.onclick = () => openGoalForm()));
  content.querySelectorAll('[data-goal-edit]').forEach((button) => (button.onclick = () => openGoalForm(goal.id)));
  content.querySelectorAll('[data-goal-add]').forEach((button) => (button.onclick = openGoalContribution));
  content.querySelectorAll('[data-goal-contribution-delete]').forEach((button) => {
    button.onclick = () => removeGoalContribution(button.dataset.goalContributionDelete);
  });

  const completedGoals = S.goals.filter((item) => (
    item.id !== (goal && goal.id) && FinanceGameplay.goalProgress(item, S.goalContributions).complete
  )).sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0));
  $('goal-archive').classList.toggle('hidden', completedGoals.length === 0);
  $('goal-archive-count').textContent = `${completedGoals.length} 章`;
  $('goal-archive-list').innerHTML = completedGoals.map((item) => {
    const type = goalTypeInfo(item.type);
    const progress = FinanceGameplay.goalProgress(item, S.goalContributions);
    return `<button class="goal-archive-row" data-goal-select="${item.id}">
      <img class="art" data-art="${type.art}" alt="">
      <span><b>${escapeHtml(item.name)}</b><small>${type.name} · ${fmt(progress.saved)}</small></span>
      <span class="icon" data-icon="check"></span>
    </button>`;
  }).join('');
  initArt($('goal-archive-list')); initIcons($('goal-archive-list'));
  $('goal-archive-list').querySelectorAll('[data-goal-select]').forEach((button) => {
    button.onclick = () => { S.activeGoalId = button.dataset.goalSelect; save(); renderAll(); };
  });
}

function renderShop() {
  renderGoal();
  $('shop-list').innerHTML = SHOP.map((it) => {
    const owned = S.items[it.id] > 0;
    const soldOut = it.once && owned;
    return `<div class="shop-item">
      <span class="icon" data-icon="${it.id === 'shield' ? 'shield-item' : it.id}">${it.id === 'shield' ? '' : ''}</span>
      <div class="s-info">
        <div class="s-name">${it.name}</div>
        <div class="s-desc">${it.desc}</div>
        ${owned ? `<div class="s-own">已擁有${it.once ? '' : ` × ${S.items[it.id]}`}</div>` : ''}
      </div>
      ${soldOut
        ? `<span class="icon" data-icon="check"></span>`
        : `<button class="btn small ${S.gold >= it.cost ? 'primary' : ''}" data-buy="${it.id}">${it.cost}G</button>`}
    </div>`;
  }).join('');
  // 護盾 icon 用生成圖
  $('shop-list').querySelectorAll('[data-icon="shield-item"]').forEach((el) => {
    el.outerHTML = `<img data-art="shield" alt="盾">`;
  });
  initIcons($('shop-list'));
  initArt($('shop-list'));
  $('shop-list').querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
  switchGrowthView(activeGrowthView);
}

let activeStatsView = 'overview';
function switchStatsView(view) {
  activeStatsView = view;
  document.querySelectorAll('[data-stats-view]').forEach((button) => {
    const active = button.dataset.statsView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-stats-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.statsPanel === view);
  });
}

function renderStats() {
  const mk = monthKey();
  const monthExp = S.expenses.filter((e) => e.dateKey.startsWith(mk));
  const totalSpent = monthExp.reduce((s, e) => s + e.amount, 0);
  const dailySpent = monthExp.filter((entry) => expenseBudgetImpact(entry) === 'daily').reduce((sum, entry) => sum + entry.amount, 0);
  const committedSpent = monthExp.filter((entry) => expenseBudgetImpact(entry) === 'committed').reduce((sum, entry) => sum + entry.amount, 0);
  const monthIncome = (S.incomes || []).filter((entry) => entry.dateKey.startsWith(mk));
  const totalIncome = monthIncome.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const monthGoalContributions = (S.goalContributions || []).filter((entry) => entry.dateKey.startsWith(mk));
  const totalGoalSaved = monthGoalContributions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const currentGoal = activeGoal();
  const currentGoalProgress = currentGoal ? FinanceGameplay.goalProgress(currentGoal, S.goalContributions) : null;
  let savedTotal = 0;
  const dayKeys = new Set(S.expenses.map((e) => e.dateKey));
  Object.keys(S.dayMeta).forEach((k) => { if (S.dayMeta[k].noSpend) dayKeys.add(k); });
  const t = todayKey();
  dayKeys.forEach((k) => {
    if (!k.startsWith(mk) || k > t) return;
    savedTotal += Math.max(0, dailyBudget() - daySpend(k));
  });
  $('stat-summary').innerHTML = `
    <div class="stat-box"><div class="v">${fmt(totalIncome)}</div><div class="k">本月已記收入</div></div>
    <div class="stat-box"><div class="v">${fmt(dailySpent)}</div><div class="k">本月日常消費</div></div>
    <div class="stat-box"><div class="v">${fmt(committedSpent)}</div><div class="k">固定／預留支出</div></div>
    <div class="stat-box"><div class="v">${fmt(totalSpent)}</div><div class="k">全部實際支出</div></div>
    <div class="stat-box"><div class="v">${fmt(savedTotal)}</div><div class="k">記帳日安心餘額</div></div>
    <div class="stat-box"><div class="v" style="color:${totalIncome - totalSpent >= 0 ? 'var(--leaf-deep)' : 'var(--coral)'}">${fmt(totalIncome - totalSpent)}</div><div class="k">已記收支差</div></div>
    <div class="stat-box"><div class="v">${fmt(totalGoalSaved)}</div><div class="k">本月願望儲蓄</div></div>
    <div class="stat-box"><div class="v">${currentGoalProgress ? `${Math.round(currentGoalProgress.progressPct)}%` : '未建立'}</div><div class="k">目前真實主線</div></div>`;
  // 資產負債
  const fp = S.finProfile || { savings: 0 };
  const net = fp.savings - totalDebt();
  const repaidTotal = S.repayments.reduce((s, r) => s + r.amount, 0);
  $('bs-summary').innerHTML = `
    <div class="stat-box"><div class="v">${fmt(fp.savings)}</div><div class="k">存款（護甲）</div></div>
    <div class="stat-box"><div class="v" style="color:var(--hp2)">${fmt(totalDebt())}</div><div class="k">債務（惡龍）</div></div>
    <div class="stat-box"><div class="v" style="color:${net >= 0 ? 'var(--green)' : 'var(--hp2)'}">${fmt(net)}</div><div class="k">淨資產（戰力）</div></div>` +
    (repaidTotal > 0 ? `<div class="stat-box wide"><div class="v" style="color:var(--gold)">${fmt(repaidTotal)}</div><div class="k">累計已還債（斬龍總傷害）</div></div>` : '');
  // 最近 7 日
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(keyOf(d)); }
  const maxV = Math.max(dailyBudget(), ...days.map(daySpend), 1);
  $('chart7').innerHTML = days.map((k) => {
    const v = daySpend(k);
    const h = Math.max(3, (v / maxV) * 88);
    return `<div class="c7col"><div class="c7bar${v <= dailyBudget() ? ' ok' : ''}" style="height:${h}px"></div><div class="c7lab">${k.slice(8)}</div></div>`;
  }).join('');
  // 分類
  const byCat = {};
  monthExp.forEach((e) => (byCat[e.cat] = (byCat[e.cat] || 0) + e.amount));
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxC = entries.length ? entries[0][1] : 1;
  $('cat-bars').innerHTML = entries.length
    ? entries.map(([cid, v]) => `<div class="catbar">
        <div class="cb-head"><span>${CATS.find((c) => c.id === cid).name}</span><b>${fmt(v)}</b></div>
        <div class="cb-track"><div style="width:${(v / maxC) * 100}%"></div></div>
      </div>`).join('')
    : '<p class="tip">本月未有紀錄。</p>';
  // 最近紀錄
  const recent = [
    ...S.expenses.map((entry) => ({ ...entry, entryType: 'expense' })),
    ...(S.incomes || []).map((entry) => ({ ...entry, entryType: 'income' })),
    ...(S.cardPayments || []).map((entry) => ({ ...entry, entryType: 'card_payment' })),
    ...(S.goalContributions || []).map((entry) => ({ ...entry, entryType: 'goal_contribution' })),
    ...(S.decisionEncounters || []).filter((entry) => entry.status !== 'recorded').map((entry) => ({
      ...entry, entryType: 'decision', ts: entry.updatedAt || entry.createdAt,
      dateKey: keyOf(new Date(entry.updatedAt || entry.createdAt)),
    })),
    ...(S.repayments || []).map((entry) => ({ ...entry, dateKey: keyOf(new Date(entry.ts)), entryType: 'debt_payment' })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 10);
  $('recent-logs').innerHTML = recent.length
    ? recent.map((entry) => entry.entryType === 'income'
      ? `<div class="log-row">
        <div><span class="lr-cat">${escapeHtml(entry.source || '收入')}</span><span class="lr-date">${entry.dateKey.slice(5)}</span><span class="intent-tag income-tag">收入</span></div>
        <div class="log-amount"><span class="lr-amt income">+${fmt(entry.amount)}</span><button class="icon-btn log-delete" data-del-income="${escapeHtml(entry.id)}" aria-label="刪除呢筆收入" title="刪除"><span class="icon" data-icon="trash"></span></button></div>
      </div>`
      : entry.entryType === 'goal_contribution'
      ? `<div class="log-row">
        <div><span class="lr-cat">${escapeHtml((S.goals.find((goal) => goal.id === entry.goalId) || { name: '願望任務' }).name)}</span><span class="lr-date">${entry.dateKey.slice(5)}</span><span class="intent-tag goal-tag">願望儲蓄</span></div>
        <div class="log-amount"><span class="lr-amt transfer">${fmt(entry.amount)}</span><button class="icon-btn log-delete" data-del-goal-contribution="${entry.id}" aria-label="刪除願望存入紀錄" title="刪除"><span class="icon" data-icon="trash"></span></button></div>
      </div>`
      : entry.entryType === 'decision'
      ? `<div class="log-row decision-log-row">
        <div><span class="lr-cat">${escapeHtml(entry.name || '消費遭遇')}</span><span class="lr-date">${entry.dateKey.slice(5)}</span><span class="intent-tag decision-tag">${entry.status === 'waiting' ? (Number(entry.revisitAt || 0) <= Date.now() ? '待回看' : '封存中') : entry.status === 'passed' ? '已放下' : '準備記帳'}</span></div>
        <div class="log-amount"><span class="lr-amt transfer">${fmt(entry.amount)}</span>${entry.status === 'passed' ? '<span class="icon decision-check" data-icon="check"></span>' : `<button class="btn small ghost" data-open-decision="${entry.id}">回看</button>`}</div>
      </div>`
      : entry.entryType === 'card_payment'
      ? `<div class="log-row">
        <div><span class="lr-cat">${escapeHtml((S.creditCards.find((card) => card.id === entry.cardId) || { name: '信用卡' }).name)} 還款</span><span class="lr-date">${entry.dateKey.slice(5)}</span><span class="intent-tag transfer-tag">還款轉移</span></div>
        <div class="log-amount"><span class="lr-amt transfer">${fmt(entry.amount)}</span><button class="icon-btn log-delete" data-del-card-payment="${escapeHtml(entry.id)}" aria-label="刪除呢筆還款" title="刪除"><span class="icon" data-icon="trash"></span></button></div>
      </div>`
      : entry.entryType === 'debt_payment'
      ? `<div class="log-row">
        <div><span class="lr-cat">${escapeHtml((S.debts.find((debt) => debt.id === entry.debtId) || { name: '債務' }).name)} 還款</span><span class="lr-date">${entry.dateKey.slice(5)}</span><span class="intent-tag transfer-tag">斬龍還款</span></div>
        <div class="log-amount"><span class="lr-amt transfer">${fmt(entry.amount)}</span><button class="icon-btn log-delete" data-del-debt-payment="${entry.id}" aria-label="刪除呢筆債務還款" title="刪除"><span class="icon" data-icon="trash"></span></button></div>
      </div>`
      : `<div class="log-row">
        <div><span class="lr-cat">${(CATS.find((c) => c.id === entry.cat) || { name: '其他' }).name}</span><span class="lr-date">${entry.dateKey.slice(5)}</span>${expenseBudgetImpact(entry) === 'committed' ? '<span class="intent-tag committed-tag">固定／預留</span>' : (entry.intent ? `<span class="intent-tag">${(INTENTS.find((item) => item.id === entry.intent) || { name: '消費' }).name}</span>` : '')}</div>
        <div class="log-amount"><span class="lr-amt">-${fmt(entry.amount)}</span>${entry.source === 'installment' ? '' : `<button class="icon-btn log-delete impact-edit" data-impact-expense="${entry.id}" aria-label="更改呢筆支出嘅預算分類" title="更改預算分類"><span class="icon" data-icon="edit"></span></button>`}<button class="icon-btn log-delete" data-del="${entry.id}" aria-label="刪除呢筆紀錄" title="刪除"><span class="icon" data-icon="trash"></span></button></div>
      </div>`).join('')
    : '<p class="tip">未有紀錄，去記低第一筆啦。</p>';
  initIcons($('recent-logs'));
  $('recent-logs').querySelectorAll('[data-del-goal-contribution]').forEach((button) => {
    button.onclick = () => removeGoalContribution(button.dataset.delGoalContribution);
  });
  $('recent-logs').querySelectorAll('[data-open-decision]').forEach((button) => {
    button.onclick = () => openDecisionEncounter(button.dataset.openDecision);
  });
  $('recent-logs').querySelectorAll('[data-impact-expense]').forEach((button) => (button.onclick = () => {
    const expense = S.expenses.find((entry) => entry.id === Number(button.dataset.impactExpense));
    if (!expense) return;
    const current = expenseBudgetImpact(expense);
    const next = current === 'daily' ? 'committed' : 'daily';
    popup('更改預算分類？', `<p class="confirm-copy"><b>${fmt(expense.amount)}</b><br>${next === 'committed' ? '改為固定／預留後，仍會計入總支出，但唔再扣日常安心額。' : '改為日常後，會重新計入當日同本月日常安心額。'}</p>`, {
      confirmLabel: next === 'committed' ? '改為固定／預留' : '改為日常',
      cancelLabel: '保持原狀',
      onConfirm: () => {
        expense.budgetImpact = next;
        invalidateReview(expense.dateKey);
        save(); renderAll();
        toast(next === 'committed' ? '已改為固定／預留支出' : '已改為日常支出');
      },
    });
  }));
  $('recent-logs').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const expense = S.expenses.find((entry) => entry.id === Number(b.dataset.del));
    if (!expense) return;
    const category = CATS.find((item) => item.id === expense.cat);
    popup('刪除呢個足印？', `<p class="confirm-copy"><b>${category ? category.name : '支出'} ${fmt(expense.amount)}</b><br>刪除後，相關信用卡結欠、分期同任務進度都會一齊同步。</p>`, {
      confirmLabel: '確認刪除',
      cancelLabel: '保留紀錄',
      onConfirm: () => {
        if (expense.source === 'installment' && expense.installmentId) {
          const plan = S.installments.find((item) => item.id === expense.installmentId);
          const payment = plan && plan.schedule.find((item) => item.index === expense.installmentPaymentIndex);
          if (payment) {
            payment.status = 'planned';
            payment.paidAt = null;
            plan.paidMonths = plan.schedule.filter((item) => item.status === 'paid').length;
          }
        } else if (expense.cardId) {
          const card = S.creditCards.find((item) => item.id === expense.cardId);
          if (card) card.currentBalance = Math.max(0, Number(card.currentBalance || 0) - Number(expense.amount || 0));
        }
        S.expenses = S.expenses.filter((entry) => entry.id !== expense.id);
        invalidateReview(expense.dateKey);
        save(); renderAll();
        toast('紀錄已刪除，相關結欠同任務進度已同步');
      },
    });
  }));
  $('recent-logs').querySelectorAll('[data-del-income]').forEach((button) => (button.onclick = () => {
    const income = (S.incomes || []).find((entry) => entry.id === button.dataset.delIncome);
    if (!income) return;
    popup('刪除呢筆收入？', `<p class="confirm-copy"><b>${escapeHtml(income.source || '收入')} ${fmt(income.amount)}</b><br>刪除後會同步更新本月收支差。</p>`, {
      confirmLabel: '確認刪除',
      cancelLabel: '保留紀錄',
      onConfirm: () => {
        S.incomes = S.incomes.filter((entry) => entry.id !== income.id);
        invalidateReview(income.dateKey);
        save(); renderAll();
        toast('收入紀錄已刪除');
      },
    });
  }));
  $('recent-logs').querySelectorAll('[data-del-card-payment]').forEach((button) => (button.onclick = () => {
    const payment = (S.cardPayments || []).find((entry) => entry.id === button.dataset.delCardPayment);
    if (!payment) return;
    const card = S.creditCards.find((entry) => entry.id === payment.cardId);
    popup('刪除呢筆還款？', `<p class="confirm-copy"><b>${escapeHtml(card ? card.name : '信用卡')} ${fmt(payment.amount)}</b><br>刪除後會將金額加回信用卡結欠，但唔會改動日常安心額。</p>`, {
      confirmLabel: '確認刪除',
      cancelLabel: '保留紀錄',
      onConfirm: () => {
        if (card) card.currentBalance = Number(card.currentBalance || 0) + Number(payment.amount || 0);
        S.cardPayments = S.cardPayments.filter((entry) => entry.id !== payment.id);
        invalidateReview(payment.dateKey);
        save(); renderAll();
        toast('還款紀錄已刪除，卡片結欠已同步');
      },
    });
  }));
  $('recent-logs').querySelectorAll('[data-del-debt-payment]').forEach((button) => (button.onclick = () => {
    const payment = S.repayments.find((entry) => entry.id === Number(button.dataset.delDebtPayment));
    if (!payment) return;
    const debt = S.debts.find((entry) => entry.id === payment.debtId);
    const paymentDate = keyOf(new Date(payment.ts));
    popup('刪除呢筆債務還款？', `<p class="confirm-copy"><b>${escapeHtml(debt ? debt.name : '債務')} ${fmt(payment.amount)}</b><br>刪除後會將金額加回債務結欠，但唔會當成新支出。</p>`, {
      confirmLabel: '確認刪除',
      cancelLabel: '保留紀錄',
      onConfirm: () => {
        if (debt) debt.balance = Math.min(Number(debt.orig || Infinity), Number(debt.balance || 0) + Number(payment.amount || 0));
        S.repayments = S.repayments.filter((entry) => entry.id !== payment.id);
        invalidateReview(paymentDate);
        save(); renderAll();
        toast('債務還款已刪除，惡龍結欠已同步');
      },
    });
  }));
}

function closeCardForm() {
  $('card-form-mask').classList.add('hidden');
}

function closeCardPaymentForm() {
  $('card-payment-mask').classList.add('hidden');
}

function openCardPaymentForm(cardId) {
  const card = S.creditCards.find((item) => item.id === cardId);
  if (!card || !(Number(card.currentBalance || 0) > 0)) {
    toast('呢張卡暫時冇已記結欠');
    return;
  }
  const balance = Math.round((Number(card.currentBalance || 0) + Number.EPSILON) * 100) / 100;
  $('card-payment-form').reset();
  $('card-payment-id').value = card.id;
  $('card-payment-title').textContent = `${card.name} 還款`;
  $('card-payment-balance').textContent = fmt(balance);
  $('card-payment-amount').max = String(balance);
  $('card-payment-date').value = todayKey();
  $('card-payment-date').max = todayKey();
  $('card-payment-mask').classList.remove('hidden');
  setTimeout(() => $('card-payment-amount').focus(), 80);
}

function saveCardPaymentForm(event) {
  event.preventDefault();
  const card = S.creditCards.find((item) => item.id === $('card-payment-id').value);
  const amount = Math.round((Number($('card-payment-amount').value) + Number.EPSILON) * 100) / 100;
  const dateKey = $('card-payment-date').value;
  const balance = card ? Number(card.currentBalance || 0) : 0;
  if (!card || !(amount > 0) || amount > balance || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > todayKey()) {
    toast('請檢查還款金額同日期');
    return;
  }
  card.currentBalance = Math.round((Math.max(0, balance - amount) + Number.EPSILON) * 100) / 100;
  S.cardPayments.push({ id: `cardpay-${Date.now()}-${Math.floor(Math.random() * 10000)}`, cardId: card.id, amount, dateKey, ts: Date.now() });
  if (dateKey === todayKey()) {
    invalidateReview(dateKey);
    touchStreak();
  }
  gainGold(15);
  gainXp(20);
  save();
  closeCardPaymentForm();
  renderAll();
  softVibrate([8, 25, 8]);
  toast(`${card.name} 已還 ${fmt(amount)} · +15G · +20 XP`);
}

function openCardForm(cardId) {
  const card = cardId ? S.creditCards.find((item) => item.id === cardId) : null;
  $('card-form').reset();
  $('card-form-id').value = card ? card.id : '';
  $('card-form-title').textContent = card ? '編輯信用卡' : '新增信用卡';
  if (card) {
    $('card-name').value = card.name || '';
    $('card-last4').value = card.last4 || '';
    $('card-limit').value = card.creditLimit == null ? '' : card.creditLimit;
    $('card-balance').value = Number(card.currentBalance || 0);
    $('card-statement-day').value = card.statementDay || '';
    $('card-due-day').value = card.dueDay || '';
    $('card-apr').value = card.annualRate == null ? '' : card.annualRate;
  }
  switchScreen('stats');
  switchStatsView('cards');
  $('card-form-mask').classList.remove('hidden');
  setTimeout(() => $('card-name').focus(), 80);
}

function saveCardForm(event) {
  event.preventDefault();
  const last4 = $('card-last4').value.trim();
  if (last4 && !/^\d{4}$/.test(last4)) {
    toast('卡號尾數要填 4 個數字');
    $('card-last4').focus();
    return;
  }
  const id = $('card-form-id').value;
  const existing = id ? S.creditCards.find((item) => item.id === id) : null;
  const creditLimitValue = $('card-limit').value;
  const annualRateValue = $('card-apr').value;
  const data = {
    name: $('card-name').value.trim().slice(0, 24),
    last4: last4 || null,
    creditLimit: creditLimitValue === '' ? null : Number(creditLimitValue),
    currentBalance: Number($('card-balance').value),
    statementDay: Number($('card-statement-day').value),
    dueDay: Number($('card-due-day').value),
    annualRate: annualRateValue === '' ? null : Number(annualRateValue),
  };
  if (!data.name || data.currentBalance < 0 || data.statementDay < 1 || data.statementDay > 31 || data.dueDay < 1 || data.dueDay > 31) {
    toast('請檢查信用卡資料');
    return;
  }
  if (existing) {
    Object.assign(existing, data);
  } else {
    S.creditCards.push({ id: `card-${Date.now()}-${Math.floor(Math.random() * 10000)}`, ...data, createdAt: Date.now() });
    gainGold(20);
    gainXp(25);
  }
  save();
  closeCardForm();
  renderAll();
  toast(existing ? '信用卡資料已更新' : `${data.name} 已加入信用卡迷宮`);
}

function renderAll() {
  renderHud(); renderHome(); renderQuests(); renderShop(); renderStats();
  if (window.FinanceAdvisor) FinanceAdvisor.render(S);
  scheduleDecisionReminder();
}

/* ===================== 導覽 ===================== */
const screenScroll = { home: 0, quests: 0, shop: 0, stats: 0 };
let activeScreenName = 'home';
function switchScreen(name) {
  if (!Object.prototype.hasOwnProperty.call(screenScroll, name)) return;
  if (name !== 'home') closeSceneDialogue();
  screenScroll[activeScreenName] = window.scrollY;
  document.body.dataset.screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  activeScreenName = name;
  requestAnimationFrame(() => window.scrollTo(0, screenScroll[name] || 0));
}

/* ===================== 新手設定（財務問卷 wizard） ===================== */
let openFinWizard = null;
let replayIntro = null;
function initOnboard() {
  let step = 0, heroType = 'male', incomeType = 'fixed', rate = 0.2, debtsDraft = [];
  let wizardMode = 'intro', dialogueTarget = 2, dialogueIndex = 0;
  let dialogueLines = [], typewriterTimer = null, introLoadTimer = null;
  let dialogueTyping = false, dialogueFullText = '';
  const steps = document.querySelectorAll('.ob-step');

  function getDialogueLines(target) {
    const name = $('ob-name').value.trim() || S.heroName || '勇者';
    const hasDebts = debtsDraft.length > 0;
    const scripts = {
      2: [
        { text: '歡迎嚟到理財王國！', scene: 'strategist' },
        { text: '我係錢錢軍師，專門研究金幣喺日常生活入面嘅足跡。', scene: 'strategist' },
        { text: '喺呢個世界，金幣唔會無故消失。每一次付款，都會喺地圖留低一條路。', scene: 'strategist' },
        { text: '不過，慾望魔王最擅長用忙碌同遺忘，將呢啲路慢慢遮住。', scene: 'boss' },
        { text: '我唔會批評你點使錢。我哋只會一齊睇清楚，下一步可以點行。', scene: 'strategist' },
        { text: '出發之前，先話我知……我應該點稱呼你？', scene: 'strategist' },
      ],
      3: [
        { text: `好，${name}。由今日開始，我會係你嘅同行軍師。`, scene: 'hero' },
        { text: '每位勇者補充資源嘅方式都唔同。你每月大約有幾多金幣入袋？', scene: 'hero' },
      ],
      4: [
        { text: '收入節奏記低咗。呢個數字唔係分數，只係我哋規劃路線嘅起點。', scene: 'strategist' },
        { text: '下一樣係護甲。你目前有幾多流動存款，可以應付突然出現嘅事件？', scene: 'shield' },
      ],
      5: [
        { text: '明白。護甲厚薄都唔緊要，知道現況先可以一步一步強化。', scene: 'shield' },
        { text: '旅途上有冇債務惡龍？有就逐條話我知，冇都可以放心講冇。', scene: 'boss' },
      ],
      6: [
        { text: hasDebts ? `我見到 ${debtsDraft.length} 條惡龍。放心，我會幫你排好攻擊次序。` : '地圖上暫時冇債務惡龍，行裝會輕鬆一啲。', scene: hasDebts ? 'boss' : 'hero' },
        { text: '最後，一齊訂立今個月嘅冒險契約：日常可以用幾多，同每週想儲起幾多？', scene: 'strategist' },
      ],
    };
    return scripts[target] || [];
  }

  function stopTypewriter(showFull = false) {
    if (typewriterTimer) clearInterval(typewriterTimer);
    typewriterTimer = null;
    if (showFull) $('ob-dialogue-text').textContent = dialogueFullText;
    dialogueTyping = false;
    $('ob-dialogue-next').disabled = false;
  }

  function renderDialogueLine() {
    stopTypewriter();
    const line = dialogueLines[dialogueIndex] || { text: '', scene: 'strategist' };
    const sceneAssets = {
      strategist: ['assets/strategist.png', '錢錢軍師'],
      hero: [heroType === 'female' ? 'assets/hero-female.png' : 'assets/hero.png', '同行勇者'],
      shield: ['assets/shield.png', '存款護盾'],
      boss: ['assets/boss.png', '慾望魔王'],
    };
    const character = $('ob-dialogue-character');
    const [sceneSrc, sceneAlt] = sceneAssets[line.scene] || sceneAssets.strategist;
    if (character.dataset.scene !== line.scene) {
      character.src = sceneSrc;
      character.alt = sceneAlt;
      character.dataset.scene = line.scene;
      character.classList.remove('scene-changing');
      void character.offsetWidth;
      character.classList.add('scene-changing');
    }
    dialogueFullText = line.text;
    $('ob-dialogue-text').textContent = '';
    $('ob-dialogue-next').textContent = '下一步';
    $('ob-dialogue-next').disabled = true;
    const characters = Array.from(dialogueFullText);
    let cursor = 0;
    dialogueTyping = true;
    typewriterTimer = setInterval(() => {
      cursor += 1;
      $('ob-dialogue-text').textContent = characters.slice(0, cursor).join('');
      if (cursor >= characters.length) stopTypewriter();
    }, 24);
  }

  function showStep(i) {
    if (i !== 1) stopTypewriter();
    step = i;
    const onboard = document.querySelector('.onboard');
    onboard.classList.toggle('intro-mode', i < 2);
    onboard.classList.toggle('title-mode', i === 0);
    onboard.classList.toggle('dialogue-mode', i === 1);
    onboard.classList.toggle('answer-mode', i >= 2);
    steps.forEach((s) => s.classList.toggle('hidden', Number(s.dataset.step) !== i));
    const questProgress = Math.max(1, i - 1);
    $('ob-bar').style.width = ((questProgress / (steps.length - 2)) * 100) + '%';
    if (i === 6) {
      const inc = Number($('ob-income').value) || 0;
      $('ob-budget-tip').textContent = inc > 0 ? `你收入 ${fmt(inc)}。請填扣除屋租、供款、保費等固定承諾後，真正可以安排日常生活嘅預算。` : '';
      if (!$('ob-budget').value && inc > 0) $('ob-budget').value = Math.round(inc * 0.6);
    }
  }

  function startDialogue(target) {
    dialogueTarget = target;
    dialogueIndex = 0;
    dialogueLines = getDialogueLines(target);
    showStep(1);
    renderDialogueLine();
  }

  $('ob-title-start').onclick = () => {
    const onboard = document.querySelector('.onboard');
    $('ob-title-start').disabled = true;
    onboard.classList.add('loading-mode');
    introLoadTimer = setTimeout(() => {
      onboard.classList.remove('loading-mode');
      $('ob-title-start').disabled = false;
      startDialogue(2);
    }, 650);
  };
  $('ob-dialogue-next').onclick = () => {
    if (dialogueTyping) return;
    if (dialogueIndex < dialogueLines.length - 1) {
      dialogueIndex += 1;
      renderDialogueLine();
      return;
    }
    showStep(dialogueTarget);
  };
  $('ob-hero-type').querySelectorAll('.hero-choice').forEach((choice) => {
    choice.onclick = () => {
      heroType = choice.dataset.heroType;
      $('ob-hero-type').querySelectorAll('.hero-choice').forEach((item) => {
        const selected = item === choice;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      softVibrate(6);
    };
  });
  function renderDebtsDraft() {
    $('ob-debts').innerHTML = debtsDraft.length
      ? debtsDraft.map((d, i) =>
          `<div class="ob-debt-row"><span>${d.name}</span><b>${fmt(d.balance)}</b><button data-i="${i}" type="button">刪</button></div>`).join('')
      : '<p class="tip" style="margin:0">未加入任何債務。</p>';
    $('ob-debts').querySelectorAll('button').forEach((b) =>
      (b.onclick = () => { debtsDraft.splice(Number(b.dataset.i), 1); renderDebtsDraft(); }));
  }
  document.querySelectorAll('.ob-next').forEach((b) => (b.onclick = () => {
    if (step === 3 && !(Number($('ob-income').value) > 0)) { toast('填返每月大約收入先'); return; }
    const nextStep = step + 1;
    if (wizardMode === 'edit') showStep(nextStep);
    else startDialogue(nextStep);
  }));
  $('ob-inctype').querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      $('ob-inctype').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      incomeType = c.dataset.v;
    };
  });
  $('ob-rate').querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      $('ob-rate').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      rate = Number(c.dataset.rate);
    };
  });
  $('ob-debt-addbtn').onclick = () => {
    const name = $('ob-debt-name').value.trim();
    const bal = Number($('ob-debt-bal').value);
    if (!name || !(bal > 0)) { toast('填埋債務名同餘額'); return; }
    debtsDraft.push({ name, balance: bal });
    $('ob-debt-name').value = ''; $('ob-debt-bal').value = '';
    renderDebtsDraft();
  };
  $('ob-start').onclick = () => {
    const b = Number($('ob-budget').value);
    if (!b || b <= 0) { toast('輸入每月預算先開始'); return; }
    const firstTime = !S.onboarded;
    S.onboarded = true;
    S.heroName = $('ob-name').value.trim() || S.heroName || '勇者';
    S.heroType = heroType;
    S.monthlyBudget = b;
    S.saveRate = rate;
    S.finProfile = {
      incomeType,
      income: Number($('ob-income').value) || 0,
      savings: Math.max(0, Number($('ob-savings').value) || 0),
    };
    S.debts = debtsDraft.map((d, i) => ({
      id: d.id || Date.now() + i,
      name: d.name,
      orig: d.orig || d.balance,
      balance: d.balance,
    }));
    save();
    $('onboard-mask').classList.add('hidden');
    renderAll();
    const dragons = liveDebts().length;
    const pace = safeToSpendToday();
    popup(firstTime ? '冒險開始！' : '檔案已更新！', `<p style="color:var(--dim);font-size:13px;line-height:1.7">今日可安心使用係 <b style="color:var(--gold)">${fmt(pace.safe)}</b>；累積一個完整記錄日後，會按本月剩餘預算同日數每日調整。<br>護甲：${armorInfo().name}${dragons ? `<br>惡龍：${dragons} 條 — 軍師已經幫你排好雪球攻擊次序` : ''}<br>${firstTime ? '第一課唔使背規則：直接記低眼前一筆，我會一路帶住你。' : '新資料已經套用到今日步速。'}</p>`, firstTime ? {
      confirmLabel: '立即記第一筆',
      cancelLabel: '先看看營地',
      onConfirm: () => openLogSheet('expense'),
    } : { confirmLabel: '完成' });
  };

  openFinWizard = (mode) => {
    if (introLoadTimer) clearTimeout(introLoadTimer);
    introLoadTimer = null;
    document.querySelector('.onboard').classList.remove('loading-mode');
    $('ob-title-start').disabled = false;
    wizardMode = mode === 'edit' ? 'edit' : 'intro';
    $('ob-name').value = S.heroName === '勇者' ? '' : S.heroName;
    heroType = S.heroType === 'female' ? 'female' : 'male';
    $('ob-hero-type').querySelectorAll('.hero-choice').forEach((choice) => {
      const selected = choice.dataset.heroType === heroType;
      choice.classList.toggle('active', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
    if (S.finProfile) {
      incomeType = S.finProfile.incomeType || 'fixed';
      $('ob-income').value = S.finProfile.income || '';
      $('ob-savings').value = S.finProfile.savings || '';
    }
    $('ob-inctype').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.v === incomeType));
    $('ob-budget').value = S.onboarded ? S.monthlyBudget : '';
    rate = S.saveRate || 0.2;
    $('ob-rate').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.rate) === rate));
    debtsDraft = S.debts.map((d) => ({ ...d }));
    renderDebtsDraft();
    showStep(wizardMode === 'intro' || !S.onboarded ? 0 : 2);
    $('onboard-mask').classList.remove('hidden');
  };
  replayIntro = () => openFinWizard('intro');
}

/* ===================== Shortcuts 快速入帳指南 ===================== */
function showShortcutGuide() {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  popup('Shortcuts 快速入帳', `
    <div style="text-align:left;font-size:12.5px;color:var(--dim);line-height:1.75">
      <p>喺 iPhone「捷徑」App 整一個捷徑，兩下就入到帳：</p>
      <p><b style="color:var(--text)">1.</b> 新增捷徑 → 加動作「<b style="color:var(--text)">要求輸入</b>」（類型：數字，提示：使咗幾多？）</p>
      <p><b style="color:var(--text)">2.</b> 加動作「<b style="color:var(--text)">從選單中選擇</b>」，選項：餐飲／交通／購物／娛樂／帳單／其他</p>
      <p><b style="color:var(--text)">3.</b> 每個選項入面加「<b style="color:var(--text)">開啟 URL</b>」：</p>
      <p style="background:var(--card);border-radius:10px;padding:8px 10px;word-break:break-all;font-family:monospace;font-size:11px">${base}?add=food:<b>[輸入]</b></p>
      <p>分類代號：餐飲=food · 交通=transport · 購物=shopping · 娛樂=fun · 帳單=bills · 其他=other</p>
      <p><b style="color:var(--text)">4.</b> 加去主畫面，或者設定「背面輕點兩下」觸發。</p>
      <p style="border-top:1px solid var(--line);padding-top:8px">而家個 game 行緊喺 <b style="color:var(--text)">${location.host}</b>。iPhone 要用嘅話：同 Mac 連同一 Wi-Fi，URL 用 Mac 嘅 IP（例：<span style="font-family:monospace">http://192.168.0.225:3900</span>，用 <span style="font-family:monospace">ipconfig getifaddr en0</span> 查）。想離開屋企都用到，可以將個 game host 上 GitHub Pages，資料照樣存喺手機。</p>
    </div>`);
}

function bindLogButton() {
  const button = $('btn-log-cta');
  let pointerStartedAt = 0;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let holdFeedbackTimer = null;
  let suppressNextClick = false;

  const clearHold = () => {
    clearTimeout(holdFeedbackTimer);
    holdFeedbackTimer = null;
    button.classList.remove('hold-arming');
  };

  button.title = '點按快速記帳；長按開啟語音記帳';
  button.setAttribute('aria-label', '記眼前一筆；長按開啟語音記帳');
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerStartedAt = Date.now();
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    try { button.setPointerCapture(event.pointerId); } catch (error) {}
    clearHold();
    holdFeedbackTimer = setTimeout(() => {
      if (!moved) {
        button.classList.add('hold-arming');
        softVibrate(6);
      }
    }, 420);
  });
  button.addEventListener('pointermove', (event) => {
    if (!pointerStartedAt) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) {
      moved = true;
      clearHold();
    }
  });
  button.addEventListener('pointerup', (event) => {
    const heldFor = pointerStartedAt ? Date.now() - pointerStartedAt : 0;
    pointerStartedAt = 0;
    try { button.releasePointerCapture(event.pointerId); } catch (error) {}
    clearHold();
    if (!moved && heldFor >= 500) {
      suppressNextClick = true;
      FinanceAdvisor.openVoice();
      softVibrate([8, 24, 8]);
    }
  });
  button.addEventListener('pointercancel', () => {
    pointerStartedAt = 0;
    moved = false;
    clearHold();
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.onclick = (event) => {
    if (suppressNextClick || moved) {
      suppressNextClick = false;
      moved = false;
      event.preventDefault();
      return;
    }
    openLogSheet('expense');
  };
}

/* ===================== 啟動 ===================== */
function init() {
  initArt(); initIcons();
  // numpad
  const keys = ['1','2','3','4','5','6','7','8','9','C','0','back'];
  $('numpad').innerHTML = keys.map((k) =>
    `<button data-k="${k}">${k === 'back' ? '&larr;' : k}</button>`).join('');
  $('numpad').querySelectorAll('button').forEach((b) => (b.onclick = () => numpadPress(b.dataset.k)));
  $('btn-log-save').onclick = saveSheet;
  document.querySelectorAll('[data-budget-impact]').forEach((button) => {
    button.onclick = () => setSheetBudgetImpact(button.dataset.budgetImpact);
  });
  // events
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchScreen(t.dataset.screen)));
  document.querySelectorAll('[data-screen-jump]').forEach((t) => (t.onclick = () => switchScreen(t.dataset.screenJump)));
  document.querySelectorAll('[data-stats-view]').forEach((button) => (button.onclick = () => switchStatsView(button.dataset.statsView)));
  document.querySelectorAll('[data-quest-view]').forEach((button) => (button.onclick = () => switchQuestView(button.dataset.questView)));
  document.querySelectorAll('[data-growth-view]').forEach((button) => (button.onclick = () => switchGrowthView(button.dataset.growthView)));
  document.querySelectorAll('[data-goal-type]').forEach((button) => (button.onclick = () => setGoalType(button.dataset.goalType)));
  document.querySelectorAll('[data-goal-funding]').forEach((button) => (button.onclick = () => setGoalFunding(button.dataset.goalFunding)));
  document.querySelectorAll('[data-decision-source]').forEach((button) => (button.onclick = () => setDecisionSource(button.dataset.decisionSource)));
  document.querySelectorAll('[data-decision-intent]').forEach((button) => (button.onclick = () => setDecisionIntent(button.dataset.decisionIntent)));
  document.querySelectorAll('[data-decision-repayment]').forEach((button) => (button.onclick = () => setDecisionRepayment(button.dataset.decisionRepayment)));
  $('tab-log').onclick = () => FinanceAdvisor.open();
  bindLogButton();
  $('home-reminder-button').onclick = openHomeReminder;
  $('dialogue-close').onclick = closeSceneDialogue;
  $('dialogue-panel').onclick = (event) => {
    if (event.target === $('dialogue-panel')) closeSceneDialogue();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('dialogue-panel').classList.contains('hidden')) closeSceneDialogue();
  });
  $('btn-home-status').onclick = showStatusDialogue;
  $('btn-history-add').onclick = () => openLogSheet('expense');
  $('btn-card-add').onclick = () => openCardForm();
  $('goal-form').onsubmit = saveGoalForm;
  $('goal-form-close').onclick = closeGoalForm;
  $('goal-form-cancel').onclick = closeGoalForm;
  $('goal-delete').onclick = deleteGoal;
  $('goal-form-mask').onclick = (event) => { if (event.target === $('goal-form-mask')) closeGoalForm(); };
  $('goal-contribution-form').onsubmit = saveGoalContribution;
  $('goal-contribution-close').onclick = closeGoalContribution;
  $('goal-contribution-cancel').onclick = closeGoalContribution;
  $('goal-contribution-mask').onclick = (event) => { if (event.target === $('goal-contribution-mask')) closeGoalContribution(); };
  $('decision-form').onsubmit = previewDecisionEncounter;
  $('decision-close').onclick = closeDecisionEncounter;
  $('decision-mask').onclick = (event) => { if (event.target === $('decision-mask')) closeDecisionEncounter(); };
  $('decision-card').onchange = () => {
    const card = (S.creditCards || []).find((item) => item.id === $('decision-card').value);
    $('decision-apr').value = card && card.annualRate != null ? card.annualRate : '';
  };
  $('card-form').onsubmit = saveCardForm;
  $('card-form-close').onclick = closeCardForm;
  $('card-form-cancel').onclick = closeCardForm;
  $('card-form-mask').onclick = (event) => { if (event.target === $('card-form-mask')) closeCardForm(); };
  $('card-payment-form').onsubmit = saveCardPaymentForm;
  $('card-payment-close').onclick = closeCardPaymentForm;
  $('card-payment-cancel').onclick = closeCardPaymentForm;
  $('card-payment-mask').onclick = (event) => { if (event.target === $('card-payment-mask')) closeCardPaymentForm(); };
  $('btn-nospend').onclick = markNoSpend;
  $('expedition-claim').onclick = claimExpeditionBonus;
  $('log-mask').onclick = (e) => { if (e.target === $('log-mask')) closeLogSheet(); };
  $('chest-img').onclick = openChest;
  $('chest-close').onclick = () => $('chest-mask').classList.add('hidden');
  $('boss-claim').onclick = claimBoss;
  $('btn-editfin').onclick = () => openFinWizard('edit');
  $('btn-shortcut').onclick = showShortcutGuide;
  $('btn-replay-intro').onclick = () => replayIntro();
  FinanceAdvisor.init({
    getState: () => S,
    recordExpense: logExpense,
    commit: () => { if (dayHasMoneyActivity(todayKey())) touchStreak(); save(); renderAll(); },
    reward: (gold, xp) => { gainGold(gold); gainXp(xp); },
    invalidateReview: () => invalidateReview(todayKey()),
    toast,
    vibrate: softVibrate,
    today: todayKey,
    month: monthKey,
    initIcons,
    openDecision: () => openDecisionEncounter(),
    openCardForm,
    openCardPaymentForm,
    speak: (speaker, text) => { switchScreen('home'); speak(speaker, text, sceneChoices(buildObjective())); },
  });
  initOnboard();
  ensureBoss();
  renderAll();
  // 未開檔，或者舊存檔未有財務檔案 → 開問卷
  if (!S.onboarded || !S.finProfile) openFinWizard();
  else maybeOpenDailyReminder();
  // Shortcuts / URL 快速入帳：?add=food:45
  const q = new URLSearchParams(location.search);
  const add = q.get('add');
  if (add && S.onboarded) {
    const m = add.match(/^([a-z]+):(\d+)$/);
    history.replaceState(null, '', location.pathname);
    if (m && logExpense(m[1], Number(m[2]))) switchScreen('home');
    else toast('快速入帳格式錯誤');
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
