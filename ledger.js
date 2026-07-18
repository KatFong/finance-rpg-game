(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FinanceLedger = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
  const searchValue = (value) => String(value == null ? '' : value).normalize('NFKC').toLocaleLowerCase();

  function filterEntries(entries, filters) {
    const list = Array.isArray(entries) ? entries : [];
    const settings = filters || {};
    const month = /^\d{4}-\d{2}$/.test(settings.month) ? settings.month : 'all';
    const type = String(settings.type || 'all');
    const query = searchValue(settings.query).trim();
    return list.filter((entry) => {
      if (!entry) return false;
      if (month !== 'all' && !String(entry.dateKey || '').startsWith(month)) return false;
      if (type !== 'all' && entry.type !== type) return false;
      if (!query) return true;
      const haystack = [
        entry.dateKey, entry.timeLabel, entry.typeLabel, entry.name, entry.category,
        entry.tag, entry.budgetLabel, entry.account, entry.status, entry.amount,
      ].map(searchValue).join(' ');
      return haystack.includes(query);
    });
  }

  function summarizeEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const income = list.filter((entry) => entry && entry.type === 'income')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0);
    const spending = list.filter((entry) => entry && entry.type === 'expense')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0);
    const transfers = list.filter((entry) => entry && entry.type === 'transfer')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0);
    return {
      count: list.length,
      income: roundMoney(income),
      spending: roundMoney(spending),
      transfers: roundMoney(transfers),
      net: roundMoney(income - spending),
    };
  }

  function monthKeys(entries) {
    return [...new Set((Array.isArray(entries) ? entries : [])
      .map((entry) => String((entry && entry.dateKey) || '').slice(0, 7))
      .filter((value) => /^\d{4}-\d{2}$/.test(value)))]
      .sort((a, b) => b.localeCompare(a));
  }

  function csvCell(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    let text = String(value == null ? '' : value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCsv(entries) {
    const columns = [
      ['dateKey', '日期'], ['timeLabel', '時間'], ['typeLabel', '紀錄類型'],
      ['name', '名稱'], ['category', '分類'], ['budgetLabel', '日常預算影響'],
      ['amount', '記錄金額'], ['cashflowEffect', '收支影響'], ['account', '關聯帳戶'],
      ['status', '狀態／備註'],
    ];
    const rows = [columns.map((column) => csvCell(column[1])).join(',')];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      rows.push(columns.map(([key]) => csvCell(entry && entry[key])).join(','));
    });
    return `\uFEFF${rows.join('\r\n')}\r\n`;
  }

  return { filterEntries, summarizeEntries, monthKeys, csvCell, toCsv };
});
