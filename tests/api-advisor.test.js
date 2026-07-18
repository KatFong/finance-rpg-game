'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/advisor.js');

function responseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('cleans and bounds messages and card context', () => {
  const messages = handler.cleanMessages(Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'unexpected',
    content: `turn-${index}`,
  })));
  assert.equal(messages.length, 10);
  assert.equal(messages[0].content, 'turn-4');
  assert.equal(messages[0].role, 'user');

  const context = handler.cleanContext({
    today: '2026-07-18-extra',
    cards: [{ id: 'card-1', name: '恒生卡', last4: '001234', annualRate: '35' }],
  });
  assert.equal(context.today, '2026-07-18');
  assert.equal(context.cards[0].last4, '1234');
  assert.equal(context.cards[0].annualRate, 35);
});

test('rejects an unapproved browser origin before using a key', async () => {
  const res = responseMock();
  await handler({ method: 'POST', headers: { origin: 'https://example.com' }, body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'origin_not_allowed' });
});

test('returns a clear configuration error when the server key is absent', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const res = responseMock();
    await handler({ method: 'POST', headers: { origin: 'http://127.0.0.1:3900' }, body: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'advisor_not_configured' });
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('structured schema supports income and card payments', () => {
  assert.ok(handler.RESPONSE_SCHEMA.properties.draft.properties.kind.enum.includes('income'));
  assert.ok(handler.RESPONSE_SCHEMA.properties.draft.properties.kind.enum.includes('card_payment'));
});
