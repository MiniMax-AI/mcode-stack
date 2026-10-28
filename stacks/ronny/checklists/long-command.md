# Checklist: long shell commands in an agent

From MCode Engineering Notes 04. Skill version: `skills/long-command-check`.

| Item | Ask yourself |
| --- | --- |
| Foreground limit | How long does the foreground wait at most? Compared with the cache lifetime of your model service, is there enough margin? |
| No re-run | Moving from foreground to background: same process, or killed and restarted? |
| Timeout accounting | After moving to background and reading output, is the deadline reset? |
| Result delivery | When a background task finishes, does the model learn it from a notification or by polling? |
| Notification position | Is the notification appended at the end, or does it modify an already cached prefix? |
| Anti-polling | Is blocking wait time capped, and is there a hint on repeated reads with no change? |
| Output size | Is large output truncated or written to a file, or pasted whole into context? |
| Cleanup | When the user stops, the process exits, or the process restarts, who cleans up background tasks? |
| After compaction | Can "a result nobody has read yet" still be found after compaction? |
| Precondition | If the current environment cannot read background results, is backgrounding still allowed? |
