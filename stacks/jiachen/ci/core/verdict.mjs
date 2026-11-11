const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 9;
}

export function isBlocking(finding) {
  if (!['P0', 'P1'].includes(finding.severity)) return false;
  if (finding.introduced === 'pre_existing') return false;
  const level = Number(finding.evidence_level || 0);
  return level >= 4 || (level >= 3 && finding.verifier === 'confirmed');
}

// Deterministic verdict. needs_human after three consecutive blocking rounds
// replaces request_changes: the loop goes to a person instead of the agents. A
// round with unfinished lenses cannot pass: nobody looked at part of the change.
export function computeVerdict({ findings, needsHuman, consecutiveBlocking, incomplete = 0 }) {
  const blocking = findings.filter(isBlocking);
  const attention = needsHuman.filter((item) => !item.resolved);
  let verdict = 'pass';
  if (consecutiveBlocking >= 3) verdict = 'needs_human';
  else if (blocking.length) verdict = 'request_changes';
  else if (attention.length || incomplete) verdict = 'needs_human';
  const exitCode = verdict === 'pass' ? 0 : verdict === 'request_changes' ? 10 : 11;
  return { verdict, exitCode, blocking, attention };
}

// Different lenses often report one problem under different classes. The same
// path, line and symbol is the same spot, so the summary keeps one copy: the most
// severe, then the best evidenced. Only for results of different lenses; one lens
// that reports two problems at one spot meant two problems.
export function dedupeSpots(findings) {
  const better = (a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.evidence_level || 0) - (a.evidence_level || 0) || String(a.id).localeCompare(String(b.id));
  const kept = new Map();
  const result = [];
  for (const finding of [...findings].sort(better)) {
    const spot = finding.symbol ? [finding.path, finding.line, finding.symbol].join(':') : '';
    const winner = spot && kept.get(spot);
    if (winner && winner.lens !== finding.lens) {
      winner.also = [...(winner.also || []), finding.id];
      continue;
    }
    const copy = { ...finding };
    if (spot && !winner) kept.set(spot, copy);
    result.push(copy);
  }
  return result.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(a.path).localeCompare(String(b.path)));
}

// A finding first reported this round, on a line the latest pushes did not
// touch since its lens last finished a review, was in code that lens had
// already reviewed: it was found late. A lens missing from delta.lenses has no
// finished review to compare with. Files missing from a lens's lines did not
// change since that review.
export function markFoundLate(findings, reportedBefore, delta) {
  if (!delta?.lenses) return findings;
  return findings.map((finding) => {
    const since = delta.lenses[finding.lens];
    if (!since || reportedBefore.has(finding.id) || !finding.line) return finding;
    const lines = since.lines[finding.path];
    if (lines && lines.includes(finding.line)) return finding;
    return { ...finding, found_late: true };
  });
}

// A round is one pipeline whose every lens finished after calling a model. A
// publish job retried in the same pipeline must not count that round twice.
export function nextRound(state, pipelineId, { modelCalled, complete, blocking }) {
  const round = state.round || 0;
  const consecutive = state.consecutive_blocking || 0;
  if (!modelCalled || !complete || state.pipeline_id === pipelineId) return { round, consecutive };
  return { round: round + 1, consecutive: blocking ? consecutive + 1 : 0 };
}

// Lenses run in parallel and often raise one question about the same files.
// The same kind with the same files (identical, or at least two in common)
// counts as one question; the questions of every copy are kept.
export function sameQuestion(a, b) {
  if (a.kind !== b.kind || !a.paths?.length || !b.paths?.length) return false;
  const shared = a.paths.filter((file) => b.paths.includes(file)).length;
  return shared >= 2 || (shared === a.paths.length && shared === b.paths.length);
}

export function mergeNeedsHuman(items) {
  const merged = [];
  for (const item of items) {
    if (merged.some((existing) => existing.id === item.id)) continue;
    const twin = item.lens && merged.find((existing) => existing.lens && existing.lens !== item.lens && sameQuestion(existing, item));
    if (!twin) {
      merged.push({ ...item });
      continue;
    }
    twin.questions = [...new Set([...(twin.questions || []), ...(item.questions || [])])].slice(0, 6);
    twin.paths = [...new Set([...twin.paths, ...item.paths])].slice(0, 20);
    twin.also = [...(twin.also || []), item.id];
  }
  return merged;
}

export function mergeFindings(lists) {
  const byId = new Map();
  for (const finding of lists.flat()) {
    const existing = byId.get(finding.id);
    if (!existing || severityRank(finding.severity) < severityRank(existing.severity)) byId.set(finding.id, finding);
  }
  return [...byId.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(a.path).localeCompare(String(b.path)));
}
