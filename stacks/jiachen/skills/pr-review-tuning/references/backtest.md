# Backtest

Run the CI review on past PRs whose outcome is known: once with the current rules, once with each candidate. Compare what each run found and what it cost.

## Cases

`proposals/cases.jsonl`, one line per case:

```json
{"number": 123, "expect": "catch", "truth": "what the later fix PR says was wrong", "fix": 130, "files": ["src/billing/charge.ts"]}
{"number": 141, "expect": "clean", "truth": "", "fix": null, "files": []}
```

- **catch** cases come from follow-up pairs you judged missed or ignored, where the problem was visible in the earlier PR's diff. `number` is the earlier PR, `truth` what the fix PR says was wrong, `fix` the fix PR, and `files` the files where the problem was.
- **clean** cases are merged PRs of similar size with no follow-up fix within two weeks and no finding that people fixed. They measure noise: every thread on a clean case is a cost.
- Pick cases that exercise the proposal: a change to rule questions needs PRs that touch risk paths, a change to one direction needs PRs of a tier that runs it. Start small, with 4 to 8 catch cases and about as many clean ones, spread over tiers.

## Budget

Agree on the budget with a person before running anything.

1. Estimate: for each case, the median tokens per round of its tier (`cost.by_tier` in `metrics.json`), added up over the cases and multiplied by the number of arms (the current rules plus each candidate). Add a margin, because a case that is already running finishes after the budget is reached.
2. Show the estimate, the cases and the arms to a person, and record the budget they agree to in `state.json`. A scheduled run uses the standing budget in `decisions.md`, or skips the backtest when there is none.
3. Split the budget over the arms and pass each share as `--budget`. `backtest.mjs` stops starting new cases when its budget is used up.

## Running

```sh
node scripts/backtest.mjs --host <host> --project <project> --repo <local clone> --cases <week>/proposals/cases.jsonl \
  --plugin <stack dir> --profile <rules>/.mcode-review.json --notes <rules>/.mcode-review.md --lang <en|zh> \
  --budget <tokens> --out <week>/proposals/backtest/<arm>
```

- `--repo`: a local clone of the repository with its full history; the script makes isolated clones from it.
- `--plugin`: the plugin directory, `stacks/jiachen` of a mcode-stack checkout at the commit CI pins. For a proposal that changes the plugin, a copy with the change.
- Baseline arm: `--profile` and `--notes` point at the repository's current `.mcode-review.json` and `.mcode-review.md`, copied from the default branch, so the baseline is today's rules and not each case's merge base. Leave out a flag whose file does not exist.
- Candidate arm: `--profile` and `--notes` point at `proposals/P<n>/`.
- Every arm uses the same cases, the same `--lang` and the same plugin commit, except where the proposal changes the plugin.
- The review calls the model as CI does, with the same model key and endpoint (`MCODE_REVIEW_API_KEY`, `MCODE_REVIEW_BASE_URL`) in the environment. Take them from the user's secret store; never print them.

Each case leaves `<out>/<n>/` with `plan.json`, `lens-*.json`, `summary.md` and `verdict.json`, and each arm a `scorecard.json` and `scorecard.md` with tokens, minutes, verdict and findings per case.

## Judging

Read each case's `summary.md` and `lens-*.json`:

- A catch case is **caught** when a finding or question names the problem in `truth`: the same file, or one in `files`, and the same failure, at any severity. Note whether it would have blocked: P0 or P1, and at evidence level 4, or level 3 confirmed by the verifier. The right file with a different failure is a miss; note it.
- A clean case: count the threads and judge each one as a real problem or as noise.
- Record per case and arm: verdict, caught or missed, threads, tokens, minutes. Write the judgments to `proposals/backtest/judgments.json` and the comparison into the proposal.

## Reading the result

- Report counts ("caught 3 of 6 against 2 of 6"), the cases that flipped between arms and why, and the tokens and minutes of each arm. No significance claims at this size.
- A model review is not deterministic. When the budget allows, run the baseline twice on the same cases and count the flips with no change at all; a candidate has to beat that noise.
- A candidate that catches more and also adds noise on clean cases trades fewer follow-up fixes against fewer threads per PR. Say so in the proposal.
