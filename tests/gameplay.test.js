'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WEEKLY_QUESTS,
  chapterFor,
  weeklyQuestProgress,
  routeModel,
  expeditionComplete,
  expeditionTargetDays,
  goalSaved,
  goalProgress,
  goalPace,
  monthlyCommitmentSchedule,
  creditStatementModel,
  applyCreditCardPayment,
  reverseCreditCardPayment,
  applyCreditCardAdjustment,
  reverseCreditCardAdjustment,
  monthlyReviewModel,
  plannedExpenseProgress,
  installmentQuote,
  purchaseEncounter,
} = require('../gameplay.js');

test('advances chapters without resetting cumulative days', () => {
  assert.equal(chapterFor(0).name, '霧中營地');
  assert.equal(chapterFor(3).name, '金流小徑');
  assert.equal(chapterFor(14).name, '選擇森林');
  assert.equal(chapterFor(14).daysToNext, 16);
  assert.equal(chapterFor(30).progressPct, 100);
});

test('bounds weekly quest progress at its target', () => {
  const quest = WEEKLY_QUESTS[0];
  assert.equal(weeklyQuestProgress(quest, { activeDays: 2 }), 2);
  assert.equal(weeklyQuestProgress(quest, { activeDays: 9 }), quest.target);
  assert.equal(weeklyQuestProgress('missing', { activeDays: 9 }), 0);
});

test('treats an unlogged past day as rest instead of failure', () => {
  const route = routeModel(
    ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'],
    '2026-07-15',
    ['2026-07-13']
  );
  assert.deepEqual(route.map((day) => day.status), ['cleared', 'rest', 'current', 'future']);
});

test('unlocks the expedition chest only after every weekly reward is claimed', () => {
  assert.equal(expeditionComplete(WEEKLY_QUESTS.slice(0, 2).map((quest) => quest.id)), false);
  assert.equal(expeditionComplete(WEEKLY_QUESTS.map((quest) => quest.id)), true);
});

test('reduces a late-week expedition target instead of creating an impossible quest', () => {
  assert.equal(expeditionTargetDays(7), 3);
  assert.equal(expeditionTargetDays(3), 3);
  assert.equal(expeditionTargetDays(2), 2);
  assert.equal(expeditionTargetDays(1), 1);
  assert.equal(expeditionTargetDays(0), 1);
});

test('builds goal progress from an opening allocation and matching contributions', () => {
  const goal = { id: 'goal-1', target: 1000, initialAmount: 200 };
  const contributions = [
    { goalId: 'goal-1', amount: 250 },
    { goalId: 'another-goal', amount: 900 },
  ];
  assert.equal(goalSaved(goal, contributions), 450);
  assert.equal(goalProgress(goal, contributions).remaining, 550);
  assert.equal(goalProgress(goal, contributions).milestones[0].reached, true);
});

test('caps a completed goal at one hundred percent without losing the real saved amount', () => {
  const progress = goalProgress(
    { id: 'goal-1', target: 500, initialAmount: 450 },
    [{ goalId: 'goal-1', amount: 100 }]
  );
  assert.equal(progress.saved, 550);
  assert.equal(progress.progressPct, 100);
  assert.equal(progress.complete, true);
});

test('suggests a neutral weekly pace when a goal has a deadline', () => {
  const pace = goalPace(
    { id: 'goal-1', target: 1000, initialAmount: 0, deadline: '2026-08-16' },
    [{ goalId: 'goal-1', amount: 200 }],
    '2026-07-19'
  );
  assert.equal(pace.daysLeft, 29);
  assert.equal(pace.weeklySuggested, 160);
});

test('clamps a monthly commitment to the real last day of the month', () => {
  const schedule = monthlyCommitmentSchedule(
    [{ id: 'rent', name: '屋租', amount: 9000, dueDay: 31, remindDays: 3, active: true }],
    [],
    [],
    '2026-02',
    '2026-02-27'
  );
  assert.equal(schedule.items[0].dueDate, '2026-02-28');
  assert.equal(schedule.items[0].daysUntil, 1);
  assert.equal(schedule.items[0].dueSoon, true);
  assert.equal(schedule.outstanding, 9000);
});

test('marks linked commitment payments without counting unrelated fixed expenses', () => {
  const schedule = monthlyCommitmentSchedule(
    [{ id: 'rent', name: '屋租', amount: 9000, dueDay: 1, active: true }],
    [
      { commitmentId: 'rent', commitmentMonth: '2026-07', dateKey: '2026-06-30', amount: 9000 },
      { commitmentId: null, dateKey: '2026-07-01', amount: 500 },
    ],
    [],
    '2026-07',
    '2026-07-19'
  );
  assert.equal(schedule.items[0].status, 'paid');
  assert.equal(schedule.paidTotal, 9000);
  assert.equal(schedule.outstanding, 0);
});

test('removes a skipped commitment from this month without archiving the rule', () => {
  const schedule = monthlyCommitmentSchedule(
    [
      { id: 'insurance', name: '保險', amount: 600, dueDay: 20, active: true },
      { id: 'old', name: '舊訂閱', amount: 80, dueDay: 2, active: false },
    ],
    [],
    [{ commitmentId: 'insurance', monthKey: '2026-07' }],
    '2026-07',
    '2026-07-19'
  );
  assert.equal(schedule.items.length, 1);
  assert.equal(schedule.items[0].status, 'skipped');
  assert.equal(schedule.plannedTotal, 600);
  assert.equal(schedule.expectedTotal, 0);
  assert.equal(schedule.next, null);
});

test('rejects an impossible commitment month without inventing due dates', () => {
  const schedule = monthlyCommitmentSchedule(
    [{ id: 'rent', name: '屋租', amount: 9000, dueDay: 1, active: true }],
    [],
    [],
    '2026-99',
    '2026-07-19'
  );
  assert.equal(schedule.items.length, 0);
  assert.equal(schedule.outstanding, 0);
  assert.equal(schedule.next, null);
});

test('separates a card statement from purchases made after cutoff', () => {
  assert.deepEqual(creditStatementModel({
    currentBalance: 1000,
    statementBalance: 600,
    minimumPayment: 100,
  }), {
    currentBalance: 1000,
    statementKnown: true,
    statementDue: 600,
    minimumKnown: true,
    minimumDue: 100,
    postStatementSpend: 400,
  });
});

test('applies card payments to the statement without erasing post-cutoff spend', () => {
  const card = { currentBalance: 1000, statementBalance: 600, minimumPayment: 100 };
  assert.deepEqual(applyCreditCardPayment(card, 100), {
    payment: 100,
    currentBalance: 900,
    statementBalance: 500,
    minimumPayment: 0,
    statementApplied: 100,
    minimumApplied: 100,
  });
  assert.equal(applyCreditCardPayment(card, 600).currentBalance, 400);
  assert.equal(applyCreditCardPayment(card, 600).statementBalance, 0);
});

test('keeps a legacy card statement unknown after a partial payment', () => {
  const result = applyCreditCardPayment({ currentBalance: 300 }, 100);
  assert.equal(result.currentBalance, 200);
  assert.equal(result.statementBalance, null);
  assert.equal(result.statementApplied, 0);
});

test('restores statement and minimum progress when a tracked payment is deleted', () => {
  const restored = reverseCreditCardPayment(
    { currentBalance: 900, statementBalance: 500, minimumPayment: 0 },
    { amount: 100, statementApplied: 100, minimumApplied: 100 }
  );
  assert.deepEqual(restored, {
    currentBalance: 1000,
    statementBalance: 600,
    minimumPayment: 100,
  });
  assert.deepEqual(reverseCreditCardPayment({ currentBalance: 200 }, { amount: 100 }), {
    currentBalance: 300,
    statementBalance: null,
    minimumPayment: null,
  });
});

test('applies an actual interest charge to current and statement balances', () => {
  const card = { currentBalance: 800, statementBalance: 600, minimumPayment: 80 };
  assert.deepEqual(applyCreditCardAdjustment(card, {
    type: 'interest', amount: 35.5, balanceMode: 'apply', statementMode: 'statement',
  }), {
    currentBalance: 835.5,
    statementBalance: 635.5,
    minimumPayment: null,
    balanceApplied: 35.5,
    statementApplied: 35.5,
    minimumInvalidated: true,
    minimumBefore: 80,
  });
});

test('records an already included fee without double counting card balances', () => {
  assert.deepEqual(applyCreditCardAdjustment(
    { currentBalance: 500, statementBalance: 400, minimumPayment: 50 },
    { type: 'fee', amount: 18, balanceMode: 'included', statementMode: 'statement' },
  ), {
    currentBalance: 500,
    statementBalance: 400,
    minimumPayment: 50,
    balanceApplied: 0,
    statementApplied: 0,
    minimumInvalidated: false,
    minimumBefore: 50,
  });
});

test('applies and reverses a refund without inventing a negative card balance', () => {
  const result = applyCreditCardAdjustment(
    { currentBalance: 300, statementBalance: 120, minimumPayment: 30 },
    { type: 'refund', amount: 180, balanceMode: 'apply', statementMode: 'statement' },
  );
  assert.equal(result.currentBalance, 120);
  assert.equal(result.statementBalance, 0);
  assert.equal(result.statementApplied, -120);
  assert.deepEqual(reverseCreditCardAdjustment({
    currentBalance: result.currentBalance,
    statementBalance: result.statementBalance,
    minimumPayment: result.minimumPayment,
  }, result), {
    currentBalance: 300,
    statementBalance: 120,
    minimumPayment: 30,
  });
  assert.throws(() => applyCreditCardAdjustment(
    { currentBalance: 50, statementBalance: 50 },
    { type: 'refund', amount: 80, balanceMode: 'apply', statementMode: 'statement' },
  ), /退款/);
});

test('does not let a post-statement refund silently rewrite the current statement', () => {
  assert.throws(() => applyCreditCardAdjustment(
    { currentBalance: 800, statementBalance: 600, minimumPayment: 80 },
    { type: 'refund', amount: 250, balanceMode: 'apply', statementMode: 'post' },
  ), /截數後結欠/);
  assert.deepEqual(applyCreditCardAdjustment(
    { currentBalance: 800, statementBalance: 600, minimumPayment: 80 },
    { type: 'refund', amount: 200, balanceMode: 'apply', statementMode: 'post' },
  ), {
    currentBalance: 600,
    statementBalance: 600,
    minimumPayment: 80,
    balanceApplied: -200,
    statementApplied: 0,
    minimumInvalidated: false,
    minimumBefore: 80,
  });
});

test('builds a monthly review without counting repayments as spending twice', () => {
  const result = monthlyReviewModel({
    monthKey: '2026-06',
    expenses: [
      { dateKey: '2026-06-02', amount: 300, budgetImpact: 'daily', category: 'food' },
      { dateKey: '2026-06-03', amount: 1200, budgetImpact: 'committed', category: 'bills' },
    ],
    incomes: [{ dateKey: '2026-06-01', amount: 5000 }],
    cardAdjustments: [
      { dateKey: '2026-06-04', type: 'interest', amount: 80 },
      { dateKey: '2026-06-05', type: 'refund', amount: 30 },
    ],
    cardPayments: [{ dateKey: '2026-06-06', amount: 900 }],
    debtPayments: [{ dateKey: '2026-06-07', amount: 400 }],
    goalContributions: [{ dateKey: '2026-06-08', amount: 500 }],
    reserveAllocations: [{ dateKey: '2026-06-09', amount: 300 }],
  });
  assert.equal(result.dailySpent, 300);
  assert.equal(result.committedSpent, 1200);
  assert.equal(result.cardCosts, 50);
  assert.equal(result.totalSpent, 1550);
  assert.equal(result.net, 3450);
  assert.equal(result.transfers, 1300);
  assert.equal(result.goalSaved, 500);
  assert.equal(result.reserveSaved, 300);
  assert.equal(result.activeDays, 9);
  assert.equal(result.topCategory, 'bills');
  assert.equal(result.recommendedFocus, 'cards');
});

test('recommends protecting cash flow when a reviewed month has a gap', () => {
  const result = monthlyReviewModel({
    monthKey: '2026-06',
    expenses: [{ dateKey: '2026-06-10', amount: 900, budgetImpact: 'daily', category: 'food' }],
    incomes: [{ dateKey: '2026-06-01', amount: 700 }],
  });
  assert.equal(result.net, -200);
  assert.equal(result.recommendedFocus, 'cashflow');
  assert.equal(result.recordCount, 2);
});

test('turns an irregular future bill into a calm monthly reserve pace', () => {
  const plan = { id: 'insurance', target: 12000, initialReserved: 2000, dueDate: '2026-12-31' };
  const result = plannedExpenseProgress(plan, [
    { planId: 'insurance', amount: 4000 },
    { planId: 'other', amount: 9999 },
  ], '2026-07-19');
  assert.equal(result.reserved, 6000);
  assert.equal(result.remaining, 6000);
  assert.equal(result.periodsLeft, 6);
  assert.equal(result.monthlySuggested, 1000);
  assert.equal(result.status, 'building');
  assert.equal(result.progressPct, 50);
});

test('keeps a missed reserve task visible without calling it a failure', () => {
  const result = plannedExpenseProgress(
    { id: 'repair', target: 5000, initialReserved: 1500, dueDate: '2026-06-30' },
    [],
    '2026-07-19',
  );
  assert.equal(result.status, 'overdue');
  assert.equal(result.daysLeft, -19);
  assert.equal(result.remaining, 3500);
  assert.equal(result.monthlySuggested, 3500);
});

test('marks a funded reserve ready and preserves paid history', () => {
  const plan = { id: 'tax', target: 3000, initialReserved: 1000, dueDate: '2026-08-01' };
  assert.equal(plannedExpenseProgress(plan, [{ planId: 'tax', amount: 2000 }], '2026-07-19').status, 'ready');
  assert.equal(plannedExpenseProgress({ ...plan, paidAt: 123 }, [], '2026-07-19').status, 'paid');
});

test('shows when a daily purchase needs a funding plan', () => {
  const result = purchaseEncounter({ amount: 700, source: 'daily', intent: 'joy', safeToday: 500, savings: 10000, monthlyBudget: 8000 });
  assert.equal(result.dailyAfter, -200);
  assert.equal(result.signal, 'arrange');
});

test('shows the armor change without treating savings as free money', () => {
  const result = purchaseEncounter({ amount: 3000, source: 'savings', intent: 'need', safeToday: 500, savings: 5000, monthlyBudget: 4000 });
  assert.equal(result.savingsAfter, 2000);
  assert.equal(result.armorAfter, 0.5);
  assert.equal(result.signal, 'pause');
});

test('quotes a zero-interest installment exactly', () => {
  assert.deepEqual(installmentQuote(1200, 0, 12), { monthlyPayment: 100, totalCost: 1200, financeCost: 0 });
});

test('surfaces high-interest financing cost and monthly burden', () => {
  const result = purchaseEncounter({
    amount: 12000, source: 'credit', repayment: 'installment', installmentMonths: 12,
    annualRate: 30, intent: 'joy', safeToday: 500, savings: 10000, monthlyBudget: 8000, income: 10000,
  });
  assert.ok(result.financeCost > 1900);
  assert.ok(result.monthlyBurdenPct > 11);
  assert.equal(result.signal, 'arrange');
});
