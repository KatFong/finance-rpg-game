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

  const MONTHLY_FOCUS_OPTIONS = [
    { id: 'cashflow', name: '守住現金底線', desc: '先確保下次收入前，錢袋唔會跌穿自己設定嘅底線。' },
    { id: 'commitments', name: '預留固定承諾', desc: '收入到手先留起帳單同分期，日常額度先會真正安心。' },
    { id: 'cards', name: '降低卡片成本', desc: '先避免新增循環結欠，並核對實際利息、收費同退款。' },
    { id: 'goal', name: '推進一個願望', desc: '只揀一個重要目標，用可以持續嘅小額慢慢推進。' },
  ];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

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

  function creditStatementModel(card) {
    const currentBalance = Math.max(0, Number(card && card.currentBalance) || 0);
    const statementKnown = card && card.statementBalance != null && Number.isFinite(Number(card.statementBalance));
    const statementDue = statementKnown
      ? Math.min(currentBalance, Math.max(0, Number(card.statementBalance) || 0))
      : currentBalance;
    const minimumKnown = statementKnown && card.minimumPayment != null && Number.isFinite(Number(card.minimumPayment));
    const minimumDue = minimumKnown
      ? Math.min(statementDue, Math.max(0, Number(card.minimumPayment) || 0))
      : null;
    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    return {
      currentBalance: roundMoney(currentBalance),
      statementKnown,
      statementDue: roundMoney(statementDue),
      minimumKnown,
      minimumDue: minimumDue == null ? null : roundMoney(minimumDue),
      postStatementSpend: roundMoney(Math.max(0, currentBalance - statementDue)),
    };
  }

  function applyCreditCardPayment(card, requestedAmount) {
    const model = creditStatementModel(card);
    const payment = Math.min(model.currentBalance, Math.max(0, Number(requestedAmount) || 0));
    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    const statementApplied = model.statementKnown ? Math.min(payment, model.statementDue) : 0;
    const minimumApplied = model.minimumKnown ? Math.min(payment, model.minimumDue) : 0;
    return {
      payment: roundMoney(payment),
      currentBalance: roundMoney(Math.max(0, model.currentBalance - payment)),
      statementBalance: model.statementKnown ? roundMoney(Math.max(0, model.statementDue - payment)) : null,
      minimumPayment: model.minimumKnown ? roundMoney(Math.max(0, model.minimumDue - payment)) : null,
      statementApplied: roundMoney(statementApplied),
      minimumApplied: roundMoney(minimumApplied),
    };
  }

  function reverseCreditCardPayment(card, payment) {
    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    const currentBalance = roundMoney(Math.max(0, Number(card && card.currentBalance) || 0) + Math.max(0, Number(payment && payment.amount) || 0));
    const statementTracked = card && card.statementBalance != null
      && payment && Object.prototype.hasOwnProperty.call(payment, 'statementApplied');
    const statementBalance = statementTracked
      ? Math.min(currentBalance, roundMoney(Math.max(0, Number(card.statementBalance) || 0) + Math.max(0, Number(payment.statementApplied) || 0)))
      : card && card.statementBalance != null ? roundMoney(Math.max(0, Number(card.statementBalance) || 0)) : null;
    const minimumTracked = statementTracked && card.minimumPayment != null
      && Object.prototype.hasOwnProperty.call(payment, 'minimumApplied');
    const minimumPayment = minimumTracked
      ? Math.min(statementBalance, roundMoney(Math.max(0, Number(card.minimumPayment) || 0) + Math.max(0, Number(payment.minimumApplied) || 0)))
      : card && card.minimumPayment != null ? roundMoney(Math.max(0, Number(card.minimumPayment) || 0)) : null;
    return { currentBalance, statementBalance, minimumPayment };
  }

  function applyCreditCardAdjustment(card, input) {
    const settings = input || {};
    const type = ['interest', 'fee', 'refund'].includes(settings.type) ? settings.type : null;
    const amount = roundMoney(Math.max(0, Number(settings.amount) || 0));
    if (!type || !(amount > 0)) throw new Error('卡片事件種類同金額無效');
    const model = creditStatementModel(card);
    const appliesToBalance = settings.balanceMode === 'apply';
    const appliesToStatement = appliesToBalance && settings.statementMode === 'statement';
    if (appliesToStatement && !model.statementKnown) throw new Error('今期帳單資料未完整');
    if (type === 'refund' && appliesToBalance && amount > model.currentBalance) throw new Error('退款高過目前結欠');
    const postStatementBalance = model.statementKnown
      ? roundMoney(Math.max(0, model.currentBalance - model.statementDue))
      : model.currentBalance;
    if (type === 'refund' && appliesToBalance && !appliesToStatement && amount > postStatementBalance) {
      throw new Error('退款高過截數後結欠，請改選今期帳單');
    }
    const direction = type === 'refund' ? -1 : 1;
    const balanceApplied = appliesToBalance ? roundMoney(direction * amount) : 0;
    const statementApplied = appliesToStatement
      ? (direction > 0 ? amount : roundMoney(-Math.min(amount, model.statementDue)))
      : 0;
    const currentBalance = roundMoney(Math.max(0, model.currentBalance + balanceApplied));
    const statementBalance = model.statementKnown
      ? roundMoney(Math.max(0, model.statementDue + statementApplied))
      : null;
    const minimumInvalidated = statementApplied !== 0 && card && card.minimumPayment != null;
    return {
      currentBalance,
      statementBalance,
      minimumPayment: minimumInvalidated ? null : (card && card.minimumPayment != null ? roundMoney(card.minimumPayment) : null),
      balanceApplied,
      statementApplied,
      minimumInvalidated,
      minimumBefore: card && card.minimumPayment != null ? roundMoney(card.minimumPayment) : null,
    };
  }

  function reverseCreditCardAdjustment(card, adjustment) {
    const balanceApplied = roundMoney(Number(adjustment && adjustment.balanceApplied) || 0);
    const statementApplied = roundMoney(Number(adjustment && adjustment.statementApplied) || 0);
    const currentBalance = roundMoney(Math.max(0, Number(card && card.currentBalance || 0) - balanceApplied));
    const statementKnown = card && card.statementBalance != null && Number.isFinite(Number(card.statementBalance));
    const statementBalance = statementKnown
      ? roundMoney(Math.min(currentBalance, Math.max(0, Number(card.statementBalance || 0) - statementApplied)))
      : null;
    const shouldRestoreMinimum = Boolean(adjustment && adjustment.minimumInvalidated)
      && card && card.minimumPayment == null
      && adjustment.minimumBefore != null;
    return {
      currentBalance,
      statementBalance,
      minimumPayment: shouldRestoreMinimum
        ? roundMoney(Math.min(statementBalance == null ? currentBalance : statementBalance, Math.max(0, Number(adjustment.minimumBefore) || 0)))
        : (card && card.minimumPayment != null ? roundMoney(card.minimumPayment) : null),
    };
  }

  function monthlyReviewModel(input) {
    const data = input || {};
    const monthKey = /^\d{4}-\d{2}$/.test(String(data.monthKey || '')) ? String(data.monthKey) : '';
    const inMonth = (entry) => monthKey && String(entry && entry.dateKey || '').startsWith(monthKey);
    const expenses = (data.expenses || []).filter(inMonth);
    const incomes = (data.incomes || []).filter(inMonth);
    const cardAdjustments = (data.cardAdjustments || []).filter(inMonth);
    const goalContributions = (data.goalContributions || []).filter(inMonth);
    const reserveAllocations = (data.reserveAllocations || []).filter(inMonth);
    const cardPayments = (data.cardPayments || []).filter(inMonth);
    const debtPayments = (data.debtPayments || []).filter(inMonth);
    const activityDateKeys = (data.activityDateKeys || []).filter((dateKey) => monthKey && String(dateKey || '').startsWith(monthKey));
    const dailySpent = roundMoney(expenses
      .filter((entry) => entry.budgetImpact !== 'committed')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0));
    const committedSpent = roundMoney(expenses
      .filter((entry) => entry.budgetImpact === 'committed')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0));
    const cardCosts = roundMoney(cardAdjustments.reduce((sum, entry) => (
      sum + (entry.type === 'refund' ? -Math.max(0, Number(entry.amount) || 0) : Math.max(0, Number(entry.amount) || 0))
    ), 0));
    const income = roundMoney(incomes.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0));
    const totalSpent = roundMoney(dailySpent + committedSpent + cardCosts);
    const net = roundMoney(income - totalSpent);
    const goalSaved = roundMoney(goalContributions.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0));
    const reserveSaved = roundMoney(reserveAllocations.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0));
    const transfers = roundMoney(
      cardPayments.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0)
      + debtPayments.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0),
    );
    const categories = {};
    expenses.forEach((entry) => {
      const category = String(entry.category || 'other');
      categories[category] = roundMoney((categories[category] || 0) + Math.max(0, Number(entry.amount) || 0));
    });
    if (cardCosts !== 0) categories.card_costs = roundMoney((categories.card_costs || 0) + cardCosts);
    const topCategoryEntry = Object.entries(categories)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])[0] || null;
    const activeDays = new Set([
      ...expenses, ...incomes, ...cardAdjustments, ...goalContributions, ...reserveAllocations, ...cardPayments, ...debtPayments,
    ].map((entry) => entry.dateKey).filter(Boolean).concat(activityDateKeys)).size;
    let recommendedFocus = 'goal';
    if (net < 0 || (income === 0 && totalSpent > 0)) recommendedFocus = 'cashflow';
    else if (cardCosts > 0) recommendedFocus = 'cards';
    else if (committedSpent > dailySpent && committedSpent > 0) recommendedFocus = 'commitments';
    return {
      monthKey,
      income,
      dailySpent,
      committedSpent,
      cardCosts,
      totalSpent,
      net,
      goalSaved,
      reserveSaved,
      transfers,
      activeDays,
      recordCount: expenses.length + incomes.length + cardAdjustments.length + goalContributions.length + reserveAllocations.length + cardPayments.length + debtPayments.length,
      topCategory: topCategoryEntry ? topCategoryEntry[0] : null,
      topCategoryAmount: topCategoryEntry ? topCategoryEntry[1] : 0,
      recommendedFocus,
      isEmpty: activeDays === 0,
    };
  }

  function plannedExpenseProgress(plan, allocations, todayKey) {
    const target = roundMoney(Math.max(0, Number(plan && plan.target) || 0));
    const openingReserved = roundMoney(Math.max(0, Number(plan && plan.initialReserved) || 0));
    const added = roundMoney((allocations || []).reduce((sum, entry) => (
      entry && plan && entry.planId === plan.id ? sum + Math.max(0, Number(entry.amount) || 0) : sum
    ), 0));
    const reserved = roundMoney(openingReserved + added);
    const remaining = roundMoney(Math.max(0, target - reserved));
    const today = dayOrdinal(todayKey);
    const due = dayOrdinal(plan && plan.dueDate);
    const daysLeft = today == null || due == null ? null : due - today;
    const periodsLeft = daysLeft == null ? null : Math.max(1, Math.ceil((Math.max(0, daysLeft) + 1) / 30));
    const monthlySuggested = remaining > 0 && periodsLeft
      ? Math.ceil((remaining / periodsLeft) * 100) / 100
      : 0;
    let status = 'building';
    if (plan && plan.paidAt) status = 'paid';
    else if (!(target > 0) || due == null) status = 'invalid';
    else if (remaining === 0) status = 'ready';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 30) status = 'due_soon';
    return {
      target,
      openingReserved,
      added,
      reserved,
      remaining,
      progressPct: target > 0 ? clamp((reserved / target) * 100, 0, 100) : 0,
      daysLeft,
      periodsLeft,
      monthlySuggested: roundMoney(monthlySuggested),
      status,
      valid: target > 0 && due != null,
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
    WEEKLY_QUESTS, CHAPTERS, GOAL_TYPES, MONTHLY_FOCUS_OPTIONS, chapterFor, weeklyQuestProgress, routeModel,
    expeditionComplete, expeditionTargetDays, goalSaved, goalProgress, goalPace,
    monthlyCommitmentSchedule, creditStatementModel, applyCreditCardPayment, reverseCreditCardPayment,
    applyCreditCardAdjustment, reverseCreditCardAdjustment,
    monthlyReviewModel,
    plannedExpenseProgress,
    installmentQuote, purchaseEncounter,
  };
});
