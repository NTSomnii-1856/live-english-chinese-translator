import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCaption, createCaptionFilter } from './caption-filter.mjs';

test('filters complete English words, common variants, and obscured speech results', () => {
  assert.equal(sanitizeCaption('That FUCKING thing is sh1t, b!tch. f*** s*** f*ck sh*t.'), 'That *** thing is ***, ***. *** *** *** ***.');
  assert.equal(sanitizeCaption("That bastard's crap is bullshit."), 'That *** *** is ***.');
  assert.equal(sanitizeCaption('f*cking b*tches sh***y'), '*** *** ***');
});

test('preserves innocent substrings, names, and legitimate classroom biology terms', () => {
  const text = 'The class assignment has an assistant in Scunthorpe. Discuss classic passages, fertilization, sperm, eggs and reproduction.';
  assert.equal(sanitizeCaption(text), text);
  assert.equal(sanitizeCaption('The water cycle includes condensation.'), 'The water cycle includes condensation.');
});

test('filters common Simplified Chinese swearing without hiding ordinary teaching text', () => {
  assert.equal(sanitizeCaption('他妈的，别说傻逼或操你妈。'), '***，别说***或***。');
  assert.equal(sanitizeCaption('操作系统需要干净的水。妈妈说打开课本。'), '操作系统需要干净的水。妈妈说打开课本。');
});

test('English swear words never leak when split between streaming deltas', () => {
  const filter = createCaptionFilter();
  assert.equal(filter.push('Please fu'), 'Please ');
  assert.equal(filter.push('ck'), '');
  assert.equal(filter.push('ing stop. '), '*** stop. ');
  assert.equal(filter.finish(), '');
  assert.equal(filter.finish(), '');
});

test('Chinese profanity prefixes and mixed-script swearing stay private across deltas', () => {
  const filter = createCaptionFilter();
  assert.equal(filter.push('请不要说操'), '请不要说');
  assert.equal(filter.push('你'), '');
  assert.equal(filter.push('妈。傻B'), '***。');
  assert.equal(filter.push('！现在打开书。'), '***！现在打开书。');
  assert.equal(filter.finish(), '');
});

test('safe text streams immediately; final unfinished benign words are released', () => {
  const filter = createCaptionFilter();
  assert.equal(filter.push('水循环包括蒸发。'), '水循环包括蒸发。');
  assert.equal(filter.push('Please open'), 'Please ');
  assert.equal(filter.finish(), 'open');
  assert.throws(() => filter.push('later'), /finished/);
});

test('streaming at every character boundary agrees with filtering a completed caption', () => {
  for (const text of [
    'The class assignment is not bullshit. Please stop fucking swearing.',
    "F***! The bastard's f*cking sh*t is b!tchy.",
    '他妈的不要说操你妈，打开课本，傻B！操作系统。',
    '中文fuck中文 motherfucker. 🧑‍🎓',
  ]) {
    const filter = createCaptionFilter();
    const output = [...text].map(char => filter.push(char)).join('') + filter.finish();
    assert.equal(output, sanitizeCaption(text), text);
  }
});
