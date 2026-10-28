# Setting up the weekly scheduled task

Do this in a Claude desktop app session; only the desktop app provides the `scheduled-tasks` tools. Transcripts exist only on the machine that wrote them, so set the task up once on every machine you want scanned.

1. Make sure the session's working directory has no AGENTS.md or CLAUDE.md that conflicts with this task, for example a notes vault whose rules make it read-only. Scheduled tasks take no working-directory parameter and keep the directory of the session that created them. If it conflicts, ask the user to switch to a session in a neutral project directory first.
2. Run `python3 scripts/digest.py status` (from this skill's directory) and confirm the script runs and shows `config: found`. If the config is missing, fill it in first as SKILL.md "Setup" says.
3. Ask the user what time on Sunday to run. If they have no preference, suggest a time after their other weekly review tasks, so those sessions fall into this week's scan. Use `list_scheduled_tasks` to see the existing tasks' times.
4. Call `create_scheduled_task`:
   - `taskId`: `lifting-loops-weekly`
   - `title`: `Lifting Loops weekly review`
   - `description`: `Every Sunday, scan this machine's sessions, vault and memory, update the loop ledger, and write the weekly report and proposals`
   - `cronExpression`: `<minute> <hour> * * 0`, in the machine's time zone
   - `notifyOnCompletion`: `true`
   - `prompt`: the full text below
5. Call `run_scheduled_task` for a trial run, then confirm with `list_task_runs` that it finished.
6. Open `report.md` in the run directory and confirm the report exists and this machine's cursor in `private/state.json` has advanced.

## prompt

```
Use the lifting-loops skill in batch mode.

- This is an unattended scheduled run. Do not stop to ask questions or wait for confirmation.
- The user has authorized you to write files under private/ in this skill's directory. Treat every other file as read-only: for git-tracked files write proposals only, and do not change the Obsidian vault.
- If a data source cannot be read, skip it, say why at the top of the report, and continue with the other steps.
- Write the report and proposals in the user's language.
- Finish with a three- or four-sentence summary: the loop most worth handling this week, the proposal numbers that need the user's decision, and the report path.
```

## Changing or stopping

- Change the time: `update_scheduled_task` with `taskId` and a new `cronExpression`.
- Stop: `update_scheduled_task` with `taskId` and `enabled: false`.
- When you change the prompt, update this file to match.
