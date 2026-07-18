(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FinanceCashflow = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

  function dayOrdinal(dateKey) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime() / 86400000;
  }

  function dateKeyFromTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return null;
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function entryDate(entry) {
    return dayOrdinal(entry && entry.dateKey) == null ? dateKeyFromTimestamp(entry && (entry.ts || entry.paidAt)) : entry.dateKey;
  }

  function afterSnapshot(entry, plan, todayKey) {
    const dateKey = entryDate(entry);
    if (dayOrdinal(dateKey) == null) return false;
    if (dateKey > plan.asOfDate) return true;
    if (dateKey < plan.asOfDate || plan.asOfDate !== todayKey) return false;
    return Number(entry && (entry.ts || entry.paidAt) || 0) > Number(plan.capturedAt || 0);
  }

  function cashMovements(state, plan, todayKey) {
    const movements = [];
    const add = (entry, amount, kind, name) => {
      if (!afterSnapshot(entry, plan, todayKey) || !amount) return;
      movements.push({
        id: String(entry.id || `${kind}-${entry.ts || entry.dateKey || movements.length}`),
        kind,
        name,
        dateKey: entryDate(entry),
        amount: roundMoney(amount),
      });
    };

    (state.incomes || []).forEach((entry) => add(entry, Math.max(0, Number(entry.amount) || 0), 'income', entry.source || '收入'));
    (state.expenses || []).forEach((entry) => {
      if (entry.cardId) return;
      add(entry, -Math.max(0, Number(entry.amount) || 0), 'expense', entry.merchant || '銀行／現金支出');
    });
    (state.cardPayments || []).forEach((entry) => add(entry, -Math.max(0, Number(entry.amount) || 0), 'card-payment', '信用卡還款'));
    (state.repayments || []).forEach((entry) => add(entry, -Math.max(0, Number(entry.amount) || 0), 'debt-payment', '債務還款'));
    (state.goalContributions || []).forEach((entry) => {
      if (entry.source !== 'new_saving') return;
      add(entry, -Math.max(0, Number(entry.amount) || 0), 'saving', '願望儲蓄');
    });
    return movements.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }

  function reconcileBalance(state, plan, todayKey) {
    if (!plan || dayOrdinal(plan.asOfDate) == null || dayOrdinal(todayKey) == null || plan.asOfDate > todayKey || !Number.isFinite(Number(plan.balance))) {
      return null;
    }
    const movements = cashMovements(state || {}, plan, todayKey);
    const delta = roundMoney(movements.reduce((sum, entry) => sum + entry.amount, 0));
    return {
      base: roundMoney(plan.balance),
      delta,
      current: roundMoney(Number(plan.balance) + delta),
      movements,
    };
  }

  function normalizeObligations(obligations, todayKey, nextIncomeDate) {
    const unique = new Map();
    (obligations || []).forEach((entry, index) => {
      const amount = roundMoney(Math.max(0, Number(entry && entry.amount) || 0));
      const dueDate = entry && entry.dueDate;
      if (!(amount > 0) || dayOrdinal(dueDate) == null || dueDate > nextIncomeDate) return;
      const effectiveDate = dueDate < todayKey ? todayKey : dueDate;
      const id = String(entry.id || `${entry.kind || 'obligation'}-${dueDate}-${index}`);
      const key = `${entry.kind || 'obligation'}:${id}:${dueDate}`;
      if (unique.has(key)) return;
      unique.set(key, {
        id,
        kind: entry.kind || 'obligation',
        name: String(entry.name || '待處理承諾'),
        amount,
        dueDate,
        effectiveDate,
        overdue: dueDate < todayKey,
      });
    });
    return [...unique.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.name.localeCompare(b.name));
  }

  function forecastCashflow(input) {
    const options = input || {};
    const plan = options.plan;
    const todayKey = options.todayKey;
    const today = dayOrdinal(todayKey);
    if (!plan || today == null) return { status: 'missing' };
    const reconciled = reconcileBalance(options.state || {}, plan, todayKey);
    const incomeDay = dayOrdinal(plan.nextIncomeDate);
    const incomeAmount = roundMoney(Math.max(0, Number(plan.nextIncomeAmount) || 0));
    const buffer = roundMoney(Math.max(0, Number(plan.buffer) || 0));
    if (!reconciled || incomeDay == null || !(incomeAmount > 0)) return { status: 'invalid' };
    if (incomeDay < today) return { status: 'stale', reconciled, buffer };
    const incomeArrived = incomeDay === today && reconciled.movements.some((entry) => entry.kind === 'income' && entry.dateKey === plan.nextIncomeDate);
    if (incomeArrived) {
      return {
        status: 'arrived',
        reconciled,
        buffer,
        nextIncomeDate: plan.nextIncomeDate,
        nextIncomeAmount: incomeAmount,
      };
    }

    const obligations = normalizeObligations(options.obligations, todayKey, plan.nextIncomeDate);
    const obligationTotal = roundMoney(obligations.reduce((sum, entry) => sum + entry.amount, 0));
    const beforeIncome = roundMoney(reconciled.current - obligationTotal);
    const spendableBeforeIncome = roundMoney(beforeIncome - buffer);
    const daysToIncome = Math.max(0, incomeDay - today);
    const runwayDaily = roundMoney(Math.max(0, spendableBeforeIncome) / Math.max(1, daysToIncome));
    const dailyBaseline = roundMoney(Math.max(0, Number(options.dailyBaseline) || 0));
    const dailyPace = dailyBaseline > 0 ? Math.min(dailyBaseline, runwayDaily) : runwayDaily;
    const gapAmount = roundMoney(Math.max(0, buffer - beforeIncome));
    let status = 'steady';
    if (gapAmount > 0) status = 'gap';
    else if (dailyBaseline > 0 && runwayDaily < dailyBaseline * 0.75) status = 'tight';

    return {
      status,
      reconciled,
      buffer,
      obligations,
      obligationTotal,
      beforeIncome,
      spendableBeforeIncome,
      daysToIncome,
      runwayDaily,
      dailyBaseline,
      dailyPace,
      gapAmount,
      nextIncomeDate: plan.nextIncomeDate,
      nextIncomeAmount: incomeAmount,
      afterIncome: roundMoney(beforeIncome + incomeAmount),
    };
  }

  return {
    dayOrdinal,
    cashMovements,
    reconcileBalance,
    normalizeObligations,
    forecastCashflow,
  };
});
