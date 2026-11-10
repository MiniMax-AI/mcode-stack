import { sha256 } from './util.mjs';

// A model arm is one pair of model chains: the models that look for problems
// (lens) and the models that check them (verify). Each PR gets one arm for all
// its rounds, so one PR never mixes findings from two arms. The arm comes from a
// hash of the PR number: over many PRs the split follows the weights, and it does
// not depend on the order PRs arrive in. No arms means the role chains apply.
export function pickArm(arms, iid) {
  const list = (arms || []).filter((arm) => Number(arm.weight) > 0);
  if (!list.length) return null;
  const total = list.reduce((sum, arm) => sum + Number(arm.weight), 0);
  let point = parseInt(sha256('arm:' + iid).slice(0, 8), 16) % total;
  for (const arm of list) {
    if (point < Number(arm.weight)) return arm;
    point -= Number(arm.weight);
  }
  return list[list.length - 1];
}
