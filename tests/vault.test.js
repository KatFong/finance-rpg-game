const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackup, parseBackup, checksum, summary } = require('../vault.js');

const sampleState = () => ({
  onboarded: true,
  heroName: 'Kat',
  monthlyBudget: 8000,
  expenses: [{ id: 1, amount: 50 }],
  incomes: [{ id: 'income-1', amount: 20000 }],
  creditCards: [{ id: 'card-1', name: 'Visa' }],
  installments: [],
  goals: [{ id: 'goal-1', name: '旅行' }],
  decisionEncounters: [{ id: 'decision-1', status: 'waiting' }],
});

test('round-trips a versioned finance RPG backup', () => {
  const backup = createBackup(sampleState(), '2026-07-19T00:00:00.000Z');
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.state.heroName, 'Kat');
  assert.equal(restored.exportedAt, '2026-07-19T00:00:00.000Z');
  assert.equal(restored.summary.expenses, 1);
});

test('rejects a backup that was changed after export', () => {
  const backup = createBackup(sampleState());
  backup.state.monthlyBudget = 999999;
  assert.throws(() => parseBackup(backup), /完整性/);
});

test('rejects another app and a future backup version', () => {
  const wrongApp = createBackup(sampleState());
  wrongApp.app = 'another-app';
  assert.throws(() => parseBackup(wrongApp), /唔屬於/);
  const future = createBackup(sampleState());
  future.version = 99;
  assert.throws(() => parseBackup(future), /版本/);
});

test('sanitizes markup-like strings before checksumming', () => {
  const backup = createBackup({ heroName: '<b>Kat</b>', expenses: [] });
  assert.equal(backup.state.heroName, 'bKat/b');
  assert.equal(backup.checksum, checksum(backup.state));
});

test('summarizes the records a player needs to recognize', () => {
  assert.deepEqual(summary(sampleState()), {
    heroName: 'Kat', expenses: 1, incomeEntries: 1, cards: 1,
    installments: 0, goals: 1, decisions: 1,
  });
});
