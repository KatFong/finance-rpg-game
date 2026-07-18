/* 理財勇者 — 核心邏輯（localStorage，無後端） */
'use strict';

/* ===================== 常數 ===================== */
const LS_KEY = 'frpg_v1';

const CATS = [
  { id: 'food', name: '餐飲' },
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
  { id: 'shield', name: '連勝護盾', cost: 120, once: false, desc: '消耗品：斷咗連勝嗰陣自動幫你保住一次' },
  { id: 'cape', name: '黃金披風', cost: 800, once: true, desc: '傳說裝飾：勇者全身發出金光，彰顯理財大師身份' },
];

const QUESTS = [
  { id: 'q_log', name: '記低 3 筆支出', target: 3, gold: 30 },
  { id: 'q_chest', name: '打開 1 個寶箱', target: 1, gold: 20 },
  { id: 'q_save', name: '今日開支保持喺安心額度內', target: 1, gold: 40 },
];

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
  gold: 0, xp: 0, level: 1,
  streak: 0, lastLogDate: null,
  items: { sword: 0, charm: 0, shield: 0, cape: 0 },
  expenses: [],            // {id, ts, dateKey, cat, amount, intent?}
  dayMeta: {},             // dateKey -> {chests, noSpend, questsClaimed:[]}
  boss: { weekKey: null, claimed: false },
});

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return Object.assign(defaults(), JSON.parse(raw));
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

/* ===================== 衍生數值 ===================== */
const dailyBudget = () => Math.round(S.monthlyBudget / 30);
const weeklyBudget = () => dailyBudget() * 7;
const bossMaxHp = () => Math.max(1, Math.round(weeklyBudget() * S.saveRate));
const swordMult = () => (S.items.sword ? 1.15 : 1);
const chestChance = () => 0.3 + (S.items.charm ? 0.1 : 0);

function daySpend(k) {
  return S.expenses.reduce((s, e) => s + (e.dateKey === k ? e.amount : 0), 0);
}
function safeToSpendToday() {
  const now = new Date();
  const mk = monthKey();
  const reservedInstallments = window.FinanceAdvisor ? FinanceAdvisor.monthReserved(S, mk) : 0;
  const base = Math.max(0, Math.round((S.monthlyBudget - reservedInstallments) / 30));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const spentBeforeToday = S.expenses.reduce((sum, expense) => (
    expense.dateKey.startsWith(mk) && expense.dateKey < todayKey() ? sum + expense.amount : sum
  ), 0);
  const priorActiveDays = new Set(S.expenses
    .filter((expense) => expense.dateKey.startsWith(mk) && expense.dateKey < todayKey())
    .map((expense) => expense.dateKey));
  Object.keys(S.dayMeta).forEach((key) => {
    if (key.startsWith(mk) && key < todayKey() && S.dayMeta[key].noSpend) priorActiveDays.add(key);
  });
  const remainingMonth = Math.max(0, S.monthlyBudget - spentBeforeToday - reservedInstallments);
  const rawSafe = Math.max(0, Math.round(remainingMonth / Math.max(1, daysLeft)));
  const calibrated = priorActiveDays.size > 0;
  const safe = calibrated ? Math.min(rawSafe, Math.round(base * 1.25)) : base;
  return { safe, base, rawSafe, calibrated, remainingMonth, daysLeft, spentBeforeToday, reservedInstallments };
}
function dayActive(k) {
  return (S.dayMeta[k] && S.dayMeta[k].noSpend) || S.expenses.some((e) => e.dateKey === k);
}
function meta(k) {
  if (!S.dayMeta[k]) S.dayMeta[k] = { chests: 0, noSpend: false, questsClaimed: [] };
  if (!S.dayMeta[k].questsClaimed) S.dayMeta[k].questsClaimed = [];
  return S.dayMeta[k];
}
// 每日對魔王嘅傷害上限＝血量五分一：一週最少要出動 5 日先殺到佢（迫每日返嚟）
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
function totalDebt() { return S.debts.reduce((s, d) => s + d.balance, 0); }
function liveDebts() { return S.debts.filter((d) => d.balance > 0); }
// 雪球還債法：由最細餘額嗰條開始
function snowballOrder() { return [...liveDebts()].sort((a, b) => a.balance - b.balance); }
function armorInfo() {
  const savings = S.finProfile ? S.finProfile.savings : 0;
  const months = savings / Math.max(1, S.monthlyBudget);
  if (months < 1) return { name: '布衣', months, next: '儲夠 1 個月使費升級皮甲' };
  if (months < 3) return { name: '皮甲', months, next: '儲夠 3 個月使費升級鐵甲' };
  if (months < 6) return { name: '鐵甲', months, next: '儲夠 6 個月使費升級龍鱗甲' };
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

function renderDialogueChoices(choices) {
  const box = $('dialogue-choices');
  box.innerHTML = '';
  (choices || []).forEach((choice) => {
    const button = document.createElement('button');
    button.className = `dialogue-choice${choice.primary ? ' primary' : ''}`;
    button.textContent = choice.label;
    button.onclick = () => {
      softVibrate(6);
      choice.action();
    };
    box.appendChild(button);
  });
}

function speak(speaker, text, choices, immediate) {
  clearInterval(dialogueTimer);
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
  return [
    { label: objective.label, primary: true, action: objective.action },
    { label: '問軍師', action: showAdviceDialogue },
    { label: '今日狀況', action: showStatusDialogue },
  ];
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
    { label: '睇每日任務', action: () => switchScreen('quests') },
    { label: '返回', action: () => renderSceneDialogue(true) },
  ]);
}

function showStatusDialogue() {
  activeDialogueKey = 'status';
  const spent = daySpend(todayKey());
  const pace = safeToSpendToday();
  const left = pace.safe - spent;
  const dmg = bossDamage();
  const max = bossMaxHp();
  const reserveNote = pace.reservedInstallments > 0 ? `本月分期已先留起 ${fmt(pace.reservedInstallments)}。` : '';
  const paceBasis = pace.calibrated
    ? `${reserveNote}呢個數已按本月剩餘 ${fmt(pace.remainingMonth)} 同 ${pace.daysLeft} 日路程調整。`
    : `${reserveNote}暫時先用每日平均 ${fmt(pace.base)}；有一日完整紀錄後，我先開始校準。`;
  const text = left >= 0
    ? `今日記咗 ${logsToday()} 筆，仲有 ${fmt(left)} 可以安心使用。${paceBasis}本週對魔王造成咗 ${fmt(dmg)} 傷害。`
    : `今日記咗 ${logsToday()} 筆，暫時比安心額度多 ${fmt(Math.abs(left))}。唔需要懲罰自己，我哋已經知道情況，之後每一筆都可以重新選擇。`;
  speak('錢錢軍師', text, [
    { label: '記一筆', primary: true, action: () => openLogSheet('expense') },
    { label: '睇戰績', action: () => switchScreen('stats') },
    { label: '返回', action: () => renderSceneDialogue(true) },
  ]);
}

function renderSceneDialogue(force) {
  const objective = buildObjective();
  const spent = daySpend(todayKey());
  const pace = safeToSpendToday();
  const active = dayActive(todayKey());
  const returning = S.lastLogDate && S.lastLogDate < yesterdayKey();
  const dead = bossDamage() >= bossMaxHp();
  const period = periodInfo();
  const key = [todayKey(), S.heroName, pace.safe, bossMaxHp(), spent, logsToday(), bossDamage(), S.boss.claimed, S.lastLogDate, objective.label].join('|');
  if (!force && activeDialogueKey === key) return;
  activeDialogueKey = key;

  let text;
  if (dead && !S.boss.claimed) {
    text = `${S.heroName}，你做到了！慾望魔王已經倒下，今週每一次克制都冇白費。先收好獎勵啦。`;
  } else if (!active && returning) {
    text = `${period.greeting}，${S.heroName}，歡迎返嚟。唔使補晒之前日子，過去努力亦冇消失；今日記一筆，就可以由而家重新開始。`;
  } else if (!active) {
    text = `${period.greeting}，${S.heroName}。今日有 ${fmt(pace.safe)} 可以安心使用。記低第一筆；累積一日完整紀錄後，我會按本月餘額幫你校準步速。`;
  } else if (spent > pace.safe) {
    text = `今日已經用過安心額度。記帳唔係審判；肯望清楚發生咗咩，就已經停止咗逃避，下一筆仍然有選擇。`;
  } else if (logsToday() < 3) {
    text = `做得好，${S.heroName}。今日已經記低 ${logsToday()} 筆，仲有 ${fmt(pace.safe - spent)} 可以安心使用。再行一步就更接近每日任務。`;
  } else {
    text = `今日節奏好穩。你嘅每筆選擇都已經寫入冒險手帳，剩返嘅能量會喺今晚化成對魔王嘅傷害。`;
  }
  speak('錢錢軍師', text, sceneChoices(objective));
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
function popup(title, bodyHtml) {
  $('pop-title').textContent = title;
  $('pop-body').innerHTML = bodyHtml;
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

/* ===================== 連勝 ===================== */
function touchStreak() {
  const t = todayKey();
  if (S.lastLogDate === t) return;
  if (S.lastLogDate === yesterdayKey() ) { S.streak++; }
  else if (!S.lastLogDate) { S.streak = 1; }
  else if (S.items.shield > 0) { S.items.shield--; S.streak++; toast('連勝護盾發動！連勝保住咗'); }
  else {
    if (S.streak >= 3) toast(`休息完再出發；之前 ${S.streak} 日嘅努力仍然算數`);
    S.streak = 1;
  }
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
let selCat = null, amtStr = '0', sheetMode = 'expense';
function openLogSheet(mode) {
  sheetMode = mode || 'expense';
  selCat = null; amtStr = '0';
  $('log-step-title').textContent = sheetMode === 'repay' ? '還俾邊條惡龍？' : '今日使咗喺邊度？';
  $('log-guide').textContent = sheetMode === 'repay'
    ? '揀一條債務惡龍。我建議先集中火力打最細嗰條。'
    : '慢慢諗，今日呢筆支出屬於邊一段生活？';
  $('log-cats').classList.remove('hidden');
  $('log-amount').classList.add('hidden');
  renderCats();
  renderQuickLogs();
  $('log-mask').classList.remove('hidden');
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
    .filter((expense) => {
      const key = `${expense.cat}:${expense.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  quick.classList.toggle('hidden', recent.length === 0);
  list.innerHTML = recent.map((expense) => {
    const cat = CATS.find((item) => item.id === expense.cat);
    return `<button class="quick-log-btn" data-cat="${expense.cat}" data-amount="${expense.amount}"><span>${cat.name}</span><b>${fmt(expense.amount)}</b></button>`;
  }).join('');
  list.querySelectorAll('.quick-log-btn').forEach((button) => {
    button.onclick = () => {
      closeLogSheet();
      if (logExpense(button.dataset.cat, Number(button.dataset.amount))) switchScreen('home');
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
        $('log-guide').textContent = `${cat.name}，明白。輸入銀碼，我會幫你計返今日仲有幾多能量。`;
      }
      $('log-quick').classList.add('hidden');
      $('log-cats').classList.add('hidden');
      $('log-amount').classList.remove('hidden');
      amtStr = '0'; renderAmt();
    };
  });
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
  const first = isToday && logsToday() === 0 && !(S.dayMeta[t] && S.dayMeta[t].noSpend);
  const entryId = Date.now();
  S.expenses.push({
    id: entryId, ts: entryId, dateKey: t, cat: cid, amount: Number(amount),
    merchant: opts.merchant || null, cardId: opts.cardId || null,
    installmentId: opts.installmentId || null, intent: opts.intent || null,
    installmentPaymentIndex: Number.isInteger(opts.installmentPaymentIndex) ? opts.installmentPaymentIndex : null,
    source: opts.source || 'manual',
  });
  if (opts.cardId && opts.source !== 'installment') {
    const card = S.creditCards.find((item) => item.id === opts.cardId);
    if (card) card.currentBalance = Number(card.currentBalance || 0) + Number(amount);
  }
  if (isToday && meta(t).noSpend) { meta(t).noSpend = false; toast('今日零消費標記已取消'); }
  if (isToday) {
    touchStreak();
    gainXp(10);
  }
  save();
  renderAll();
  toast(isToday ? `已記低 ${fmt(amount)} · XP +10` : `已補記 ${t} · ${fmt(amount)}`);
  softVibrate([8, 30, 8]);
  if (isToday) {
    clearTimeout(pendingChestTimer);
    if (!opts.skipDialogue && !opts.intent) {
      setTimeout(() => showExpenseReaction(cid, amount, first, entryId), 80);
      pendingChestTimer = setTimeout(() => maybeChest(first), 12000);
    } else {
      pendingChestTimer = setTimeout(() => maybeChest(first), 450);
    }
  }
  return true;
}
function saveSheet() {
  const amount = Number(amtStr);
  if (!selCat || amount <= 0) { toast('輸入返個銀碼先'); return; }
  if (sheetMode === 'repay') {
    closeLogSheet();
    repayDebt(Number(selCat), amount);
  } else {
    closeLogSheet();
    if (logExpense(selCat, amount)) switchScreen('home');
  }
}

/* ===================== 還債（斬龍） ===================== */
function repayDebt(debtId, amount) {
  const d = S.debts.find((x) => x.id === debtId);
  if (!d || d.balance <= 0) return;
  const pay = Math.min(amount, d.balance);
  d.balance -= pay;
  S.repayments.push({ id: Date.now(), ts: Date.now(), debtId, amount: pay });
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
  if (logsToday() > 0) { toast('今日已經有支出紀錄喇'); return; }
  if (meta(t).noSpend) { toast('今日已經標記咗零消費'); return; }
  meta(t).noSpend = true;
  touchStreak();
  gainGold(30);
  gainXp(50);
  save(); renderAll();
  softVibrate([8, 25, 8]);
  pulseScene();
  popup('零消費達成！', `<p style="color:var(--dim);font-size:13px;line-height:1.7">勇者今日完全冇俾慾望魔王吸血！<br><b style="color:var(--gold)">+30 金幣 · +50 XP</b><br>成日嘅預算全數化為攻擊力。</p>`);
  setTimeout(() => maybeChest(true), 400);
}

/* ===================== 任務 ===================== */
function questProgress(q) {
  const t = todayKey(), m = meta(t);
  if (q.id === 'q_log') return Math.min(q.target, logsToday());
  if (q.id === 'q_chest') return Math.min(q.target, m.chests);
  if (q.id === 'q_save') return (dayActive(t) && daySpend(t) <= safeToSpendToday().safe) ? 1 : 0;
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
      b: `你而家嘅護甲係「${ai.name}」（存款夠用 ${ai.months.toFixed(1)} 個月）。下一個目標：儲夠 3 個月使費（${fmt(S.monthlyBudget * 3)}）做應急庫，突發事件先唔會打斷你嘅冒險。`,
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
  const affordable = SHOP.find((it) => S.gold >= it.cost && !(it.once && S.items[it.id] > 0));
  const saveQuest = QUESTS.find((q) => q.id === 'q_save');
  const saveReady = saveQuest && questProgress(saveQuest) >= saveQuest.target && !meta(t).questsClaimed.includes(saveQuest.id);

  if (dmg >= max && !S.boss.claimed) {
    return {
      reward: '+150G · +200 XP',
      body: '本週魔王已經倒地。領咗勝利獎勵，再將金幣拎去商店升裝。',
      label: '領取魔王獎勵',
      action: claimBoss,
    };
  }
  if (!dayActive(t)) {
    return {
      reward: '必爆寶箱',
      body: '今日未出動。記低第一筆支出，或者真係冇使錢就標記零消費，先會計入本週打魔王傷害。',
      label: '記第一筆支出',
      action: () => openLogSheet('expense'),
    };
  }
  if (logsToday() < 3) {
    return {
      reward: '每日任務',
      body: `今日已記低 <b>${logsToday()}</b>/3 筆。補到 3 筆就可以完成記帳任務，攞金幣加速買裝備。`,
      label: '再記一筆',
      action: () => openLogSheet('expense'),
    };
  }
  if (saveReady) {
    return {
      reward: '+40G',
      body: '今日開支仲喺動態安心額度內，慳錢任務已完成。去任務頁收低獎勵。',
      label: '去任務頁',
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
  if (affordable) {
    return {
      reward: `${affordable.cost}G`,
      body: `金幣夠買 <b>${affordable.name}</b>。升裝可以強化記帳獎勵或者打魔王效率。`,
      label: '去商店',
      action: () => switchScreen('shop'),
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
  const expenses = S.expenses.filter((expense) => daySet.has(expense.dateKey));
  const activeDays = days.filter(dayActive).length;
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
      title: `本週有 ${activeDays} 日零消費`,
      body: '你有主動確認，而唔係靠「冇記就當冇使」。呢份清楚就係進度。',
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

/* ===================== 商店 ===================== */
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
  const broken = S.lastLogDate && S.lastLogDate < yesterdayKey() && !S.items.shield;
  $('hud-streak').textContent = broken ? 0 : S.streak;
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
  $('scene-streak-copy').textContent = S.streak > 0 ? `${S.streak} 日同行` : '今日冒險';
  $('hero-name').textContent = S.heroName;
  setHeroArt($('hero-img'), S.heroType);
  $('hero-img').classList.toggle('cape', S.items.cape > 0);
  // 今日 HP
  const spent = daySpend(todayKey());
  const pace = safeToSpendToday();
  const rawLeft = pace.safe - spent;
  const left = Math.max(0, rawLeft);
  const pct = pace.safe > 0 ? Math.max(0, Math.min(100, (left / pace.safe) * 100)) : 0;
  const fill = $('hero-hpfill');
  fill.style.width = pct + '%';
  fill.classList.toggle('ok', pct > 40);
  $('hero-hptext').textContent = `${fmt(left)} / ${fmt(pace.safe)}`;
  const paceShift = pace.safe - pace.base;
  const reserveNote = pace.reservedInstallments > 0 ? `已預留本月分期 ${fmt(pace.reservedInstallments)}。` : '';
  const paceNote = reserveNote + (!pace.calibrated
    ? '先用固定日平均，累積一個完整記錄日後開始校準'
    : paceShift < 0
    ? `按本月餘額，今日比固定平均收細 ${fmt(Math.abs(paceShift))}`
    : paceShift > 0
      ? `本月尚有空間，今日比固定平均多 ${fmt(paceShift)}`
      : `按本月剩餘 ${pace.daysLeft} 日平均分配`);
  $('hero-sub').textContent = rawLeft < 0
    ? `今日比安心額度多 ${fmt(Math.abs(rawLeft))}；唔使補償，下一筆重新選擇。${paceNote}`
    : (dayActive(todayKey()) ? `今日仲有 ${fmt(left)} 可以安心使用。${paceNote}` : `今日未記帳。可安心使用 ${fmt(pace.safe)}，第一筆有必爆寶箱。${paceNote}`);
  $('budget-status').textContent = !dayActive(todayKey())
    ? '等待第一步'
    : (rawLeft < 0 ? '已經看見' : (pct > 40 ? '步調輕鬆' : '慢慢使用'));
  $('hero-mood').textContent = rawLeft < 0
    ? '仍然同行'
    : (dayActive(todayKey()) ? '節奏穩定' : '準備出發');
  // 魔王
  const dmg = bossDamage(), max = bossMaxHp();
  const hp = Math.max(0, max - dmg);
  $('boss-hpfill').style.width = (hp / max) * 100 + '%';
  $('boss-hptext').textContent = `${fmt(hp)} / ${fmt(max)}`;
  const dead = dmg >= max;
  $('boss-hint').textContent = dead
    ? (S.boss.claimed ? '本週已擊倒魔王，下週一佢會復活再戰。' : '魔王倒地喇！快啲領獎。')
    : `本週每日慳落嘅錢就係對佢嘅傷害（目標儲 ${fmt(max)}，每日最多斬 ${fmt(dayDmgCap())}）。一週要出動至少 5 日先殺到佢，唔記帳嗰日唔計傷害。`;
  $('boss-claim').classList.toggle('hidden', !dead || S.boss.claimed);
  // 零消費按鈕
  const ns = $('btn-nospend');
  const done = meta(todayKey()).noSpend;
  ns.disabled = done || logsToday() > 0;
  ns.textContent = done ? '今日零消費 — 達成' : '今日零消費';
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
    ? `護甲：<b>${ai.name}</b>（存款夠用 ${ai.months.toFixed(1)} 個月）${ai.next ? `<span class="armor-next">${ai.next}</span>` : ''}`
    : '';
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
function renderQuests() {
  const m = meta(todayKey());
  $('quest-list').innerHTML = QUESTS.map((q) => {
    const p = questProgress(q);
    const claimed = m.questsClaimed.includes(q.id);
    const done = p >= q.target;
    return `<div class="quest${done ? ' done' : ''}">
      <div class="q-info">
        <div class="q-name">${q.name}</div>
        <div class="q-prog">${claimed ? '已領取' : `${p}/${q.target}`}</div>
        <div class="q-bar"><div style="width:${(p / q.target) * 100}%"></div></div>
      </div>
      ${claimed
        ? `<span class="icon" data-icon="check"></span>`
        : done
          ? `<button class="btn small primary" data-claim="${q.id}">領 ${q.gold}G</button>`
          : `<span class="q-reward">${q.gold}G</span>`}
    </div>`;
  }).join('');
  initIcons($('quest-list'));
  $('quest-list').querySelectorAll('[data-claim]').forEach((b) => (b.onclick = () => claimQuest(b.dataset.claim)));
}
function renderShop() {
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
}
function renderStats() {
  const mk = monthKey();
  const monthExp = S.expenses.filter((e) => e.dateKey.startsWith(mk));
  const totalSpent = monthExp.reduce((s, e) => s + e.amount, 0);
  let savedTotal = 0;
  const dayKeys = new Set(S.expenses.map((e) => e.dateKey));
  Object.keys(S.dayMeta).forEach((k) => { if (S.dayMeta[k].noSpend) dayKeys.add(k); });
  const t = todayKey();
  dayKeys.forEach((k) => {
    if (!k.startsWith(mk) || k > t) return;
    savedTotal += Math.max(0, dailyBudget() - daySpend(k));
  });
  $('stat-summary').innerHTML = `
    <div class="stat-box"><div class="v">${fmt(totalSpent)}</div><div class="k">本月總開支</div></div>
    <div class="stat-box"><div class="v">${fmt(savedTotal)}</div><div class="k">本月已儲（記帳日）</div></div>`;
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
  const recent = [...S.expenses].sort((a, b) => b.ts - a.ts).slice(0, 10);
  $('recent-logs').innerHTML = recent.length
    ? recent.map((e) => `<div class="log-row">
        <div><span class="lr-cat">${CATS.find((c) => c.id === e.cat).name}</span><span class="lr-date">${e.dateKey.slice(5)}</span>${e.intent ? `<span class="intent-tag">${INTENTS.find((item) => item.id === e.intent).name}</span>` : ''}</div>
        <div><span class="lr-amt">-${fmt(e.amount)}</span> <button class="btn small ghost" data-del="${e.id}" style="padding:4px 10px;margin-left:6px">刪</button></div>
      </div>`).join('')
    : '<p class="tip">未有紀錄，去記低第一筆啦。</p>';
  $('recent-logs').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const expense = S.expenses.find((entry) => entry.id === Number(b.dataset.del));
    if (!expense) return;
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
    save(); renderAll();
    toast('紀錄已刪除，相關結欠同任務進度已同步');
  }));
}
function renderAll() {
  renderHud(); renderHome(); renderQuests(); renderShop(); renderStats();
  if (window.FinanceAdvisor) FinanceAdvisor.render(S);
}

/* ===================== 導覽 ===================== */
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
}

/* ===================== 新手設定（財務問卷 wizard） ===================== */
let openFinWizard = null;
let replayIntro = null;
function initOnboard() {
  let step = 0, heroType = 'male', incomeType = 'fixed', rate = 0.2, debtsDraft = [];
  let wizardMode = 'intro', dialogueTarget = 2, dialogueIndex = 0;
  let dialogueLines = [], typewriterTimer = null, dialogueTyping = false, dialogueFullText = '';
  const steps = document.querySelectorAll('.ob-step');

  function getDialogueLines(target) {
    const name = $('ob-name').value.trim() || S.heroName || '勇者';
    const hasDebts = debtsDraft.length > 0;
    const scripts = {
      2: [
        '歡迎嚟到理財王國！',
        '我係錢錢軍師，專門幫勇者搵返每一枚失去方向嘅金幣。',
        '喺呢個世界，金幣唔會無故消失。每一次付款，都會喺你嘅金流地圖留低一條路。',
        '我唔會批評你點使錢。我哋只會一齊睇清楚，下一步可以點行。',
        '出發之前，先話我知……我應該點稱呼你？',
      ],
      3: [
        `好，${name}。由今日開始，我會係你嘅同行軍師。`,
        '每位勇者補充資源嘅方式都唔同。你每月大約有幾多金幣入袋？',
      ],
      4: [
        '收入節奏記低咗。呢個數字唔係分數，只係我哋規劃路線嘅起點。',
        '下一樣係護甲。你目前有幾多流動存款，可以應付突然出現嘅事件？',
      ],
      5: [
        '明白。護甲厚薄都唔緊要，知道現況先可以一步一步強化。',
        '旅途上有冇債務惡龍？有就逐條話我知，冇都可以放心講冇。',
      ],
      6: [
        hasDebts ? `我見到 ${debtsDraft.length} 條惡龍。放心，我會幫你排好攻擊次序。` : '地圖上暫時冇債務惡龍，行裝會輕鬆一啲。',
        '最後，一齊訂立今個月嘅冒險契約：日常可以用幾多，同每週想儲起幾多？',
      ],
    };
    return scripts[target] || [];
  }

  function stopTypewriter(showFull = false) {
    if (typewriterTimer) clearInterval(typewriterTimer);
    typewriterTimer = null;
    if (showFull) $('ob-dialogue-text').textContent = dialogueFullText;
    dialogueTyping = false;
  }

  function renderDialogueLine() {
    stopTypewriter();
    dialogueFullText = dialogueLines[dialogueIndex] || '';
    $('ob-dialogue-text').textContent = '';
    $('ob-dialogue-count').textContent = `${dialogueIndex + 1} / ${dialogueLines.length}`;
    $('ob-dialogue-next').textContent = dialogueIndex === dialogueLines.length - 1 ? '回答軍師' : '下一句';
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
      $('ob-budget-tip').textContent = inc > 0 ? `你收入 ${fmt(inc)}。參考：日常使費預算最好唔超過收入七成，剩返嘅留俾儲蓄同還債。` : '';
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

  $('ob-title-start').onclick = () => startDialogue(2);
  $('ob-dialogue-next').onclick = () => {
    if (dialogueTyping) {
      stopTypewriter(true);
      return;
    }
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
    popup(firstTime ? '冒險開始！' : '檔案已更新！', `<p style="color:var(--dim);font-size:13px;line-height:1.7">今日可安心使用係 <b style="color:var(--gold)">${fmt(pace.safe)}</b>；累積一個完整記錄日後，會按本月剩餘預算同日數每日調整。<br>護甲：${armorInfo().name}${dragons ? `<br>惡龍：${dragons} 條 — 軍師已經幫你排好雪球攻擊次序` : ''}<br>而家記低今日第一筆支出，有必爆寶箱！</p>`);
  };

  openFinWizard = (mode) => {
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

/* ===================== 啟動 ===================== */
function init() {
  initArt(); initIcons();
  // numpad
  const keys = ['1','2','3','4','5','6','7','8','9','C','0','back'];
  $('numpad').innerHTML = keys.map((k) =>
    `<button data-k="${k}">${k === 'back' ? '&larr;' : k}</button>`).join('');
  $('numpad').querySelectorAll('button').forEach((b) => (b.onclick = () => numpadPress(b.dataset.k)));
  $('btn-log-save').onclick = saveSheet;
  // events
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchScreen(t.dataset.screen)));
  document.querySelectorAll('[data-screen-jump]').forEach((t) => (t.onclick = () => switchScreen(t.dataset.screenJump)));
  $('tab-log').onclick = () => FinanceAdvisor.open();
  $('btn-log-cta').onclick = () => openLogSheet('expense');
  $('btn-nospend').onclick = markNoSpend;
  $('log-mask').onclick = (e) => { if (e.target === $('log-mask')) closeLogSheet(); };
  $('chest-img').onclick = openChest;
  $('chest-close').onclick = () => $('chest-mask').classList.add('hidden');
  $('pop-close').onclick = () => $('pop-mask').classList.add('hidden');
  $('boss-claim').onclick = claimBoss;
  $('btn-editfin').onclick = () => openFinWizard('edit');
  $('btn-shortcut').onclick = showShortcutGuide;
  $('btn-replay-intro').onclick = () => replayIntro();
  FinanceAdvisor.init({
    getState: () => S,
    recordExpense: logExpense,
    commit: () => { save(); renderAll(); },
    reward: (gold, xp) => { gainGold(gold); gainXp(xp); },
    toast,
    vibrate: softVibrate,
    today: todayKey,
    month: monthKey,
    initIcons,
    speak: (speaker, text) => { switchScreen('home'); speak(speaker, text, sceneChoices(buildObjective())); },
  });
  initOnboard();
  ensureBoss();
  renderAll();
  // 未開檔，或者舊存檔未有財務檔案 → 開問卷
  if (!S.onboarded || !S.finProfile) openFinWizard();
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
