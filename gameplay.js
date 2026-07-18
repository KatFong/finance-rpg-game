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

  return {
    WEEKLY_QUESTS, CHAPTERS, GOAL_TYPES, chapterFor, weeklyQuestProgress, routeModel,
    expeditionComplete, expeditionTargetDays, goalSaved, goalProgress, goalPace,
  };
});
