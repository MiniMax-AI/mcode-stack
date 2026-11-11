// Values the output schemas describe for the model. They are not schema enums:
// mcode rejects a whole answer when one field misses an enum, which threw away a
// lens's review for one unexpected word. review.mjs maps an unexpected value to a
// default where it reads the answer (pickValue) and logs it.
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const FINDING_TYPES = ['defect', 'leftover', 'maintainability'];
export const FINDING_CLASSES = [
  'behavior-regression', 'error-handling', 'fail-open-violation', 'retry-semantics', 'concurrency', 'lifecycle-resource',
  'persistence-migration', 'data-loss', 'contract-break', 'config-default', 'compat-rollout', 'security', 'permission-auth',
  'injection', 'parallel-impl-missed', 'duplicate-implementation', 'over-engineering', 'cross-feature-impact', 'performance',
  'ui-layout', 'test-gap', 'observability', 'other',
];
export const MAINTAINABILITY_CLASSES = ['duplicate-implementation', 'over-engineering', 'test-gap'];
export const INTRODUCED = ['this_mr', 'pre_existing', 'unknown'];
export const NEEDS_HUMAN_KINDS = ['design_direction', 'weak_evidence_high_impact', 'background_job', 'deny_list_or_allowlist', 'deploy_prerequisite', 'large_feature', 'other'];
export const CLAIM_STATUSES = ['verified', 'refuted', 'unverified'];
export const VERIFY_VERDICTS = ['confirmed', 'rejected', 'uncertain'];
// What an author quiz question probes (see core/quiz.mjs).
export const QUIZ_DIMENSIONS = ['design-intent', 'impact-surface', 'boundary', 'failure-mode'];

// The allowed value that matches, ignoring case and surrounding space, or null.
export function matchValue(value, allowed) {
  const text = String(value ?? '').trim().toLowerCase();
  return allowed.find((item) => item.toLowerCase() === text) ?? null;
}
