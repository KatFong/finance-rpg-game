(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FinanceAdvisor = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const CATEGORY_NAMES = {
    food: '餐飲／超市', transport: '交通', shopping: '購物',
    fun: '娛樂', bills: '帳單', other: '其他',
  };
  const INTENT_NAMES = { need: '生活必需', joy: '值得享受', impulse: '一時衝動' };
  const MAX_MESSAGES = 10;
  let bridge = null;
  let messages = [];
  let turnAnchor = 0;
  let activeDraft = null;
  let recognition = null;
  let listening = false;

  const $ = (id) => typeof document !== 'undefined' ? document.getElementById(id) : null;
  const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const fmt = (n) => '$' + roundMoney(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  function normalizeDateKey(value, fallback) {
    const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return fallback;
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return fallback;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function addMonths(dateKey, months) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const target = new Date(year, month - 1 + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  }

  function nextMonthlyDate(day, todayKey) {
    const dueDay = Number(day);
    if (!(dueDay >= 1 && dueDay <= 31)) return null;
    const [year, month] = todayKey.split('-').map(Number);
    const build = (offset) => {
      const base = new Date(year, month - 1 + offset, 1);
      const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(dueDay, last);
      return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    };
    const current = build(0);
    return current >= todayKey ? current : build(1);
  }

  function daysUntil(dateKey, todayKey) {
    const toUtc = (key) => {
      const [year, month, day] = key.split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.max(0, Math.round((toUtc(dateKey) - toUtc(todayKey)) / 86400000));
  }

  function shortDate(dateKey) {
    const [, month, day] = dateKey.split('-').map(Number);
    return `${month}月${day}日`;
  }

  function buildInstallmentSchedule(input) {
    const principal = roundMoney(input.principal);
    const termMonths = Math.max(1, Math.round(input.termMonths));
    const paidMonths = Math.max(0, Math.min(termMonths, Math.round(input.paidMonths || 0)));
    const apr = Math.max(0, Number(input.annualRate || 0));
    const monthlyFee = Math.max(0, roundMoney(input.monthlyFee || 0));
    const quotedPayment = Math.max(0, roundMoney(input.monthlyPayment || 0));
    const startDate = normalizeDateKey(input.firstDueDate, input.today || '2026-01-01');
    if (!(principal > 0) || !(termMonths > 0)) throw new Error('分期本金同總期數必須大過 0');

    const monthlyRate = apr / 100 / 12;
    const annuity = monthlyRate > 0
      ? principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths) / (Math.pow(1 + monthlyRate, termMonths) - 1)
      : principal / termMonths;
    const quotedInterest = quotedPayment > 0
      ? Math.max(0, quotedPayment * termMonths - principal - monthlyFee * termMonths)
      : 0;
    if (quotedPayment > 0 && quotedPayment * termMonths + 0.01 < principal + monthlyFee * termMonths) {
      throw new Error('每期金額乘期數低過本金，請軍師再確認數字');
    }

    let balance = principal;
    let allocatedQuotedInterest = 0;
    const schedule = [];
    for (let index = 0; index < termMonths; index++) {
      let interest;
      let principalPart;
      let amount;
      if (quotedPayment > 0) {
        interest = index === termMonths - 1
          ? quotedInterest - allocatedQuotedInterest
          : quotedInterest / termMonths;
        principalPart = index === termMonths - 1 ? balance : principal / termMonths;
        amount = quotedPayment;
      } else if (monthlyRate > 0) {
        interest = balance * monthlyRate;
        principalPart = index === termMonths - 1 ? balance : Math.min(balance, annuity - interest);
        amount = principalPart + interest + monthlyFee;
      } else {
        interest = 0;
        principalPart = index === termMonths - 1 ? balance : principal / termMonths;
        amount = principalPart + monthlyFee;
      }
      principalPart = roundMoney(principalPart);
      interest = roundMoney(interest);
      if (quotedPayment > 0) allocatedQuotedInterest = roundMoney(allocatedQuotedInterest + interest);
      amount = roundMoney(amount);
      balance = roundMoney(Math.max(0, balance - principalPart));
      schedule.push({
        index,
        dueDate: addMonths(startDate, index),
        principal: principalPart,
        interest,
        fee: monthlyFee,
        amount,
        status: index < paidMonths ? 'paid' : 'planned',
        paidAt: null,
      });
    }
    const totalCost = roundMoney(schedule.reduce((sum, item) => sum + item.amount, 0));
    const totalInterest = roundMoney(schedule.reduce((sum, item) => sum + item.interest + item.fee, 0));
    return { schedule, totalCost, totalInterest, monthlyPayment: schedule[0].amount };
  }

  function monthReserved(state, monthPrefix) {
    return roundMoney((state.installments || []).reduce((total, plan) => {
      const schedule = plan.schedule || [];
      return total + schedule.reduce((sum, payment) => (
        payment.status !== 'paid' && payment.dueDate.startsWith(monthPrefix) ? sum + payment.amount : sum
      ), 0);
    }, 0));
  }

  function monthCommitments(state, monthPrefix) {
    return roundMoney((state.installments || []).reduce((total, plan) => (
      total + (plan.schedule || []).reduce((sum, payment) => (
        payment.dueDate.startsWith(monthPrefix) ? sum + payment.amount : sum
      ), 0)
    ), 0));
  }

  function emptyResult(reply) {
    return {
      status: 'answer', reply: reply || '', question: '', missingFields: [], confidence: 0.5,
      draft: {
        kind: 'none', amount: null, category: null, date: null, merchant: null, budgetImpact: null,
        intent: null, cardId: null, cardName: null, last4: null, creditLimit: null,
        currentBalance: null, statementDay: null, dueDay: null, annualRate: null,
        title: null, principal: null, termMonths: null, paidMonths: null,
        monthlyPayment: null, monthlyFee: null, firstDueDate: null,
      },
    };
  }

  function detectCategory(text) {
    if (/食|餐|飯|早餐|午餐|晚餐|咖啡|茶|超市|街市|百佳|惠康|便利店|759|donki/i.test(text)) return 'food';
    if (/車|巴士|地鐵|港鐵|的士|交通|油費|泊車|八達通|uber/i.test(text)) return 'transport';
    if (/買|購物|衫|鞋|電器|電腦|手機|網購|淘寶|amazon/i.test(text)) return 'shopping';
    if (/戲|遊戲|娛樂|旅行|唱K|演唱會|netflix|spotify/i.test(text)) return 'fun';
    if (/帳單|水費|電費|煤氣|電話|上網|月費|供款|分期|屋租|租金|差餉|管理費|保險|學費|稅款/.test(text)) return 'bills';
    return 'other';
  }

  function detectBudgetImpact(text) {
    return /屋租|租金|差餉|管理費|保險|學費|交稅|稅款|供款|固定支出|固定開支|已預留|預留支出|一次性|用儲蓄|由存款/.test(text)
      ? 'committed'
      : 'daily';
  }

  function extractMoney(text) {
    const patterns = [
      /(?:HKD|HK\$|\$)\s*([\d,]+(?:\.\d+)?)/i,
      /([\d,]+(?:\.\d+)?)\s*(?:蚊|元|港幣)/,
      /(?:金額|本金|使咗|用咗|消費)\s*[:：]?\s*([\d,]+(?:\.\d+)?)/,
      /(?:收入|人工|薪金|出糧|佣金|花紅|獎金|退款|收咗|收到)\s*[:：]?\s*([\d,]+(?:\.\d+)?)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1].replace(/,/g, ''));
    }
    return null;
  }

  function extractCardName(text, cards) {
    const compactText = text.replace(/\s+/g, '');
    const existing = (cards || []).find((card) => compactText.includes(String(card.name || '').replace(/\s+/g, '')) || (card.last4 && compactText.includes(card.last4)));
    if (existing) return { cardId: existing.id, cardName: existing.name };
    const match = compactText.match(/([\u3400-\u9fffA-Za-z0-9]{1,16}(?:信用卡|卡))/u);
    if (!match) return { cardId: null, cardName: null };
    const cardName = match[1].replace(/^(?:(?:我想|幫我|新增|建立|開|一張|張))+/, '');
    return /^(?:信用卡|卡)$/.test(cardName)
      ? { cardId: null, cardName: null }
      : { cardId: null, cardName };
  }

  function localAdvisorTurn(chatMessages, context) {
    const userTexts = chatMessages.filter((message) => message.role === 'user').map((message) => message.content);
    const combined = userTexts.join('；');
    const last = userTexts[userTexts.length - 1] || '';
    const today = context.today;
    const cardRef = extractCardName(combined, context.cards || []);

    if (/分期|\d+\s*期/.test(combined)) {
      const result = emptyResult('');
      const principal = extractMoney(combined);
      const termMatch = combined.match(/(?:總共|總期數|分|共)\s*(\d+)\s*(?:期|個月)/)
        || combined.match(/(\d+)\s*(?:期|個月)/);
      const paidMatch = combined.match(/已(?:供|還|繳|付)\s*(\d+)\s*期/);
      const aprMatch = combined.match(/(?:APR|年利率|實際年利率)\s*[:：]?\s*([\d.]+)\s*%/i);
      const feeMatch = combined.match(/(?:每(?:月|期))?手續費\s*[:：]?\s*\$?([\d,.]+)/);
      const paymentMatch = combined.match(/每(?:月|期)(?:供|還|付款)?\s*[:：]?\s*\$?([\d,.]+)/);
      const dateMatch = combined.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      const noInterest = /0\s*%|免息|零利息|0息/.test(combined);
      const missing = [];
      if (!cardRef.cardName) missing.push('信用卡');
      if (!principal) missing.push('本金');
      if (!termMatch) missing.push('總期數');
      if (!aprMatch && !feeMatch && !paymentMatch && !noInterest) missing.push('APR／每期金額／免息');
      if (!dateMatch) missing.push('第一期還款日');
      if (missing.length) {
        result.status = 'clarify';
        result.missingFields = missing;
        result.question = `仲差 ${missing.join('、')}。你可以逐樣話我知，唔需要一次講晒。`;
        result.reply = result.question;
        return result;
      }
      let rawTitle = combined.split(/[\$]|\d[\d,]*(?:\.\d+)?\s*(?:蚊|元|港幣)/)[0]
        .replace(/我想|幫我|記錄|新增|分期|信用卡/g, '').trim();
      if (cardRef.cardName) rawTitle = rawTitle.replace(cardRef.cardName, '').trim();
      result.status = 'draft';
      result.confidence = 0.86;
      result.reply = '資料齊喇。我整理成分期任務線，先俾你確認每期供款同總利息。';
      result.draft = Object.assign(result.draft, {
        kind: 'installment', cardId: cardRef.cardId, cardName: cardRef.cardName,
        title: rawTitle || '分期消費', principal, termMonths: Number(termMatch[1]),
        paidMonths: paidMatch ? Number(paidMatch[1]) : 0,
        annualRate: aprMatch ? Number(aprMatch[1]) : 0,
        monthlyFee: feeMatch ? Number(feeMatch[1].replace(/,/g, '')) : 0,
        monthlyPayment: paymentMatch ? Number(paymentMatch[1].replace(/,/g, '')) : null,
        firstDueDate: normalizeDateKey(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`, today),
        category: 'bills',
      });
      return result;
    }

    if (/新增|開|建立/.test(combined) && (cardRef.cardName || /信用卡|卡戶口/.test(combined))) {
      const result = emptyResult('');
      const last4 = combined.match(/(?:尾數|尾號|最後)\s*([0-9]{4})/);
      const limit = combined.match(/(?:額度|信用額)\s*[:：]?\s*\$?([\d,.]+)/);
      const balance = combined.match(/(?:現時|目前|而家)?(?:結欠|欠款|卡數|餘額)\s*[:：]?\s*(?:HKD|HK\$|\$)?\s*([\d,.]+)/i);
      const noBalance = /(?:冇|沒有|無)(?:欠款|結欠|卡數)|(?:零|0)\s*(?:欠款|結欠|卡數)/.test(combined);
      const statement = combined.match(/(?:截數日|結單日)\s*[:：]?\s*(\d{1,2})/);
      const due = combined.match(/(?:到期日|繳款日|還款日)\s*[:：]?\s*(\d{1,2})/);
      const apr = combined.match(/(?:APR|年利率|實際年利率)\s*[:：]?\s*([\d.]+)\s*%/i);
      const missing = [];
      if (!cardRef.cardName) missing.push('信用卡名稱');
      if (!statement) missing.push('截數日');
      if (!due) missing.push('還款日');
      if (!apr && !/利率未知|唔知利率/.test(combined)) missing.push('APR（未知都可以）');
      if (!balance && !noBalance) missing.push('現時結欠（冇欠款可講 0）');
      if (missing.length) {
        result.status = 'clarify';
        result.missingFields = missing;
        result.question = `要開迷宮入口，我仲想確認 ${missing.join('、')}。`;
        result.reply = result.question;
        return result;
      }
      result.status = 'draft';
      result.confidence = 0.9;
      result.reply = '信用卡迷宮入口已經畫好，確認後先會正式加入。';
      result.draft = Object.assign(result.draft, {
        kind: 'credit_card', cardName: cardRef.cardName, last4: last4 ? last4[1] : null,
        creditLimit: limit ? Number(limit[1].replace(/,/g, '')) : null,
        currentBalance: balance ? Number(balance[1].replace(/,/g, '')) : 0,
        statementDay: Number(statement[1]), dueDay: Number(due[1]),
        annualRate: apr ? Number(apr[1]) : null,
      });
      return result;
    }

    const amount = extractMoney(last);
    if (amount && cardRef.cardName && /還款|繳款|找卡數|交卡數|還信用卡|繳信用卡|還[^；，,.]{0,16}卡/.test(combined)) {
      const result = emptyResult('');
      if (!cardRef.cardId) {
        result.status = 'clarify';
        result.question = `我聽到係 ${cardRef.cardName} 還款，但迷宮未有呢個入口。要先新增信用卡嗎？`;
        result.reply = result.question;
        result.missingFields = ['現有信用卡'];
        return result;
      }
      result.status = 'draft';
      result.confidence = 0.92;
      result.reply = '我整理成信用卡還款卷軸，確認後會扣減卡數，唔會當成新消費。';
      result.draft = Object.assign(result.draft, {
        kind: 'card_payment', amount, date: today, cardId: cardRef.cardId, cardName: cardRef.cardName,
      });
      return result;
    }

    const isIncome = /收入|人工|出糧|薪金|糧|佣金|花紅|獎金|兼職|freelance|退款|收到|收咗/i.test(combined);
    if (isIncome) {
      const result = emptyResult('');
      if (!amount) {
        result.status = 'clarify';
        result.question = '收到幾多？我唔會估收入金額。';
        result.reply = result.question;
        result.missingFields = ['金額'];
        return result;
      }
      const source = last
        .replace(/(?:HKD|HK\$|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:蚊|元|港幣)?/gi, '')
        .replace(/我想|幫我|記錄|記一筆|記低|收入|收到|收咗/g, '').trim();
      result.status = 'draft';
      result.confidence = 0.9;
      result.reply = '我整理成一筆收入卷軸。確認後會寫入冒險手帳。';
      result.draft = Object.assign(result.draft, {
        kind: 'income', amount, date: today, merchant: source || '收入',
      });
      return result;
    }

    if (/投資|股票|ETF|基金|債券|儲蓄|應急|退休|風險|理財/i.test(combined)) {
      return emptyResult('可以。我會先了解你嘅目標、時間同可承受風險，再提供一般理財教育資訊，唔會代你揀產品。你而家最想解決邊一件事？');
    }

    if (amount || /記帳|支出|使咗|用咗|買咗/.test(combined)) {
      const result = emptyResult('');
      if (!amount) {
        result.status = 'clarify';
        result.question = '呢筆使咗幾多？金額係唯一唔可以估嘅資料。';
        result.reply = result.question;
        result.missingFields = ['金額'];
        return result;
      }
      const category = detectCategory(last);
      const budgetImpact = detectBudgetImpact(last);
      const merchant = last.replace(/(?:HKD|HK\$|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:蚊|元|港幣)?/gi, '').trim();
      result.status = 'draft';
      result.confidence = category === 'other' ? 0.72 : 0.9;
      result.reply = budgetImpact === 'committed'
        ? '我整理成固定／預留支出，會留喺總支出，但唔會一筆扣爆今日安心額。'
        : '我整理成一筆日常支出卷軸。你確認分類同金額，我先寫入冒險手帳。';
      result.draft = Object.assign(result.draft, {
        kind: 'expense', amount, category, date: today, merchant: merchant || null,
        intent: null, cardId: cardRef.cardId, budgetImpact,
      });
      return result;
    }

    return emptyResult('我喺度。你可以記支出、收入、信用卡或分期，直接問理財問題，亦可以用「買前推演」睇清楚付款路線。');
  }

  function normalizeResult(result) {
    const base = emptyResult('我未聽清楚，可以換個方式再講一次。');
    if (!result || typeof result !== 'object') return base;
    const merged = Object.assign(base, result);
    merged.draft = Object.assign(base.draft, result.draft || {});
    if (!['answer', 'clarify', 'draft'].includes(merged.status)) merged.status = 'answer';
    return merged;
  }

  function setMode(label, active) {
    const el = $('advisor-mode');
    if (!el) return;
    el.textContent = label;
    el.classList.toggle('online', !!active);
  }

  function renderMessages() {
    const list = $('advisor-messages');
    if (!list) return;
    list.innerHTML = '';
    messages.forEach((message) => {
      const row = document.createElement('div');
      row.className = `advisor-message ${message.role}`;
      const bubble = document.createElement('div');
      bubble.className = 'advisor-bubble';
      bubble.textContent = message.content;
      row.appendChild(bubble);
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }

  function addMessage(role, content) {
    messages.push({ role, content: String(content || '').slice(0, 1200) });
    if (messages.length > 24) messages = messages.slice(-24);
    renderMessages();
  }

  function draftSummary(draft) {
    if (draft.kind === 'income') {
      return {
        title: '收入卷軸',
        lines: [
          ['金額', fmt(draft.amount)], ['來源', draft.merchant || '收入'],
          ['日期', draft.date || bridge.today()], ['記帳方式', '加入收入，不扣預算'],
        ],
      };
    }
    if (draft.kind === 'expense') {
      const card = (bridge.getState().creditCards || []).find((item) => item.id === draft.cardId);
      return {
        title: '支出卷軸',
        lines: [
          ['金額', fmt(draft.amount)], ['分類', CATEGORY_NAMES[draft.category] || '其他'],
          ['日期', draft.date || bridge.today()], ['商戶／備註', draft.merchant || '未填'],
          ['付款入口', card ? card.name : '一般支出'],
          ['安心額度', draft.budgetImpact === 'committed' ? '固定／預留 · 不扣今日' : '日常 · 扣今日'],
        ],
      };
    }
    if (draft.kind === 'credit_card') {
      return {
        title: '信用卡迷宮入口',
        lines: [
          ['名稱', draft.cardName], ['尾數', draft.last4 ? `•••• ${draft.last4}` : '未填'],
          ['信用額', draft.creditLimit ? fmt(draft.creditLimit) : '未填'],
          ['現時結欠', fmt(draft.currentBalance)],
          ['截數／還款', `${draft.statementDay || '?'} 日／${draft.dueDay || '?'} 日`],
          ['APR', draft.annualRate == null ? '未知' : `${draft.annualRate}%`],
        ],
      };
    }
    if (draft.kind === 'card_payment') {
      return {
        title: '信用卡還款卷軸',
        lines: [
          ['信用卡', draft.cardName || '未指定'], ['還款', fmt(draft.amount)],
          ['日期', draft.date || bridge.today()], ['記帳方式', '扣減卡數，不當新消費'],
        ],
      };
    }
    if (draft.kind === 'installment') {
      const preview = buildInstallmentSchedule({
        principal: draft.principal, termMonths: draft.termMonths, paidMonths: draft.paidMonths,
        annualRate: draft.annualRate, monthlyFee: draft.monthlyFee,
        monthlyPayment: draft.monthlyPayment, firstDueDate: draft.firstDueDate, today: bridge.today(),
      });
      return {
        title: '分期任務線',
        lines: [
          ['信用卡', draft.cardName || '未指定'], ['項目', draft.title || '分期消費'],
          ['本金', fmt(draft.principal)], ['期數', `${draft.termMonths} 期`],
          ['每期供款', fmt(preview.monthlyPayment)], ['總利息／費用', fmt(preview.totalInterest)],
          ['總還款', fmt(preview.totalCost)], ['第一期', draft.firstDueDate],
        ],
        preview,
      };
    }
    return { title: '確認卷軸', lines: [] };
  }

  function renderDraft() {
    const panel = $('advisor-draft');
    if (!panel) return;
    if (!activeDraft || activeDraft.kind === 'none') {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    try {
      const summary = draftSummary(activeDraft);
      panel.innerHTML = `
        <div class="draft-head"><span>${escapeHtml(summary.title)}</span><b>等待確認</b></div>
        <div class="draft-lines">${summary.lines.map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div>
        <div class="draft-actions">
          <button class="btn small ghost" id="advisor-revise">再同軍師講</button>
          <button class="btn small primary" id="advisor-confirm">確認記錄</button>
        </div>`;
      panel.classList.remove('hidden');
      $('advisor-revise').onclick = () => {
        panel.classList.add('hidden');
        $('advisor-input').focus();
      };
      $('advisor-confirm').onclick = confirmActiveDraft;
    } catch (error) {
      activeDraft = null;
      panel.classList.add('hidden');
      addMessage('assistant', error.message);
    }
  }

  function resolveCard(draft, state) {
    let card = (state.creditCards || []).find((item) => item.id === draft.cardId);
    if (!card && draft.cardName) {
      card = (state.creditCards || []).find((item) => item.name === draft.cardName);
    }
    if (!card && draft.cardName) {
      card = {
        id: makeId('card'), name: draft.cardName, last4: null, creditLimit: null,
        currentBalance: 0, statementDay: null, dueDay: null, annualRate: null,
        createdAt: Date.now(),
      };
      state.creditCards.push(card);
    }
    return card;
  }

  function confirmActiveDraft() {
    if (!activeDraft) return;
    const draft = activeDraft;
    const state = bridge.getState();
    let confirmation;
    if (draft.kind === 'income') {
      state.incomes = state.incomes || [];
      const incomeDate = draft.date || bridge.today();
      state.incomes.push({
        id: makeId('income'), amount: roundMoney(draft.amount),
        dateKey: incomeDate, source: draft.merchant || '收入', ts: Date.now(),
      });
      if (incomeDate === bridge.today()) bridge.invalidateReview();
      bridge.dailyReward('income-entry', 10, 15, incomeDate === bridge.today());
      bridge.commit();
      confirmation = `${fmt(draft.amount)} 收入已經寫入冒險手帳。`;
    } else if (draft.kind === 'expense') {
      const recorded = bridge.recordExpense(draft.category || 'other', Number(draft.amount), {
        dateKey: draft.date || bridge.today(), merchant: draft.merchant || null,
        cardId: draft.cardId || null, intent: draft.intent || null,
        source: 'advisor', budgetImpact: draft.budgetImpact || 'daily', skipDialogue: true,
      });
      if (!recorded) return;
      confirmation = `${fmt(draft.amount)} 已經寫入冒險手帳。`;
    } else if (draft.kind === 'credit_card') {
      state.creditCards.push({
        id: makeId('card'), name: String(draft.cardName).slice(0, 24), last4: draft.last4 || null,
        creditLimit: draft.creditLimit || null, currentBalance: draft.currentBalance || 0,
        statementDay: draft.statementDay || null, dueDay: draft.dueDay || null,
        annualRate: draft.annualRate, createdAt: Date.now(),
      });
      bridge.reward(20, 25);
      bridge.commit();
      confirmation = `${draft.cardName} 迷宮入口已經加入，之後可以將分期任務掛喺呢度。`;
    } else if (draft.kind === 'installment') {
      const card = resolveCard(draft, state);
      if (!card) {
        addMessage('assistant', '我仲未知道屬於邊張信用卡，先話我知卡名。');
        return;
      }
      const preview = buildInstallmentSchedule({
        principal: draft.principal, termMonths: draft.termMonths, paidMonths: draft.paidMonths,
        annualRate: draft.annualRate, monthlyFee: draft.monthlyFee,
        monthlyPayment: draft.monthlyPayment, firstDueDate: draft.firstDueDate, today: bridge.today(),
      });
      state.installments.push({
        id: makeId('plan'), cardId: card.id, title: String(draft.title || '分期消費').slice(0, 40),
        principal: roundMoney(draft.principal), termMonths: Math.round(draft.termMonths),
        paidMonths: Math.round(draft.paidMonths || 0), annualRate: Number(draft.annualRate || 0),
        monthlyFee: roundMoney(draft.monthlyFee || 0), monthlyPayment: preview.monthlyPayment,
        firstDueDate: draft.firstDueDate, totalCost: preview.totalCost,
        totalInterest: preview.totalInterest, schedule: preview.schedule, createdAt: Date.now(),
      });
      bridge.reward(25, 40);
      bridge.commit();
      confirmation = `${draft.title || '分期任務'} 已經展開；每繳一期都會推進任務進度。`;
    } else if (draft.kind === 'card_payment') {
      const card = (state.creditCards || []).find((item) => item.id === draft.cardId);
      if (!card) {
        addMessage('assistant', '搵唔到呢張信用卡，先同我確認卡名。');
        return;
      }
      const amount = roundMoney(draft.amount);
      const paymentDate = draft.date || bridge.today();
      card.currentBalance = roundMoney(Math.max(0, Number(card.currentBalance || 0) - amount));
      state.cardPayments.push({ id: makeId('cardpay'), cardId: card.id, amount, dateKey: paymentDate, ts: Date.now() });
      if (paymentDate === bridge.today()) bridge.invalidateReview();
      bridge.dailyReward('card-payment', 15, 20, paymentDate === bridge.today());
      bridge.commit();
      confirmation = `${card.name} 已還 ${fmt(amount)}；呢筆係減債，冇當成新消費。`;
    }
    activeDraft = null;
    renderDraft();
    addMessage('assistant', confirmation);
    turnAnchor = messages.length;
    bridge.toast(confirmation);
    bridge.vibrate([8, 28, 8]);
  }

  async function callAdvisorApi(text) {
    const config = (typeof window !== 'undefined' && window.FRPG_CONFIG) || {};
    const endpoint = String(config.advisorApiUrl || '').trim();
    const context = {
      today: bridge.today(),
      categories: Object.entries(CATEGORY_NAMES).map(([id, name]) => ({ id, name })),
      cards: (bridge.getState().creditCards || []).map((card) => ({
        id: card.id, name: card.name, last4: card.last4, statementDay: card.statementDay,
        dueDay: card.dueDay, annualRate: card.annualRate,
      })),
    };
    if (!endpoint) {
      setMode('本機軍師', false);
      return localAdvisorTurn(messages.slice(turnAnchor), context);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ messages: messages.slice(turnAnchor).slice(-MAX_MESSAGES), context }),
      });
      if (!response.ok) throw new Error(`advisor ${response.status}`);
      setMode('AI 軍師連線', true);
      return normalizeResult(await response.json());
    } catch (error) {
      setMode('本機軍師', false);
      const fallback = localAdvisorTurn(messages.slice(turnAnchor), context);
      fallback.reply = `連線未成功，我先用本機規則整理。${fallback.reply}`;
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  async function submitMessage(value) {
    const input = $('advisor-input');
    const send = $('advisor-send');
    const text = String(value != null ? value : input.value).trim();
    if (!text || send.disabled) return;
    input.value = '';
    activeDraft = null;
    renderDraft();
    addMessage('user', text);
    send.disabled = true;
    $('advisor-thinking').classList.remove('hidden');
    const result = normalizeResult(await callAdvisorApi(text));
    $('advisor-thinking').classList.add('hidden');
    send.disabled = false;
    addMessage('assistant', result.reply || result.question);
    activeDraft = result.status === 'draft' ? result.draft : null;
    renderDraft();
  }

  function startVoice() {
    if (!recognition || listening) return;
    try { recognition.start(); } catch (error) {}
  }

  function setupVoice() {
    const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    const mic = $('advisor-mic');
    if (!Recognition) {
      mic.disabled = true;
      mic.title = '呢個瀏覽器未支援語音輸入';
      return;
    }
    recognition = new Recognition();
    recognition.lang = 'zh-HK';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      listening = true;
      mic.classList.add('listening');
      $('advisor-input').placeholder = '軍師聽緊...';
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) transcript += event.results[index][0].transcript;
      $('advisor-input').value = transcript;
    };
    recognition.onerror = (event) => {
      bridge.toast(event.error === 'not-allowed'
        ? '需要允許咪高峰權限先可以語音記帳'
        : '今次聽唔清楚，可以再講一次');
    };
    recognition.onend = () => {
      listening = false;
      mic.classList.remove('listening');
      $('advisor-input').placeholder = '記帳、記收入，或者問理財問題…';
      $('advisor-input').focus();
    };
  }

  function open(prompt) {
    $('advisor-mask').classList.remove('hidden');
    if (!messages.length) addMessage('assistant', '我喺度。你可以記支出、收入、信用卡或分期，直接問理財問題，亦可以先推演一筆消費。資料未齊我會逐樣問，任何紀錄都要你確認先會寫入。');
    renderMessages();
    if (prompt) submitMessage(prompt);
    else $('advisor-input').focus();
  }

  function openVoice() {
    open();
    if (!recognition) {
      bridge.toast('呢個瀏覽器未支援語音輸入，已為你開啟文字記帳');
      return;
    }
    startVoice();
  }

  function close() {
    $('advisor-mask').classList.add('hidden');
    if (recognition && listening) recognition.stop();
  }

  function markNextPayment(planId) {
    const state = bridge.getState();
    const plan = (state.installments || []).find((item) => item.id === planId);
    if (!plan) return;
    const payment = (plan.schedule || []).find((item) => item.status !== 'paid');
    if (!payment) return;
    payment.status = 'paid';
    payment.paidAt = Date.now();
    plan.paidMonths = plan.schedule.filter((item) => item.status === 'paid').length;
    const recorded = bridge.recordExpense('bills', payment.amount, {
      dateKey: bridge.today(), merchant: `${plan.title} 第 ${payment.index + 1} 期`,
      cardId: plan.cardId, installmentId: plan.id, intent: 'need',
      installmentPaymentIndex: payment.index,
      source: 'installment', budgetImpact: 'committed', skipDialogue: true,
    });
    if (!recorded) {
      payment.status = 'planned';
      payment.paidAt = null;
      return;
    }
    bridge.dailyReward('installment-payment', 15, 20);
    bridge.commit();
    const finished = plan.paidMonths >= plan.termMonths;
    bridge.toast(finished ? `${plan.title} 任務線完成！` : `${plan.title} 已推進到 ${plan.paidMonths}/${plan.termMonths}`);
    if (finished) bridge.speak('錢錢軍師', `${plan.title} 全部供完。你將一條長任務完整行到底，呢份穩定比一次過衝刺更難得。`);
  }

  function render(state) {
    const summary = $('credit-summary');
    const list = $('credit-list');
    const priority = $('credit-priority');
    if (!summary || !list || !priority) return;
    const cards = state.creditCards || [];
    const plans = state.installments || [];
    const today = bridge.today();
    const remaining = roundMoney(plans.reduce((sum, plan) => sum + (plan.schedule || [])
      .filter((payment) => payment.status !== 'paid').reduce((subtotal, payment) => subtotal + payment.amount, 0), 0));
    const thisMonth = monthReserved(state, bridge.month());
    summary.innerHTML = `
      <div class="stat-box"><div class="v">${cards.length}</div><div class="k">迷宮入口</div></div>
      <div class="stat-box"><div class="v">${fmt(thisMonth)}</div><div class="k">本月待守供款</div></div>
      <div class="stat-box wide"><div class="v">${fmt(remaining)}</div><div class="k">分期任務剩餘總供款</div></div>`;
    const priorities = [];
    plans.forEach((plan) => {
      const next = (plan.schedule || []).find((payment) => payment.status !== 'paid');
      if (!next) return;
      const card = cards.find((item) => item.id === plan.cardId);
      priorities.push({
        kind: 'installment',
        planId: plan.id,
        cardId: plan.cardId,
        date: next.dueDate,
        amount: next.amount,
        amountLabel: '本期供款',
        title: `${plan.title} 第 ${next.index + 1} 期`,
        prompt: `我想處理 ${card ? card.name : ''} ${plan.title} 下一期供款`,
      });
    });
    cards.forEach((card) => {
      if (!(Number(card.currentBalance || 0) > 0)) return;
      const date = nextMonthlyDate(card.dueDay, today);
      if (!date) return;
      priorities.push({
        kind: 'card',
        cardId: card.id,
        date,
        amount: card.currentBalance,
        amountLabel: '目前結欠',
        title: `${card.name} 還款日檢查`,
        prompt: `我想處理 ${card.name} 嘅本期還款`,
      });
    });
    priorities.sort((a, b) => a.date.localeCompare(b.date));
    const nextPriority = priorities[0];
    if (!cards.length) {
      priority.className = 'credit-priority needs-info';
      priority.innerHTML = '<div><span>尚未設定</span><b>先建立第一個信用卡入口</b><p>用上方「新增信用卡」填寫結欠、截數日、還款日同利率。</p></div>';
    } else if (nextPriority) {
      const days = daysUntil(nextPriority.date, today);
      priority.className = `credit-priority${days <= 7 ? ' urgent' : ''}`;
      const actionLabel = nextPriority.kind === 'installment' ? '查看分期' : '記還款';
      priority.innerHTML = `<div><span>${days === 0 ? '今日要處理' : `最近行動 · ${days} 日後`}</span><b>${escapeHtml(nextPriority.title)}</b><p>${shortDate(nextPriority.date)} · ${nextPriority.amountLabel} ${fmt(nextPriority.amount)}</p></div><button class="btn small primary" id="credit-priority-action">${actionLabel}</button>`;
      $('credit-priority-action').onclick = () => {
        if (nextPriority.kind === 'card') bridge.openCardPaymentForm(nextPriority.cardId);
        else {
          const target = document.getElementById(`credit-card-${nextPriority.cardId}`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    } else if (cards.some((card) => !card.dueDay)) {
      const incomplete = cards.find((card) => !card.dueDay);
      priority.className = 'credit-priority needs-info';
      priority.innerHTML = '<div><span>資料缺口</span><b>補上每張卡嘅還款日</b><p>完整資料先可以準確安排下一步。</p></div><button class="btn small ghost" id="credit-priority-action">補資料</button>';
      $('credit-priority-action').onclick = () => bridge.openCardForm(incomplete.id);
    } else {
      priority.className = 'credit-priority clear';
      priority.innerHTML = '<div><span>眼前安全</span><b>暫時冇待處理供款</b><p>目前所有已記錄項目都已處理。</p></div>';
    }
    if (!cards.length) {
      list.innerHTML = '<div class="credit-empty"><b>未有信用卡迷宮</b><p>按上方「新增信用卡」填表；亦可以由底部軍師入口用對話輸入。</p></div>';
      return;
    }
    list.innerHTML = cards.map((card) => {
      const cardPlans = plans.filter((plan) => plan.cardId === card.id);
      const outstanding = roundMoney(cardPlans.reduce((sum, plan) => sum + (plan.schedule || [])
        .filter((payment) => payment.status !== 'paid').reduce((subtotal, payment) => subtotal + payment.principal, 0), 0) + Number(card.currentBalance || 0));
      const utilization = card.creditLimit ? Math.min(100, outstanding / card.creditLimit * 100) : 0;
      const nextPlanPayment = cardPlans.map((plan) => (plan.schedule || []).find((payment) => payment.status !== 'paid')).filter(Boolean).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      const nextDate = nextPlanPayment ? nextPlanPayment.dueDate : nextMonthlyDate(card.dueDay, today);
      const nextDays = nextDate ? daysUntil(nextDate, today) : null;
      const rateWarning = Number(card.annualRate || 0) >= 30 ? '<span class="credit-rate-warning">高息卡：先避免新增循環結欠</span>' : '';
      const planRows = cardPlans.length ? cardPlans.map((plan) => {
        const next = (plan.schedule || []).find((payment) => payment.status !== 'paid');
        const pct = Math.round(plan.paidMonths / plan.termMonths * 100);
        return `<div class="installment-row">
          <div class="installment-head"><div><b>${escapeHtml(plan.title)}</b><span>${plan.paidMonths}/${plan.termMonths} 期</span></div><strong>${next ? fmt(next.amount) : '完成'}</strong></div>
          <div class="installment-track"><div style="width:${pct}%"></div></div>
          <div class="installment-meta"><span>${next ? `下一關 ${escapeHtml(next.dueDate)}` : '任務線已完成'}</span><span>利息／費用 ${fmt(plan.totalInterest)}</span></div>
          ${next ? `<button class="btn small ghost" data-pay-plan="${escapeHtml(plan.id)}">繳付本期</button>` : '<span class="plan-cleared">全數通關</span>'}
        </div>`;
      }).join('') : '<p class="credit-no-plan">未有分期任務。</p>';
      return `<article class="credit-card-item" id="credit-card-${escapeHtml(card.id)}">
        <div class="credit-card-head"><div><span>信用卡迷宮</span><h4>${escapeHtml(card.name)} ${card.last4 ? `•••• ${escapeHtml(card.last4)}` : ''}</h4></div><button class="icon-btn" data-card-edit="${escapeHtml(card.id)}" aria-label="編輯${escapeHtml(card.name)}" title="編輯信用卡"><span class="icon" data-icon="edit"></span></button></div>
        <div class="credit-next${nextDays != null && nextDays <= 7 ? ' urgent' : ''}"><span>下一步</span><b>${nextDate ? `${shortDate(nextDate)} · ${nextDays === 0 ? '今日' : `${nextDays} 日後`}` : '補上還款日'}</b></div>
        <div class="credit-metrics"><div><span>卡片＋分期結欠</span><b>${fmt(outstanding)}</b></div><div><span>年利率 APR</span><b>${card.annualRate == null ? '未知' : `${card.annualRate}%`}</b></div><div><span>每月截數／還款</span><b>${card.statementDay || '?'} 日／${card.dueDay || '?'} 日</b></div></div>
        ${rateWarning}
        ${card.creditLimit ? `<div class="credit-util"><span>額度使用</span><b>${Math.round(utilization)}%</b><div><i style="width:${utilization}%"></i></div></div>` : ''}
        ${Number(card.currentBalance || 0) > 0 ? `<button class="btn small primary credit-pay-btn" data-card-pay="${escapeHtml(card.id)}">記還款</button>` : ''}
        <div class="installment-list">${planRows}</div>
      </article>`;
    }).join('');
    if (bridge.initIcons) bridge.initIcons(list);
    list.querySelectorAll('[data-pay-plan]').forEach((button) => (button.onclick = () => markNextPayment(button.dataset.payPlan)));
    list.querySelectorAll('[data-card-pay]').forEach((button) => (button.onclick = () => bridge.openCardPaymentForm(button.dataset.cardPay)));
    list.querySelectorAll('[data-card-edit]').forEach((button) => {
      button.onclick = () => bridge.openCardForm(button.dataset.cardEdit);
    });
  }

  function init(api) {
    bridge = api;
    const config = (typeof window !== 'undefined' && window.FRPG_CONFIG) || {};
    setMode(config.advisorApiUrl ? 'AI 軍師連線' : '本機軍師', !!config.advisorApiUrl);
    $('advisor-close').onclick = close;
    $('advisor-mask').onclick = (event) => { if (event.target === $('advisor-mask')) close(); };
    $('advisor-send').onclick = () => submitMessage();
    $('advisor-input').onkeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitMessage(); }
    };
    $('advisor-mic').onclick = startVoice;
    document.querySelectorAll('[data-advisor-prompt]').forEach((button) => {
      button.onclick = () => submitMessage(button.dataset.advisorPrompt);
    });
    document.querySelectorAll('[data-advisor-action="decision"]').forEach((button) => {
      button.onclick = () => { close(); bridge.openDecision(); };
    });
    setupVoice();
    if (bridge.initIcons) bridge.initIcons($('advisor-sheet'));
  }

  return {
    init, open, openVoice, close, render, monthReserved, monthCommitments, buildInstallmentSchedule,
    localAdvisorTurn, normalizeDateKey, addMonths,
  };
});
