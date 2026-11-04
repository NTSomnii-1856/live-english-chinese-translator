// Small, deterministic classroom filter. Match English words, not substrings of
// ordinary words such as "class", "assignment", or "Scunthorpe". Biology terms
// are deliberately not included. No text is sent to an external service.
const englishWords = [
  'fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fuckers',
  'motherfucker', 'motherfuckers', 'motherfucking',
  'shit', 'shits', 'shitting', 'shitty', 'shithead', 'shitheads', 'bullshit',
  'bitch', 'bitches', 'bitching', 'bitchy', 'sonofabitch',
  'asshole', 'assholes', 'arsehole', 'arseholes', 'bastard', 'bastards',
  'dickhead', 'dickheads', 'dumbass', 'dumbasses', 'jackass', 'jackasses',
  'cunt', 'cunts', 'wanker', 'wankers', 'twat', 'twats',
  'damn', 'damned', 'goddamn', 'goddamned', 'crap', 'crappy',
  'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots',
];
const substitutions = { a: '[a@4]', b: '[b8]', e: '[e3]', i: '[i!1]', o: '[o0]', s: '[s$5]', t: '[t7]' };
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = englishWords.sort((a, b) => b.length - a.length).map(word =>
  [...word].map((letter, index) => {
    const pattern = substitutions[letter] || letter;
    if (!index) return pattern;
    return pattern.startsWith('[') ? pattern.slice(0, -1) + '*]' : `[${pattern}*]`;
  }).join('')
).join('|');
// Chrome's speech service can already obscure swearing as f*** or s***.
const english = new RegExp(`(?<![a-z0-9_])(?:${wordPattern}|f\\*{2,}|s\\*{2,}|b\\*{3,}|a\\*{3,}|f[u*#]c?[k*]|sh[i*]t)(?:['’]s)?(?![a-z0-9_])`, 'gi');
const chineseWords = [
  '去你妈的', '去你媽的', '操你妈', '操你媽', '肏你妈', '肏你媽',
  '干你妈', '幹你媽', '日你妈', '日你媽', '你妈逼', '你媽逼',
  '他妈的', '他媽的', '她妈的', '她媽的', '妈的', '媽的', '他娘的',
  '狗娘养的', '狗娘養的', '狗日的', '王八蛋', '狗屎',
  '傻逼', '傻屌', '傻B', '傻b', '牛逼', '婊子', '贱货', '賤貨', '混蛋',
];
const chinese = new RegExp(chineseWords.sort((a, b) => b.length - a.length).map(escaped).join('|'), 'g');
const marker = '***';

function matches(text) {
  return [...text.matchAll(new RegExp(english)), ...text.matchAll(new RegExp(chinese))];
}

export function sanitizeCaption(text) {
  return String(text ?? '').replace(new RegExp(english), marker).replace(new RegExp(chinese), marker);
}

// Append-only streaming output: keep an unfinished English word or a possible
// Chinese profanity prefix private until it can be decided. This prevents a
// swear word appearing briefly when a model splits it between token deltas.
export function createCaptionFilter() {
  let buffer = '', finished = false;
  return {
    push(delta) {
      if (finished) throw new Error('Caption filter is already finished.');
      buffer += String(delta ?? '');
      let cut = buffer.length;
      const token = /[a-zA-Z0-9_@#$!*'’]+$/u.exec(buffer);
      if (token) cut = token.index;
      for (const word of chineseWords) {
        for (let length = 1; length < word.length; length++) {
          if (buffer.endsWith(word.slice(0, length))) cut = Math.min(cut, buffer.length - length);
        }
      }
      if (/[\uD800-\uDBFF]$/.test(buffer)) cut = Math.min(cut, buffer.length - 1);
      // A mixed-language match such as 傻B must not be split at its Latin suffix.
      for (const match of matches(buffer)) {
        if (match.index < cut && match.index + match[0].length > cut) cut = match.index;
      }
      const ready = sanitizeCaption(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
      return ready;
    },
    finish() {
      if (finished) return '';
      finished = true;
      const ready = sanitizeCaption(buffer);
      buffer = '';
      return ready;
    },
  };
}
