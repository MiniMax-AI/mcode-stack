# jiachen

The stack of Jiachen, an engineer on MiniMax Code: one skill that keeps
taking the user out of the agent loop, and one that turns notes into posts and
short videos.

| Skill | What it does |
| --- | --- |
| [`lifting-loops`](skills/lifting-loops/SKILL.md) | Find the loops where you keep acting as a manual step for your agents (retrying, judging output, approving, carrying context, starting the same task by hand) and turn each one into a concrete fix: delete a stale rule, change a skill or `AGENTS.md`, add a script, a skill or a scheduled task. Reads local MiniMax Code, Claude Code and Codex sessions; keeps its ledger in a gitignored `private/` folder. |
| [`making-content`](skills/making-content/SKILL.md) | Rewrite an AI-sounding Chinese draft in a restrained voice, make a Xiaohongshu (小红书) image post from scratch, or turn material into a 60–180 s vertical video with real sources, voice-over and captions. |

## Requirements

- `lifting-loops`: Python 3, standard library only.
- `making-content`: text rewriting needs nothing. Video needs Python 3 with
  `pip install -r skills/making-content/requirements.txt`, Playwright's
  Chromium, `ffmpeg` and a CJK font; see
  [`video-pipeline.md`](skills/making-content/references/video-pipeline.md).
  A cloned voice is optional and needs the user's own Volcengine key.

Personal samples stay local: `making-content` reads before/after samples from
a gitignored `test-cases/` folder, and `lifting-loops` writes everything it
learns about you to a gitignored `private/` folder.

How these fit into a working day: [`WORKFLOW.md`](WORKFLOW.md).
