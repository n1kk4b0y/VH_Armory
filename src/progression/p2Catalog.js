const catalog = require('../../data/p2-catalog.json');
const { label, object } = require('./native');
function text(value) {
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (object(parsed) || Array.isArray(parsed)) return text(parsed); } catch {}
    return value.replace(/§./g, '');
  }
  if (Array.isArray(value)) return value.map(text).join('');
  if (object(value)) return `${typeof value.text === 'string' ? value.text : ''}${Array.isArray(value.extra) ? value.extra.map(text).join('') : ''}`;
  return '';
}
function itemName(id, tag) { return text(tag?.display?.Name) || catalog.items[id] || label(id); }
module.exports = { catalog, itemName, text };
