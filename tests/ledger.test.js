'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterEntries, summarizeEntries, monthKeys, cardBalanceAdjustments, toCsv } = require('../ledger.js');

const entries = [
  { dateKey: '2026-07-19', type: 'expense', typeLabel: '支出', name: '街市', category: '餐飲／超市', amount: 120 },
  { dateKey: '2026-07-18', type: 'income', typeLabel: '收入', name: 'Freelance', category: '收入', amount: 800 },
  { dateKey: '2026-06-30', type: 'transfer', typeLabel: '還款轉移', name: 'Visa 還款', category: '信用卡', amount: 300 },
  { dateKey: '2026-05-01', type: 'decision', typeLabel: '消費遭遇', name: '耳機', category: '買前推演', amount: 500 },
];

test('filters ledger entries by month, type and normalized search text', () => {
  assert.deepEqual(filterEntries(entries, { month: '2026-07', type: 'all' }).map((entry) => entry.name), ['街市', 'Freelance']);
  assert.deepEqual(filterEntries(entries, { month: 'all', type: 'transfer' }).map((entry) => entry.name), ['Visa 還款']);
  assert.deepEqual(filterEntries(entries, { month: 'all', type: 'all', query: 'FREELANCE' }).map((entry) => entry.name), ['Freelance']);
  assert.deepEqual(filterEntries(entries, { month: 'all', type: 'all', query: '120' }).map((entry) => entry.name), ['街市']);
});

test('summarizes only real income and spending in the net figure', () => {
  assert.deepEqual(summarizeEntries(entries), {
    count: 4,
    income: 800,
    spending: 120,
    transfers: 300,
    net: 680,
  });
});

test('lists available ledger months from newest to oldest', () => {
  assert.deepEqual(monthKeys(entries), ['2026-07', '2026-06', '2026-05']);
});

test('adjusts only the difference when correcting a purchase on the same card', () => {
  assert.deepEqual(
    cardBalanceAdjustments({ cardId: 'visa', amount: 100 }, { cardId: 'visa', amount: 125 }),
    [{ cardId: 'visa', delta: 25 }]
  );
});

test('moves the full corrected purchase between payment accounts', () => {
  assert.deepEqual(
    cardBalanceAdjustments({ cardId: 'visa', amount: 100 }, { cardId: 'master', amount: 80 }),
    [{ cardId: 'visa', delta: -100 }, { cardId: 'master', delta: 80 }]
  );
  assert.deepEqual(
    cardBalanceAdjustments({ cardId: null, amount: 100 }, { cardId: 'visa', amount: 100 }),
    [{ cardId: 'visa', delta: 100 }]
  );
});

test('exports a BOM CSV and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([{
    dateKey: '2026-07-19', timeLabel: '18:30', typeLabel: '支出',
    name: '=HYPERLINK("bad")', category: '餐飲,超市', budgetLabel: '日常安心額',
    amount: 120, cashflowEffect: -120, account: '', status: '@danger',
  }]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"餐飲,超市"/);
  assert.match(csv, /,120,-120,/);
  assert.match(csv, /"'@danger"/);
});
