# Scheduling

A scheduled run does the same as a run by hand: it reads `state.json`, does the next step that is due, and stops. Any trigger can repeat without harm.

## The week

```sh
TZ=<team time zone, for example Europe/Berlin> node -e '
const d = new Date(), day = (d.getDay() + 6) % 7;
const until = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
const since = new Date(until.getFullYear(), until.getMonth(), until.getDate() - 7);
const thu = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 3);
const jan4 = new Date(thu.getFullYear(), 0, 4);
const week = 1 + Math.round(((thu - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
console.log(thu.getFullYear() + "-W" + String(week).padStart(2, "0"), since.toISOString(), until.toISOString());'
```

It prints `<week> <since> <until>`: the ISO week of the last full Monday-to-Monday week in that time zone, and its bounds in UTC. Every run during the following week computes the same week, so repeated triggers find the same state.

## state.json

```json
{
  "week": "2026-W02",
  "since": "2026-01-04T23:00:00.000Z",
  "until": "2026-01-11T23:00:00.000Z",
  "first_run": false,
  "status": "diagnosing",
  "active_since": "2026-01-12T09:00:12.000Z",
  "retry_after": null,
  "budget": { "tokens": 3000000, "agreed_by": "alice", "agreed_at": "2026-01-12T09:20:00Z", "used": 0 },
  "tasks": { "verify": { "id": "<task id>", "started_at": "2026-01-12T10:05:00Z" } },
  "restarts": { "collect": 0, "backtest": 0, "verify": 0 },
  "proposals": { "P1": { "status": "waiting", "pr": null } },
  "started_at": "2026-01-12T09:00:12.000Z",
  "updated_at": "2026-01-12T10:05:00.000Z",
  "notes": []
}
```

`status` moves through `collecting`, `measuring`, `diagnosing`, `proposing`, `backtesting`, `verifying` and `reported` to `done`; a first run goes from `diagnosing` to `verifying`. `reported` waits for people to decide on the proposals. `done` means every proposal is decided and every approved one has its PR. `failed` means collecting ran out of restarts, so there is nothing to measure this week.

## Re-entry rules

Every trigger, scheduled or by hand:

1. Compute the week and read `<week>/state.json`. When there is none, create it with `status: collecting`.
2. Status `done` or `failed`: reply with one line and stop.
3. `active_since` less than two hours old: another run is working. Reply with one line and stop. Older than two hours: that run died. Count a restart for its step and take over.
4. `retry_after` in the future: reply with one line and stop.
5. Set `active_since` to now and continue from the status. A step whose output exists and is complete is not done again: `data/prs.jsonl`, `data/metrics.json`, `data/judgments.json`, the proposals, the backtest scorecards, `verify.md`, `report.md`. To redo a step on purpose, delete its output first.
6. Update `updated_at` whenever the state changes, and clear `active_since` when the run stops, finished or waiting.
7. Status `reported`: when people have decided on proposals since, carry out the decisions (SKILL.md, "After a person decides") and set `done` when nothing is left. Otherwise reply with one line: the report waits for decisions.
8. When last week is still `reported`, list its open proposals at the top of this week's report. Do not redo them.

## Workers and restarts

- A step that runs in a subagent or a background task records the task's id in `tasks`. The independent check always runs as its own task, never in the session that wrote the report.
- A task that failed or was lost is restarted at most twice per worker per week; count the restarts in `restarts`. After that, record the step as failed in `notes`, say so in the report, and go on with what exists; only a failed collect stops the week.
- After a model gateway error (HTTP 429 or a 5xx from the model endpoint, a connection reset, a timeout), do not retry at once: the same limit usually answers again. Set `retry_after` to 20 to 30 minutes later and let the next trigger resume.

## Triggers

Start the run at the beginning of the first working day of the week, then trigger it about every 30 minutes for the rest of that day. A trigger with nothing due costs one short reply, and the follow-ups pick up a retry after a gateway error and the steps that a long first run left. With cron: `*/30 9-17 * * 1`, in the time zone of the machine.

Every runner uses the same prompt. Fill in the placeholders and keep it in the working directory, for example as `.mcode-review-tuning/prompt.txt`:

```
Use the pr-review-tuning skill for <project> on <github or gitlab>. The working directory is <repository>/.mcode-review-tuning.
This is an unattended scheduled run: do not wait for confirmation. Read decisions.md and the week's state.json, and do the next step that is due, following the re-entry rules in references/scheduling.md.
Write only inside the working directory. Do not merge, approve, push, comment, or change any repository or CI setting. Never print a token.
Without a standing token budget in decisions.md, skip the backtest.
Finish with three or four sentences: the week's conclusion, the proposals waiting for a decision and the report path; or one line when nothing was due.
```

### MiniMax Code

Create a scheduled task for the repository's directory in MiniMax Code with the prompt above and the schedule above, either from its scheduled tasks view or by asking MiniMax Code in a session in that directory to create one. Then check that the task is listed, run it once by hand, and confirm that `state.json` exists afterwards.

Without the app, use cron with the CLI, which runs one prompt without the interactive interface:

```sh
cd <repository> && mcode exec --cwd . --timeout 2h --input - < .mcode-review-tuning/prompt.txt >> .mcode-review-tuning/cron.log 2>&1
```

Keep its default permission policy, `smart`.

### Claude Code

In the Claude desktop app, create a scheduled task with the prompt and a cron expression; the `lifting-loops` skill of this stack shows the tool flow (`create_scheduled_task`, a trial run with `run_scheduled_task`). Without the app, use cron with print mode, `claude -p "$(cat .mcode-review-tuning/prompt.txt)"`, run in the repository, and allow only the tools the run needs (see `claude --help`): reading files, writing inside the working directory, and running `node`, `git`, `gh` or `glab`.

### Plain cron

```
# m    h    dom mon dow  command
*/30   9-17 *   *   1    cd <repository> && <agent command from above> >> .mcode-review-tuning/cron.log 2>&1
```

- cron runs with a short `PATH`: give full paths to `node` and to the agent CLI, or set `PATH` in the crontab.
- Tokens: `collect.mjs` falls back to `gh auth token` or `glab auth token`, so log those tools in for the user that cron runs as. Never put a token into the crontab or the prompt.
- Check the first scheduled run in `cron.log` and in `state.json`.

## Changing or stopping

Change the time or stop the task where it was created: the scheduled task in MiniMax Code or the Claude app, or the line in the crontab. When you change the prompt, change `prompt.txt` and the task together.
