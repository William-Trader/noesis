// Noesis · CJK + Latin tokenizer (zero dependencies).
// Han / Kana / Hangul  ->  unigrams + adjacent bigrams (dictionary-free, high recall).
// Latin letters / digits -> lowercased word terms.

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const WORD = /[0-9a-z_]/;

export function isCJK(ch) {
  return HAN.test(ch);
}

export function tokenize(text, opts = {}) {
  const bigrams = opts.bigrams !== false;
  const out = [];
  const s = String(text == null ? "" : text).toLowerCase();
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (HAN.test(ch)) {
      out.push(ch);
      if (bigrams && i + 1 < n && HAN.test(s[i + 1])) out.push(ch + s[i + 1]);
      i += 1;
    } else if (WORD.test(ch)) {
      let j = i + 1;
      while (j < n && WORD.test(s[j])) j += 1;
      const w = s.slice(i, j);
      if (w.length > 1 || /[0-9]/.test(w)) out.push(w);
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

export function tokenizeUnique(text, opts) {
  return Array.from(new Set(tokenize(text, opts)));
}
