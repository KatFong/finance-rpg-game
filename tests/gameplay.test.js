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
