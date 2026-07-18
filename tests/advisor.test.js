'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInstallmentSchedule,
  localAdvisorTurn,
  monthReserved,
} = require('../advisor.js');

const context = {
  today: '2026-07-18',
  cards: [{ id: 'card-hs', name: '恒生卡', last4: '1234' }],
};

test('builds an exact zero-interest schedule', () => {
  const result = buildInstallmentSchedule({
    principal: 1200,
    termMonths: 12,
    annualRate: 0,
    firstDueDate: '2026-08-15',
  });
  assert.equal(result.schedule.length, 12);
  assert.equal(result.monthlyPayment, 100);
  assert.equal(result.totalCost, 1200);
  assert.equal(result.totalInterest, 0);
  assert.equal(result.schedule.at(-1).dueDate, '2027-07-15');
});

test('amortizes APR while preserving principal', () => {
  const result = buildInstallmentSchedule({
    principal: 1000,
    termMonths: 12,
    annualRate: 12,
    firstDueDate: '2026-08-31',
  });
  const principal = result.schedule.reduce((sum, payment) => sum + payment.principal, 0);
  assert.ok(Math.abs(principal - 1000) <= 0.01);
  assert.ok(result.totalInterest > 0);
  assert.equal(result.schedule[1].dueDate, '2026-09-30');
});

test('uses a quoted payment and includes fees in financing cost', () => {
  const result = buildInstallmentSchedule({
    principal: 1000,
    termMonths: 12,
    monthlyPayment: 110,
    monthlyFee: 5,
    firstDueDate: '2026-08-01',
  });
  assert.equal(result.totalCost, 1320);
  assert.equal(result.totalInterest, 320);
  assert.equal(result.schedule[0].fee, 5);
});

test('reserves only unpaid installments in the selected month', () => {
  const state = {
    installments: [{ schedule: [
      { dueDate: '2026-07-01', amount: 80, status: 'paid' },
      { dueDate: '2026-07-21', amount: 120, status: 'planned' },
      { dueDate: '2026-08-21', amount: 120, status: 'planned' },
    ] }],
  };
  assert.equal(monthReserved(state, '2026-07'), 120);
});

test('turns a complete Cantonese installment message into a draft', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '恒生卡買電腦 $6000，分 12 期，APR 4.5%，第一期 2026-08-15' },
  ], context);
  assert.equal(result.status, 'draft');
  assert.equal(result.draft.kind, 'installment');
  assert.equal(result.draft.cardId, 'card-hs');
  assert.equal(result.draft.principal, 6000);
  assert.equal(result.draft.termMonths, 12);
  assert.equal(result.draft.firstDueDate, '2026-08-15');
  assert.equal(result.draft.title, '買電腦');
});

test('asks for missing installment financing and due date', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '恒生卡買電腦 $6000，分 12 期' },
  ], context);
  assert.equal(result.status, 'clarify');
  assert.ok(result.missingFields.includes('APR／每期金額／免息'));
  assert.ok(result.missingFields.includes('第一期還款日'));
});

test('classifies a card repayment separately from spending', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '幫我還恒生卡 $500' },
  ], context);
  assert.equal(result.status, 'draft');
  assert.equal(result.draft.kind, 'card_payment');
  assert.equal(result.draft.cardId, 'card-hs');
  assert.equal(result.draft.amount, 500);
});

test('recognizes a supermarket purchase as food and groceries', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '啱啱超市 $248' },
  ], context);
  assert.equal(result.status, 'draft');
  assert.equal(result.draft.kind, 'expense');
  assert.equal(result.draft.category, 'food');
  assert.equal(result.draft.amount, 248);
});

test('turns a salary message into an income draft', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '幫我記收入，今個月人工 $25000' },
  ], context);
  assert.equal(result.status, 'draft');
  assert.equal(result.draft.kind, 'income');
  assert.equal(result.draft.amount, 25000);
  assert.match(result.draft.merchant, /人工/);
});

test('answers a general investment question without creating a transaction', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '我有 $10000，ETF 投資之前要留意咩風險？' },
  ], context);
  assert.equal(result.status, 'answer');
  assert.equal(result.draft.kind, 'none');
  assert.match(result.reply, /目標|風險/);
});

test('requires an opening balance when creating a card', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '新增中銀卡，截數日 5，還款日 25，APR 35%' },
  ], { today: '2026-07-18', cards: [] });
  assert.equal(result.status, 'clarify');
  assert.ok(result.missingFields.some((field) => field.startsWith('現時結欠')));
});

test('creates a complete credit card draft when the spoken name contains spaces', () => {
  const result = localAdvisorTurn([
    { role: 'user', content: '新增恒生 Visa 卡，尾數 1234，額度 $20000，現時結欠 $3500，截數日 5，還款日 25，APR 35%' },
  ], { today: '2026-07-19', cards: [] });
  assert.equal(result.status, 'draft');
  assert.equal(result.draft.kind, 'credit_card');
  assert.equal(result.draft.cardName, '恒生Visa卡');
  assert.equal(result.draft.currentBalance, 3500);
  assert.equal(result.draft.dueDay, 25);
});
