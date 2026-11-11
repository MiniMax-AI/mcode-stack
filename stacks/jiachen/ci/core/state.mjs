import { packJson, sha256, unpackJson } from './util.mjs';

export const SUMMARY_MARKER = '<!-- mcode-review:summary -->';
const STATE_RE = /<!-- mcode-review:state ([A-Za-z0-9+/=]+) -->/;

export function extractState(body) {
  const match = String(body || '').match(STATE_RE);
  if (!match) return null;
  try {
    return unpackJson(match[1]);
  } catch {
    return null;
  }
}

export function embedState(state) {
  return '<!-- mcode-review:state ' + packJson(state) + ' -->';
}

const CUT = '\n\n…';

function mapFindings(lenses, change) {
  return Object.fromEntries(Object.entries(lenses || {}).map(([lens, entry]) => [lens, entry ? { ...entry, findings: (entry.findings || []).map(change) } : entry]));
}

// The summary comment carries the state, and a host caps a comment's length
// (GitHub at 65,536 characters). When both do not fit, the stored state gives
// way, what the next round misses least first: history before the last rounds,
// then the long texts of the findings (their threads keep them), then the file
// fingerprints of the whole PR, then the per-lens results a later round reuses.
// As a last resort the end of the summary text is cut. Returns the comment body,
// the state it holds, and what was dropped.
export function fitSummary(text, state, limit) {
  const compose = (value, summary = text) => summary + '\n\n' + embedState(value);
  const history = state.history || [];
  const steps = [
    ['history before the last 10 rounds', (value) => ({ ...value, history: history.slice(-10) })],
    ['history before the last 3 rounds', (value) => ({ ...value, history: history.slice(-3) })],
    ['history before this round', (value) => ({ ...value, history: history.slice(-1) })],
    ['the long texts of the findings', (value) => ({ ...value, lenses: mapFindings(value.lenses, ({ body, suggestion, verifier_reason, ...finding }) => ({ ...finding, title: String(finding.title || '').slice(0, 120), related_paths: [] })) })],
    ['the file fingerprints of the PR', (value) => ({ ...value, files: {} })],
    ['the per-lens results kept for reuse', (value) => ({ ...value, lenses: {} })],
  ];
  let current = state;
  let body = compose(current);
  const dropped = [];
  for (const [what, step] of steps) {
    if (body.length <= limit) break;
    current = step(current);
    dropped.push(what);
    body = compose(current);
  }
  if (body.length > limit) {
    const tail = CUT + compose(current, '');
    const kept = text.slice(0, Math.max(0, limit - tail.length));
    const line = kept.lastIndexOf('\n');
    body = (line > 0 ? kept.slice(0, line) : kept) + tail;
    dropped.push('the end of the summary text');
  }
  return { body, state: current, dropped };
}

export function emptyState() {
  return { v: 1, files: {}, lenses: {}, round: 0, consecutive_blocking: 0, quiz: null, history: [] };
}

// Findings keep their id across rounds when path, symbol and class are the
// same, so a reworded title is not reported as a new problem.
export function findingId(path, symbol, cls) {
  return 'F-' + sha256([path, symbol || '', cls].join('|')).slice(0, 6);
}

// Decide per lens which files need a fresh review. A source (published state or
// a lens artifact from a cancelled run) can be reused for a file only when the
// file's net diff fingerprint is unchanged.
export function planReuse(lens, currentFiles, sources) {
  const current = new Map(currentFiles.map((file) => [file.path, file.fp]));
  const reused = new Map();
  for (const source of sources) {
    if (!source || source.lens !== lens || source.status !== 'complete') continue;
    for (const [file, fp] of Object.entries(source.files || {})) {
      if (current.get(file) === fp && !reused.has(file)) reused.set(file, source);
    }
  }
  const reviewFiles = [...current.keys()].filter((file) => !reused.has(file));
  const reusedFindings = [];
  const recheck = [];
  for (const source of new Set(reused.values())) {
    for (const finding of source.findings || []) {
      const paths = [finding.path, ...(finding.related_paths || [])].filter(Boolean);
      const allReused = paths.every((file) => reused.get(file) === source || !current.has(file));
      if (reused.get(finding.path) === source && allReused) reusedFindings.push(finding);
      else if (current.has(finding.path)) recheck.push(finding);
    }
  }
  for (const source of sources) {
    if (!source || source.lens !== lens) continue;
    for (const finding of source.findings || []) {
      if (reviewFiles.includes(finding.path) && !recheck.some((item) => item.id === finding.id)) recheck.push(finding);
    }
  }
  return { reviewFiles, reusedFiles: [...reused.keys()], reusedFindings: dedupe(reusedFindings), recheck: dedupe(recheck) };
}

function dedupe(findings) {
  const seen = new Map();
  for (const finding of findings) if (!seen.has(finding.id)) seen.set(finding.id, finding);
  return [...seen.values()];
}
