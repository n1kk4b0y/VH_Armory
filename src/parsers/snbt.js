// Reads the textual CompoundTag stored by the mod in each item snapshot.
// Large longs stay strings; equipment metadata does not need lossy conversion.
function parseSnbt(text) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) return null;
  let pos = 0;
  const space = () => { while (/\s/.test(text[pos] || '') && pos < text.length) pos++; };
  const expect = char => { space(); if (text[pos++] !== char) throw new Error('Invalid SNBT'); };
  function quoted() {
    const quote = text[pos++];
    let result = '';
    while (pos < text.length) {
      const char = text[pos++];
      if (char === quote) return result;
      if (char === '\\') {
        const escaped = text[pos++];
        if (escaped !== quote && escaped !== '\\') throw new Error('Invalid SNBT escape');
        result += escaped;
      } else result += char;
    }
    throw new Error('Unclosed SNBT string');
  }
  function value(depth) {
    if (depth > 64) throw new Error('SNBT nesting limit');
    space();
    if (text[pos] === '"' || text[pos] === "'") return quoted();
    if (text[pos] === '{') {
      pos++;
      const result = Object.create(null);
      space();
      if (text[pos] === '}') { pos++; return result; }
      while (pos < text.length) {
        space();
        let name;
        if (text[pos] === '"' || text[pos] === "'") name = quoted();
        else {
          const start = pos;
          while (/[A-Za-z0-9_.+\-]/.test(text[pos] || '') && pos < text.length) pos++;
          name = text.slice(start,pos);
          if (!name) throw new Error('Invalid SNBT key');
        }
        expect(':');
        result[name] = value(depth + 1);
        space();
        if (text[pos] === '}') { pos++; return result; }
        expect(',');
      }
    } else if (text[pos] === '[') {
      pos++; space();
      if (/^[BIL];/i.test(text.slice(pos,pos+2))) { pos += 2; space(); }
      const result = [];
      if (text[pos] === ']') { pos++; return result; }
      while (pos < text.length) {
        result.push(value(depth + 1));
        space();
        if (text[pos] === ']') { pos++; return result; }
        expect(',');
      }
    } else {
      const start = pos;
      while (pos < text.length && !/[\s,\]}]/.test(text[pos])) pos++;
      const token = text.slice(start,pos);
      if (!token) throw new Error('Missing SNBT value');
      if (/^(true|false)$/i.test(token)) return token.toLowerCase() === 'true';
      if (/^[+-]?\d+[bsl]?$/i.test(token)) {
        const numeric = token.replace(/[bsl]$/i,'');
        const number = Number(numeric);
        return Number.isSafeInteger(number) ? number : numeric;
      }
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[fd]?$/i.test(token)) {
        const number = Number(token.replace(/[fd]$/i,''));
        if (!Number.isFinite(number)) throw new Error('Invalid SNBT number');
        return number;
      }
      return token;
    }
    throw new Error('Unclosed SNBT value');
  }
  try {
    const result = value(0);
    space();
    return pos === text.length ? result : null;
  } catch { return null; }
}

module.exports = { parseSnbt };
