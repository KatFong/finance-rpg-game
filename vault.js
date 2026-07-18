(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinanceVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP_ID = 'finance-rpg-game';
  const BACKUP_VERSION = 1;
  const MAX_DEPTH = 20;
  const MAX_ARRAY_LENGTH = 10000;
  const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function safeClone(value, depth) {
    const level = depth || 0;
    if (level > MAX_DEPTH) throw new Error('存檔結構太深');
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('存檔包含無效數字');
      return value;
    }
    if (typeof value === 'string') return value.slice(0, 2000).replace(/[<>]/g, '');
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) throw new Error('存檔紀錄數量異常');
      return value.map((item) => safeClone(item, level + 1));
    }
    if (typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach((key) => {
        if (!BLOCKED_KEYS.has(key)) output[key] = safeClone(value[key], level + 1);
      });
      return output;
    }
    throw new Error('存檔包含不支援資料');
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function checksum(state) {
    const text = stableStringify(state);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function summary(state) {
    const list = (key) => Array.isArray(state && state[key]) ? state[key].length : 0;
    return {
      heroName: String((state && state.heroName) || '勇者').slice(0, 40),
      expenses: list('expenses'),
      incomeEntries: list('incomes'),
      cards: list('creditCards'),
      installments: list('installments'),
      goals: list('goals'),
      decisions: list('decisionEncounters'),
    };
  }

  function createBackup(state, exportedAt) {
    const cleanState = safeClone(state);
    return {
      app: APP_ID,
      version: BACKUP_VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      checksum: checksum(cleanState),
      summary: summary(cleanState),
      state: cleanState,
    };
  }

  function parseBackup(input) {
    let backup;
    try {
      backup = typeof input === 'string' ? JSON.parse(input) : input;
    } catch (error) {
      throw new Error('檔案唔係有效存檔');
    }
    if (!backup || backup.app !== APP_ID) throw new Error('呢個檔案唔屬於理財勇者');
    if (!Number.isInteger(backup.version) || backup.version < 1 || backup.version > BACKUP_VERSION) throw new Error('存檔版本暫時未支援');
    if (!backup.state || typeof backup.state !== 'object' || Array.isArray(backup.state)) throw new Error('存檔內容不完整');
    const cleanState = safeClone(backup.state);
    if (backup.checksum !== checksum(cleanState)) throw new Error('存檔完整性驗證失敗');
    const exportedAt = new Date(backup.exportedAt);
    if (Number.isNaN(exportedAt.getTime())) throw new Error('存檔日期無效');
    return {
      app: APP_ID,
      version: backup.version,
      exportedAt: exportedAt.toISOString(),
      checksum: backup.checksum,
      summary: summary(cleanState),
      state: cleanState,
    };
  }

  return { APP_ID, BACKUP_VERSION, createBackup, parseBackup, checksum, summary, stableStringify };
});
