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
