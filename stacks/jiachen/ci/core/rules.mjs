import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeProfiles } from './triage.mjs';
import { ConfigError, run } from './util.mjs';

// A project keeps its own review rules in its repository root: a rule pack with
// the keys of ci/config/repos/*.json, and notes on the failure patterns it has
// seen, in the format of skills/pr-review/references/repos/example.md. CI reads
// both from the merge base, as it treats agent instruction files, so a PR
// cannot change the rules that review it. Without a merge base (the grade job)
// they come from the checkout. MCODE_REVIEW_PROFILE_FILE and
// MCODE_REVIEW_NOTES_FILE replace them, for backtests of candidate rules.
export const RULE_PACK_FILE = '.mcode-review.json';
export const NOTES_FILE = '.mcode-review.md';

const KEY_TYPES = { name: 'string', risk_areas: 'list', stacks: 'list', ui_globs: 'list', generated_globs: 'list', tier_thresholds: 'object', quiz: 'object' };

function typeOf(value) {
  if (Array.isArray(value)) return 'list';
  return value === null ? 'null' : typeof value;
}

// override: a file path, relative to cwd. base: a commit, or null for the
// working tree.
function readSource({ cwd, base, override, file, variable }) {
  if (override) {
    const full = path.resolve(cwd, override);
    if (!existsSync(full)) throw new ConfigError(variable + ' is ' + override + ', which does not exist.');
    return { text: readFileSync(full, 'utf8'), source: override };
  }
  if (base) {
    const result = run('git', ['show', base + ':' + file], { cwd, allowFail: true });
    return result.code === 0 ? { text: result.stdout, source: file + ' at ' + String(base).slice(0, 10) } : null;
  }
  const full = path.join(cwd, file);
  return existsSync(full) ? { text: readFileSync(full, 'utf8'), source: file } : null;
}

// The rule pack of a file's text: the known keys of the right type. Anything
// else is left out with a line in the log; a file that does not parse leaves the
// bundled rule pack in force.
export function parseRulePack(text, source, warn = () => {}) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    warn(source + ' does not parse (' + String(error.message).slice(0, 160) + '); using the bundled rule pack');
    return null;
  }
  if (typeOf(value) !== 'object') {
    warn(source + ' is not a JSON object; using the bundled rule pack');
    return null;
  }
  const pack = {};
  for (const [key, item] of Object.entries(value)) {
    const want = KEY_TYPES[key];
    if (!want) warn(source + ': ignoring the unknown key ' + key);
    else if (typeOf(item) !== want) warn(source + ': ignoring ' + key + ', which must be ' + (want === 'list' ? 'a list' : 'an ' + want) + ', not ' + (typeOf(item) === 'list' ? 'a list' : typeOf(item)));
    else pack[key] = item;
  }
  return pack;
}

export function readRulePack({ cwd, base = null, profileFile = '', notesFile = '', warn = () => {} }) {
  const pack = readSource({ cwd, base, override: profileFile, file: RULE_PACK_FILE, variable: 'MCODE_REVIEW_PROFILE_FILE' });
  const notes = readSource({ cwd, base, override: notesFile, file: NOTES_FILE, variable: 'MCODE_REVIEW_NOTES_FILE' });
  return {
    profile: pack ? parseRulePack(pack.text, pack.source, warn) : null,
    notes: notes && notes.text.trim() ? notes.text : null,
    sources: { profile: pack?.source || null, notes: notes?.source || null },
  };
}

// The project's rule pack goes over the bundled one key by key, as a bundled
// profile goes over default.json.
export function applyRulePack(profile, pack) {
  return pack ? mergeProfiles(profile, pack) : profile;
}
