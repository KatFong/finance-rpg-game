(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FinanceGameplay = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const WEEKLY_QUESTS = [
    {
      id: 'w_presence', metric: 'activeDays', target: 3, gold: 90, xp: 60,
      outcome: '穩定同行', name: '留下 3 日金流足印',
      desc: '記任何金流或確認零日常都算。唔需要連續，休息一日亦唔會歸零。',
    },
    {
      id: 'w_review', metric: 'reviewDays', target: 3, gold: 110, xp: 80,
      outcome: '看清全貌', name: '完成 3 次收隊盤點',
      desc: '望一眼日常、固定、收入同還款；盤點係確認，不是考試。',
    },
    {
      id: 'w_story', metric: 'storyDays', target: 3, gold: 130, xp: 100,
      outcome: '有意識選擇', name: '寫下 3 日消費故事',
      desc: '每日一個「必需、享受、衝動」已經足夠；零日常亦係主動選擇。',
    },
  ];

  const CHAPTERS = [
    { id: 'mist-camp', minDays: 0, name: '霧中營地', subtitle: '先令金流重新可見' },
    { id: 'coin-trail', minDays: 3, name: '金流小徑', subtitle: '開始看見生活節奏' },
    { id: 'promise-pass', minDays: 7, name: '承諾峽谷', subtitle: '分清日常與固定承諾' },
    { id: 'choice-woods', minDays: 14, name: '選擇森林', subtitle: '為每次付款保留自主空間' },
    { id: 'dawn-kingdom', minDays: 30, name: '晨光王國', subtitle: '將看見變成穩定能力' },
  ];

  const GOAL_TYPES = [
    { id: 'emergency', name: '應急護甲', art: 'shield', prompt: '為突發事件建立安全空間' },
    { id: 'dream', name: '願望寶箱', art: 'chest-closed', prompt: '為一件真正重視的事慢慢準備' },
    { id: 'freedom', name: '自由基金', art: 'coin', prompt: '為未來選擇保留更多自由' },
  ];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function chapterFor(totalDays) {
    const days = Math.max(0, Math.floor(Number(totalDays) || 0));
    let index = 0;
    CHAPTERS.forEach((chapter, chapterIndex) => {
      if (days >= chapter.minDays) index = chapterIndex;
    });
    const current = CHAPTERS[index];
    const next = CHAPTERS[index + 1] || null;
    const progressPct = next
      ? clamp(((days - current.minDays) / (next.minDays - current.minDays)) * 100, 0, 100)
      : 100;
    return {
      ...current,
      number: index + 1,
      next,
      progressPct,
      daysToNext: next ? Math.max(0, next.minDays - days) : 0,
    };
  }

  function weeklyQuestProgress(questOrId, stats) {
    const quest = typeof questOrId === 'string'
      ? WEEKLY_QUESTS.find((item) => item.id === questOrId)
      : questOrId;
    if (!quest) return 0;
    return clamp(Math.floor(Number((stats || {})[quest.metric]) || 0), 0, quest.target);
  }

  function routeModel(dayKeys, todayKey, activeKeys) {
    const active = new Set(activeKeys || []);
    return (dayKeys || []).map((dateKey, index) => {
      let status = 'future';
      if (active.has(dateKey)) status = 'cleared';
      else if (dateKey === todayKey) status = 'current';
      else if (dateKey < todayKey) status = 'rest';
      return { dateKey, index, status };
    });
  }

  function expeditionComplete(claimedIds) {
    const claimed = new Set(claimedIds || []);
    return WEEKLY_QUESTS.every((quest) => claimed.has(quest.id));
  }

  function expeditionTargetDays(remainingDays) {
    return clamp(Math.floor(Number(remainingDays) || 0), 1, 3);
  }

  function goalSaved(goal, contributions) {
    if (!goal) return 0;
    const initial = Math.max(0, Number(goal.initialAmount) || 0);
    const added = (contributions || []).reduce((sum, entry) => (
      entry.goalId === goal.id ? sum + Math.max(0, Number(entry.amount) || 0) : sum
    ), 0);
    return Math.round((initial + added + Number.EPSILON) * 100) / 100;
  }

  function goalProgress(goal, contributions) {
    const target = Math.max(0, Number(goal && goal.target) || 0);
    const saved = goalSaved(goal, contributions);
    const remaining = Math.max(0, target - saved);
    return {
      saved,
      target,
      remaining,
      complete: target > 0 && saved >= target,
      progressPct: target > 0 ? clamp((saved / target) * 100, 0, 100) : 0,
      milestones: [25, 50, 75, 100].map((percent) => ({ percent, reached: target > 0 && saved >= target * (percent / 100) })),
    };
  }

  function dayOrdinal(dateKey) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
  }

  function goalPace(goal, contributions, todayKey) {
    const progress = goalProgress(goal, contributions);
    const today = dayOrdinal(todayKey);
    const deadline = dayOrdinal(goal && goal.deadline);
    if (progress.complete || today == null || deadline == null) {
      return { ...progress, daysLeft: null, weeklySuggested: 0 };
    }
    const daysLeft = Math.max(0, deadline - today + 1);
    const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
    return {
      ...progress,
      daysLeft,
      weeklySuggested: Math.ceil(progress.remaining / weeksLeft),
    };
  }

  function monthlyCommitmentSchedule(commitments, expenses, skips, monthKey, todayKey) {
    const monthMatch = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number(monthMatch[1]) : 0;
    const month = monthMatch ? Number(monthMatch[2]) : 0;
    if (!monthMatch || month < 1 || month > 12) {
      return { monthKey, items: [], plannedTotal: 0, expectedTotal: 0, paidTotal: 0, outstanding: 0, dueSoonCount: 0, next: null };
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const skippedIds = new Set((skips || [])
      .filter((entry) => entry && entry.monthKey === monthKey)
      .map((entry) => entry.commitmentId));
    const activeCommitments = (commitments || []).filter((entry) => entry && entry.active !== false);
    const items = activeCommitments.map((commitment) => {
      const dueDay = clamp(Math.round(Number(commitment.dueDay) || 1), 1, lastDay);
      const dueDate = `${monthKey}-${String(dueDay).padStart(2, '0')}`;
      const matchingPayments = (expenses || []).filter((expense) => (
        expense && expense.commitmentId === commitment.id
        && (expense.commitmentMonth === monthKey || (!expense.commitmentMonth && String(expense.dateKey || '').startsWith(monthKey)))
      ));
      const paidAmount = Math.round((matchingPayments.reduce((sum, expense) => sum + Math.max(0, Number(expense.amount) || 0), 0) + Number.EPSILON) * 100) / 100;
      const today = dayOrdinal(todayKey);
      const due = dayOrdinal(dueDate);
      const daysUntil = today == null || due == null ? null : due - today;
      let status = 'upcoming';
      if (paidAmount > 0) status = 'paid';
      else if (skippedIds.has(commitment.id)) status = 'skipped';
      else if (daysUntil != null && daysUntil < 0) status = 'overdue';
      else if (daysUntil === 0) status = 'due';
      const remindDays = clamp(Math.round(Number(commitment.remindDays) || 0), 0, 30);
      return {
        ...commitment,
        amount: Math.max(0, Number(commitment.amount) || 0),
        dueDay,
        dueDate,
        daysUntil,
        paidAmount,
        status,
        dueSoon: status === 'due' || status === 'overdue' || (status === 'upcoming' && daysUntil != null && daysUntil <= remindDays),
      };
    });
    const statusOrder = { overdue: 0, due: 1, upcoming: 2, paid: 3, skipped: 4 };
    items.sort((a, b) => (statusOrder[a.status] - statusOrder[b.status]) || a.dueDay - b.dueDay || String(a.name || '').localeCompare(String(b.name || '')));
    const plannedTotal = items.reduce((sum, item) => sum + item.amount, 0);
    const expectedTotal = items.filter((item) => item.status !== 'skipped').reduce((sum, item) => sum + item.amount, 0);
    const paidTotal = items.reduce((sum, item) => sum + item.paidAmount, 0);
    const outstanding = items.filter((item) => !['paid', 'skipped'].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);
    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    return {
      monthKey,
      items,
      plannedTotal: roundMoney(plannedTotal),
      expectedTotal: roundMoney(expectedTotal),
      paidTotal: roundMoney(paidTotal),
      outstanding: roundMoney(outstanding),
      dueSoonCount: items.filter((item) => item.dueSoon).length,
      next: items.find((item) => !['paid', 'skipped'].includes(item.status)) || null,
    };
  }

  function installmentQuote(principal, annualRate, months) {
    const amount = Math.max(0, Number(principal) || 0);
    const term = Math.max(1, Math.round(Number(months) || 1));
    const monthlyRate = Math.max(0, Number(annualRate) || 0) / 1200;
    const payment = monthlyRate > 0
      ? amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -term))
      : amount / term;
    const monthlyPayment = Math.round((payment + Number.EPSILON) * 100) / 100;
    const totalCost = Math.round((monthlyPayment * term + Number.EPSILON) * 100) / 100;
    return {
      monthlyPayment,
      totalCost,
      financeCost: Math.max(0, Math.round(((totalCost - amount) + Number.EPSILON) * 100) / 100),
    };
  }

  function purchaseEncounter(input) {
    const source = ['daily', 'savings', 'credit'].includes(input && input.source) ? input.source : 'daily';
    const intent = ['need', 'joy', 'unsure'].includes(input && input.intent) ? input.intent : 'unsure';
    const amount = Math.max(0, Number(input && input.amount) || 0);
    const safeToday = Math.max(0, Number(input && input.safeToday) || 0);
    const savings = Math.max(0, Number(input && input.savings) || 0);
    const monthlyBudget = Math.max(1, Number(input && input.monthlyBudget) || 1);
    const income = Math.max(0, Number(input && input.income) || 0);
    const goalRemaining = Math.max(0, Number(input && input.goalRemaining) || 0);
    const goalWeeklySuggested = Math.max(0, Number(input && input.goalWeeklySuggested) || 0);
    const financed = source === 'credit' && input && input.repayment === 'installment';
    const quote = financed
      ? installmentQuote(amount, input.annualRate, input.installmentMonths)
      : { monthlyPayment: 0, totalCost: amount, financeCost: 0 };
    const dailyImpact = source === 'daily' || (source === 'credit' && !financed) ? amount : 0;
    const dailyAfter = safeToday - dailyImpact;
    const savingsAfter = source === 'savings' ? savings - amount : savings;
    const armorBefore = savings / monthlyBudget;
    const armorAfter = Math.max(0, savingsAfter) / monthlyBudget;
    const monthlyBurdenPct = financed && income > 0 ? quote.monthlyPayment / income * 100 : null;
    const goalEquivalentWeeks = goalWeeklySuggested > 0 ? amount / goalWeeklySuggested : null;
    const goalEquivalentPct = goalRemaining > 0 ? amount / goalRemaining * 100 : null;
    const hardFlags = [
      dailyAfter < 0,
      source === 'savings' && savingsAfter < 0,
      financed && Number(input.annualRate || 0) >= 25,
      financed && monthlyBurdenPct != null && monthlyBurdenPct > 10,
    ];
    const pauseFlags = [
      intent === 'unsure',
      dailyImpact > 0 && safeToday > 0 && dailyAfter < safeToday * 0.25,
      source === 'savings' && armorAfter < 1,
      financed,
    ];
    const signal = hardFlags.some(Boolean) ? 'arrange' : pauseFlags.some(Boolean) ? 'pause' : 'clear';
    return {
      amount, source, intent, financed, signal, safeToday, dailyImpact, dailyAfter,
      savings, savingsAfter, armorBefore, armorAfter, monthlyPayment: quote.monthlyPayment,
      totalCost: quote.totalCost, financeCost: quote.financeCost, monthlyBurdenPct,
      goalRemaining, goalEquivalentWeeks, goalEquivalentPct,
    };
  }

  return {
    WEEKLY_QUESTS, CHAPTERS, GOAL_TYPES, chapterFor, weeklyQuestProgress, routeModel,
    expeditionComplete, expeditionTargetDays, goalSaved, goalProgress, goalPace,
    monthlyCommitmentSchedule, installmentQuote, purchaseEncounter,
  };
});
