// Exact native keys only. Empty collections and absent player entries differ.
const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
function uuid(value) {
  if (typeof value === 'string') {
    const hex = value.toLowerCase().replace(/-/g, '');
    if (!/^[a-f0-9]{32}$/.test(hex)) return null;
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  if (Array.isArray(value) && value.length === 4 && value.every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647)) {
    return uuid(value.map(n => (n >>> 0).toString(16).padStart(8, '0')).join(''));
  }
  return null;
}
function entry(map, player) {
  if (!object(map)) return null;
  const id = uuid(player);
  const key = Object.keys(map).find(key => id && uuid(key) === id);
  return key == null ? null : { key, value:map[key] };
}
function numeric(value, min = 0) { return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null; }
function label(id) {
  return String(id ?? '').split(':').at(-1).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_/-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function field(value, source, path, test = value => value != null) {
  const found = test(value);
  return { found, value:found ? value : null, source, path };
}
function unique(values) { return [...new Set(values)]; }
module.exports = { own, object, uuid, entry, numeric, label, field, unique };
