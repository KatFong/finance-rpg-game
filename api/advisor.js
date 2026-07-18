'use strict';

const DEFAULT_ORIGIN = 'https://katfong.github.io';
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reply', 'question', 'missingFields', 'confidence', 'draft'],
  properties: {
    status: { type: 'string', enum: ['answer', 'clarify', 'draft'] },
    reply: { type: 'string' },
    question: { type: 'string' },
    missingFields: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    draft: {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind', 'amount', 'category', 'date', 'merchant', 'budgetImpact', 'intent', 'cardId', 'cardName',
        'last4', 'creditLimit', 'currentBalance', 'statementDay', 'dueDay', 'annualRate',
        'title', 'principal', 'termMonths', 'paidMonths', 'monthlyPayment', 'monthlyFee',
        'firstDueDate',
      ],
      properties: {
        kind: { type: 'string', enum: ['none', 'expense', 'income', 'credit_card', 'installment', 'card_payment'] },
        amount: { type: ['number', 'null'] },
        category: { type: ['string', 'null'], enum: ['food', 'transport', 'shopping', 'fun', 'bills', 'other', null] },
        date: { type: ['string', 'null'] },
        merchant: { type: ['string', 'null'] },
        budgetImpact: { type: ['string', 'null'], enum: ['daily', 'committed', null] },
        intent: { type: ['string', 'null'], enum: ['need', 'joy', 'impulse', null] },
        cardId: { type: ['string', 'null'] },
        cardName: { type: ['string', 'null'] },
        last4: { type: ['string', 'null'] },
        creditLimit: { type: ['number', 'null'] },
        currentBalance: { type: ['number', 'null'] },
        statementDay: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
        dueDay: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
        annualRate: { type: ['number', 'null'], minimum: 0 },
        title: { type: ['string', 'null'] },
        principal: { type: ['number', 'null'] },
        termMonths: { type: ['integer', 'null'], minimum: 1 },
        paidMonths: { type: ['integer', 'null'], minimum: 0 },
        monthlyPayment: { type: ['number', 'null'], minimum: 0 },
        monthlyFee: { type: ['number', 'null'], minimum: 0 },
        firstDueDate: { type: ['string', 'null'] },
      },
    },
  },
};

const INSTRUCTIONS = `You are 錢錢軍師, a Cantonese finance chatbot and NPC inside a cozy finance RPG.
Your job is to understand user messages, answer general financial education questions, or prepare exactly one structured draft. You never save data yourself.
Reply in concise written Cantonese using Traditional Chinese. Be warm and non-judgmental.

Rules:
1. Never invent an amount, date, card, interest rate, installment term, fee, payment, statement day, or due day.
2. If required financial data is unclear, set status=clarify, kind=none, list missingFields, and ask one focused follow-up question.
3. For an expense, amount is required. Infer category only when reasonably clear; otherwise use other. Date defaults to context.today. Set budgetImpact=daily for ordinary day-to-day spending. Set budgetImpact=committed for rent, rates, management fees, insurance, tuition, tax, scheduled repayments, or an expense the user explicitly says is fixed, pre-reserved, one-off from savings, or should not reduce today's allowance. Never classify something as committed merely because its amount is large; ask one focused follow-up when the source of funds is unclear.
4. For income, amount is required, date defaults to context.today, and merchant stores the income source such as salary, freelance, bonus, or refund.
5. For a credit card, cardName, currentBalance (including an explicit zero), statementDay, dueDay, and either annualRate or an explicit statement that the rate is unknown are required. last4 and creditLimit are optional.
6. For an installment, card identity, title, principal, termMonths, firstDueDate, and at least one financing basis are required. Financing basis means quoted monthlyPayment, annualRate, explicit 0% interest, or monthlyFee. Never calculate the schedule yourself.
7. Match cardId only from context.cards. When the user names a new card during installment setup, leave cardId null and preserve cardName.
8. A repayment or installment payment is not a new purchase. For a payment toward an existing card balance, use kind=card_payment with amount, date, and a cardId from context. Do not classify it as an expense or reduce today's allowance.
9. If the user asks a general finance or investment question, use status=answer and kind=none. Explain principles, and ask about goals, time horizon, and risk tolerance when relevant. Do not recommend a specific product or promise returns.
10. Use status=draft only when the draft can be safely shown for user confirmation. The application performs deterministic calculations and requires a final tap before saving.
11. Do not provide personalized investment, lending, legal, or tax advice.`;

function isAllowedOrigin(origin) {
  const configured = process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  return !origin || origin === configured || origin === `${configured}/`
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function allowedOrigin(origin) {
  return isAllowedOrigin(origin) && origin
    ? origin
    : (process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN);
}

function setCors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 1200),
  })).filter((message) => message.content.trim());
}

function cleanContext(value) {
  const context = value && typeof value === 'object' ? value : {};
  return {
    today: String(context.today || '').slice(0, 10),
    categories: Array.isArray(context.categories) ? context.categories.slice(0, 12) : [],
    cards: Array.isArray(context.cards) ? context.cards.slice(0, 20).map((card) => ({
      id: String(card.id || '').slice(0, 80), name: String(card.name || '').slice(0, 40),
      last4: card.last4 ? String(card.last4).slice(-4) : null,
      statementDay: card.statementDay || null, dueDay: card.dueDay || null,
      annualRate: card.annualRate == null ? null : Number(card.annualRate),
    })) : [],
  };
}

function outputText(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return '';
}

module.exports = async function advisorHandler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'origin_not_allowed' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'advisor_not_configured' });

  const messages = cleanMessages(req.body && req.body.messages);
  const context = cleanContext(req.body && req.body.context);
  if (!messages.length) return res.status(400).json({ error: 'messages_required' });
  const payloadSize = JSON.stringify({ messages, context }).length;
  if (payloadSize > 18000) return res.status(413).json({ error: 'payload_too_large' });

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
        store: false,
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: `${INSTRUCTIONS}\n\nCurrent app context:\n${JSON.stringify(context)}` },
          ...messages,
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'finance_advisor_turn',
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI Responses API error', response.status, data.error && data.error.type);
      return res.status(502).json({ error: 'advisor_upstream_error' });
    }
    const text = outputText(data);
    if (!text) return res.status(502).json({ error: 'advisor_empty_response' });
    return res.status(200).json(JSON.parse(text));
  } catch (error) {
    console.error('Advisor endpoint error', error && error.message);
    return res.status(500).json({ error: 'advisor_internal_error' });
  }
};

module.exports.RESPONSE_SCHEMA = RESPONSE_SCHEMA;
module.exports.cleanMessages = cleanMessages;
module.exports.cleanContext = cleanContext;
module.exports.isAllowedOrigin = isAllowedOrigin;
