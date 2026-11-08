/** Keyword fallbacks used when AI is off (and unit-tested): language, mood, urgency, category. */
export function detectLanguage(text: string): string | null {
  const ar = (text.match(/[؀-ۿ]/g) || []).length; const letters = (text.match(/\p{L}/gu) || []).length || 1;
  if (ar / letters > 0.3) return /[پچژگٹڈڑںھہے]/.test(text) ? 'Urdu' : 'Arabic';
  if ((text.match(/[ऀ-ॿ]/g) || []).length / letters > 0.3) return 'Hindi';
  if (/\b(bonjour|merci|problème|s'il vous plaît)\b/i.test(text)) return 'French';
  return 'English';
}
const NEG = /\b(unacceptable|frustrat\w*|angry|disappoint\w*|terrible|worst|ridiculous|furious|useless|waste of|not happy|very bad|complain\w*|escalate this|still not (fixed|working|resolved)|(second|third|fourth) time|no one (has )?(replied|responded)|nobody (has )?(replied|responded)|cancel (our|the) contract|legal action)\b|!!!|\?\?\?/i;
const POS = /\b(thank(s| you)|great|appreciate\w*|perfect|works now|resolved now|excellent|awesome)\b/i;
export function heuristicSentiment(text: string): 'negative' | 'neutral' | 'positive' {
  if (NEG.test(text)) return 'negative'; if (POS.test(text)) return 'positive'; return 'neutral';
}
export function heuristicPriority(text: string): 'Urgent' | 'High' | null {
  if (/\b(outage|down for (all|everyone)|all (users|endpoints|machines)|production (is )?down|ransomware|breach(ed)?|critical|urgent\w*|asap|emergency)\b/i.test(text)) return 'Urgent';
  if (/\b(not working|cannot (log ?in|access|activate)|can't (log ?in|access|activate)|blocked|error \d{3}|crash\w*)\b/i.test(text)) return 'High';
  return null;
}
const CAT_WORDS: [RegExp, string][] = [
  [/\b(licen[cs]e|activation|activate|key|seats?|expir\w*)\b/i, 'Licensing'], [/\b(install\w*|deploy\w*|setup|set up|upgrade to version)\b/i, 'Installation'],
  [/\b(invoice|billing|payment|refund|credit note|quotation|quote|price)\b/i, 'Billing'], [/\b(bug|crash\w*|error|exception|not working)\b/i, 'Bug'],
  [/\b(configur\w*|policy|settings?|rule|whitelist|exclusion)\b/i, 'Configuration'], [/\b(training|how (do|to)|guide|documentation)\b/i, 'Training'],
];
export function heuristicCategory(text: string, allowed: string[]): string | null {
  for (const [re, c] of CAT_WORDS) if (re.test(text) && allowed.includes(c)) return c;
  return null;
}
