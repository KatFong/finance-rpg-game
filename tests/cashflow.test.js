'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reconcileBalance,
  normalizeObligations,
  forecastCashflow,
} = require('../cashflow.js');

const plan = {
  balance: 3000,
  asOfDate: '2026-07-19',
  capturedAt: 100,
  nextIncomeDate: '2026-07-29',
  nextIncomeAmount: 10000,
  buffer: 500,
};

test('reconciles only liquid movements after the cash snapshot', () => {
  const result = reconcileBalance({
    incomes: [{ id: 'income', dateKey: '2026-07-20', amount: 500 }],
    expenses: [
      { id: 'cash', dateKey: '2026-07-20', amount: 100 },
      { id: 'card', dateKey: '2026-07-20', amount: 900, cardId: 'visa' },
      { id: 'old', dateKey: '2026-07-18', amount: 800 },
    ],
    cardPayments: [{ id: 'card-pay', dateKey: '2026-07-21', amount: 300 }],
    repayments: [{ id: 'debt-pay', dateKey: '2026-07-22', amount: 200 }],
    goalContributions: [
      { id: 'new-save', dateKey: '2026-07-23', amount: 100, source: 'new_saving' },
      { id: 'allocated', dateKey: '2026-07-23', amount: 700, source: 'allocated' },
    ],
  }, plan, '2026-07-24');
  assert.equal(result.delta, -200);
  assert.equal(result.current, 2800);
  assert.equal(result.movements.length, 5);
});

test('uses capture time for same-day movements without replaying the opening balance', () => {
  const result = reconcileBalance({
    expenses: [
      { id: 'before', dateKey: '2026-07-19', ts: 99, amount: 200 },
      { id: 'after', dateKey: '2026-07-19', ts: 101, amount: 80 },
    ],
  }, plan, '2026-07-19');
  assert.equal(result.current, 2920);
  assert.deepEqual(result.movements.map((entry) => entry.id), ['after']);
});

test('deduplicates obligations and moves overdue items to today', () => {
  const obligations = normalizeObligations([
    { id: 'rent', kind: 'commitment', name: '屋租', amount: 1000, dueDate: '2026-07-18' },
    { id: 'rent', kind: 'commitment', name: '屋租', amount: 1000, dueDate: '2026-07-18' },
    { id: 'later', kind: 'card', name: '卡數', amount: 500, dueDate: '2026-08-01' },
  ], '2026-07-19', '2026-07-29');
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].effectiveDate, '2026-07-19');
  assert.equal(obligations[0].overdue, true);
});

test('projects the lower daily pace after obligations and a protected floor', () => {
  const result = forecastCashflow({
    plan,
    state: {},
    todayKey: '2026-07-19',
    dailyBaseline: 300,
    obligations: [
      { id: 'rent', kind: 'commitment', name: '屋租', amount: 1000, dueDate: '2026-07-20' },
      { id: 'card', kind: 'card', name: 'Visa', amount: 500, dueDate: '2026-07-25' },
    ],
  });
  assert.equal(result.beforeIncome, 1500);
  assert.equal(result.runwayDaily, 100);
  assert.equal(result.dailyPace, 100);
  assert.equal(result.status, 'tight');
  assert.equal(result.afterIncome, 11500);
});

test('surfaces a real cash gap before the next income', () => {
  const result = forecastCashflow({
    plan: { ...plan, balance: 1200, buffer: 500 },
    state: {},
    todayKey: '2026-07-19',
    dailyBaseline: 300,
    obligations: [{ id: 'rent', amount: 1000, dueDate: '2026-07-20' }],
  });
  assert.equal(result.status, 'gap');
  assert.equal(result.gapAmount, 300);
  assert.equal(result.dailyPace, 0);
});

test('accepts an overdrawn opening balance instead of hiding the shortfall', () => {
  const result = forecastCashflow({
    plan: { ...plan, balance: -200, buffer: 500 },
    state: {},
    todayKey: '2026-07-19',
    dailyBaseline: 300,
    obligations: [],
  });
  assert.equal(result.status, 'gap');
  assert.equal(result.beforeIncome, -200);
  assert.equal(result.gapAmount, 700);
});

test('requires a refresh after the expected income date has passed', () => {
  const result = forecastCashflow({ plan, state: {}, todayKey: '2026-07-30' });
  assert.equal(result.status, 'stale');
});

test('stops forecasting when actual income arrives on the expected day', () => {
  const result = forecastCashflow({
    plan: { ...plan, nextIncomeDate: '2026-07-19' },
    state: { incomes: [{ id: 'salary', dateKey: '2026-07-19', ts: 101, amount: 10000 }] },
    todayKey: '2026-07-19',
    obligations: [{ id: 'rent', amount: 1000, dueDate: '2026-07-19' }],
  });
  assert.equal(result.status, 'arrived');
  assert.equal(result.reconciled.current, 13000);
  assert.equal('afterIncome' in result, false);
});
