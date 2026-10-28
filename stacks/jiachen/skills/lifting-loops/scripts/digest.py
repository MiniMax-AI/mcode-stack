#!/usr/bin/env python3
"""Compress local agent sessions and notes into digests for lifting-loops.

  digest.py scan [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--sources a,b]
      Write one digest-<source>.md per source into private/runs/<date>-<host>/
      and print where they are. Only human turns are kept: tool output and
      fetched pages never reach the digest.
  digest.py mark <run-dir>
      Advance the cursors in private/state.json to the window of that run.
  digest.py status
      Print the config, the cursors, and which sources exist on this machine.

Session sources (claude, omp, pi, codex, minimax, memory) are per machine, so their
cursors are kept per host. The vault and the claude.ai export may be shared
across machines through a synced folder, so their cursors are global. Standard library only.
"""

import argparse
import datetime as dt
import functools
import json
import os
import re
import socket
import sqlite3
import sys
from pathlib import Path

HOME = Path.home()
SKILL_DIR = Path(__file__).resolve().parent.parent
PRIVATE = SKILL_DIR / "private"
CONFIG_PATH = PRIVATE / "config.json"
STATE_PATH = PRIVATE / "state.json"

SESSION_SOURCES = ["claude", "omp", "pi", "codex", "minimax"]
GLOBAL_SOURCES = ["vault", "claudeai"]
ALL_SOURCES = SESSION_SOURCES + ["memory"] + GLOBAL_SOURCES

# Enough to recognise a task from its opening prompt and a correction from a
# follow-up; the agent opens the session file when it needs more.
FIRST_PROMPT_CHARS = 400
TURN_CHARS = 240
MAX_TURNS = 20
# Three runs of the same opening prompt is where a loop starts to show.
RECURRING_MIN = 3

RETRY_RE = re.compile(
    r"^(try again|retry|again|continue|go on|继续|重试|再试一次|再试试)[\s。.!！?？…]*$",
    re.IGNORECASE,
)
SKIP_PREFIXES = (
    "<local-command",
    "<system-reminder",
    "<task-notification",
    "<bash-stdout",
    "<bash-stderr",
    "Caveat:",
    "<environment_context",
    "# AGENTS.md instructions",
    "<INSTRUCTIONS>",
)
# Codex wraps everything it injects into the user role in a lowercase tag.
CODEX_INJECTED_RE = re.compile(r"^<[a-z_]+>")
# Built-in commands say nothing about the task, so they never open a session.
BUILTIN_COMMANDS = {
    "/model", "/clear", "/resume", "/config", "/login", "/logout", "/effort",
    "/fast", "/status", "/cost", "/compact", "/permissions", "/mcp", "/plugin",
    "/help", "/exit", "/context", "/usage", "/init", "/memory",
}


# Notes whose first lines match this were written by an agent; override with
# vault_ai_marker in config.json.
AI_NOTE_DEFAULT = r"^>.*(Author:.*\(AI\)|\(AI generated\))"


def host():
    return socket.gethostname().split(".")[0]


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def load_config():
    cfg = {
        "vault": None,
        "vault_exclude": [],
        "vault_full_history": [],
        "vault_ai_marker": AI_NOTE_DEFAULT,
        "claudeai_backup": None,
        "first_run_days": 90,
    }
    cfg.update(load_json(CONFIG_PATH, {}))
    for key in ("vault", "claudeai_backup"):
        if cfg[key]:
            cfg[key] = Path(os.path.expanduser(cfg[key]))
    return cfg


def parse_ts(value):
    """Parse ISO timestamps (with Z) and epoch millis into aware datetimes."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc)
    text = str(value).replace("Z", "+00:00")
    # Python < 3.11 rejects fractions that are not 3 or 6 digits.
    text = re.sub(r"\.(\d{6})\d+", r".\1", text)
    try:
        ts = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=dt.timezone.utc)


def day(ts):
    return ts.astimezone().strftime("%Y-%m-%d")


def local_midnight(text):
    return dt.datetime.strptime(text, "%Y-%m-%d").astimezone()


def tilde(path):
    path = str(path)
    home = str(HOME)
    return "~" + path[len(home):] if path.startswith(home) else path


def clip(text, limit):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def clean_turn(text):
    """Turn a raw user message into a digest line, or None to drop it."""
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.DOTALL)
    # Context the user attached by hand is a sign of carrying context, keep a marker.
    text = re.sub(r"<user-provided-context>.*?</user-provided-context>", " [attached context]",
                  text, flags=re.DOTALL)
    text = text.strip()
    if not text or text.startswith(SKIP_PREFIXES):
        return None
    match = re.match(r'<scheduled-task name="([^"]+)"', text)
    if match:
        return f"[scheduled-task {match.group(1)}]"
    if text.startswith(("<command-name>", "<command-message>")):
        name = re.search(r"<command-name>(.*?)</command-name>", text, re.DOTALL)
        args = re.search(r"<command-args>(.*?)</command-args>", text, re.DOTALL)
        line = (name.group(1) if name else "/?").strip()
        if args and args.group(1).strip():
            line += " " + args.group(1).strip()
        return line
    if text.startswith("<bash-input>"):
        return "! " + re.sub(r"</?bash-input>", "", text)
    if text.startswith("[Request interrupted by user"):
        return "[interrupted]"
    return text


class Session:
    def __init__(self, source, path):
        self.source = source
        self.path = path
        self.id = path.stem
        self.cwd = None
        self.title = None
        self.kind = "interactive"
        self.first = None
        self.last = None
        self.turns = []
        # (timestamp, line) per turn; copies made by resuming keep both.
        self.keys = []
        self.tool_errors = 0

    def stamp(self, value):
        ts = parse_ts(value)
        if ts:
            self.first = ts if self.first is None or ts < self.first else self.first
            self.last = ts if self.last is None or ts > self.last else self.last

    def push(self, line, ts):
        self.turns.append(line)
        self.keys.append((str(ts), line))

    def add_turn(self, raw, ts):
        line = clean_turn(raw)
        if line:
            self.push(line, ts)

    def finish(self):
        if self.turns and self.turns[0].startswith(("[scheduled-task", "Automation:")):
            self.kind = "scheduled"
        return self

    @property
    def opening(self):
        for turn in self.turns:
            if turn.split(" ")[0] not in BUILTIN_COMMANDS:
                return turn
        return self.turns[0]

    @property
    def followups(self):
        turns = list(self.turns)
        turns.remove(self.opening)
        return turns

    @property
    def retries(self):
        return sum(1 for t in self.followups if RETRY_RE.match(t))

    @property
    def interrupts(self):
        return sum(1 for t in self.turns if t == "[interrupted]")


def iter_jsonl(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return


def parse_claude(path):
    s = Session("claude", path)
    for d in iter_jsonl(path):
        s.stamp(d.get("timestamp"))
        s.cwd = s.cwd or d.get("cwd")
        kind = d.get("type")
        if kind == "ai-title":
            s.title = d.get("aiTitle")
        if kind != "user" or d.get("isMeta") or d.get("isSidechain"):
            continue
        if d.get("entrypoint", "").startswith("sdk"):
            s.kind = "headless"
        content = (d.get("message") or {}).get("content")
        if isinstance(content, str):
            s.add_turn(content, d.get("timestamp"))
            continue
        texts = []
        for item in content or []:
            if item.get("type") == "text":
                texts.append(item.get("text", ""))
            elif item.get("type") == "tool_result" and item.get("is_error"):
                s.tool_errors += 1
        if texts:
            s.add_turn(" ".join(texts), d.get("timestamp"))
    return s.finish()


def parse_pi(path, source):
    """omp and pi share the pi-mono session format."""
    s = Session(source, path)
    for d in iter_jsonl(path):
        s.stamp(d.get("timestamp"))
        kind = d.get("type")
        if kind == "session":
            s.id = d.get("id", s.id)
            s.cwd = d.get("cwd")
        elif kind == "title":
            s.title = d.get("title")
        elif kind == "custom_message" and d.get("customType") == "skill-prompt":
            match = re.search(r'invoked the "([^"]+)" skill', str(d.get("content")))
            if match:
                s.push("/skill:" + match.group(1), d.get("timestamp"))
        elif kind == "message":
            msg = d.get("message") or {}
            if msg.get("role") == "toolResult" and msg.get("isError"):
                s.tool_errors += 1
            if msg.get("role") != "user":
                continue
            content = msg.get("content")
            if not isinstance(content, str):
                content = " ".join(
                    i.get("text", "") for i in content or [] if i.get("type") == "text")
            s.add_turn(content, d.get("timestamp"))
    return s.finish()


def parse_codex(path):
    s = Session("codex", path)
    for d in iter_jsonl(path):
        s.stamp(d.get("timestamp"))
        payload = d.get("payload") or {}
        if d.get("type") == "session_meta":
            # Guardian reviews and spawned agents talk to Codex, not to a person.
            if "subagent" in json.dumps([payload.get("thread_source"), payload.get("source")]):
                return None
            s.id = payload.get("id", s.id)
            s.cwd = payload.get("cwd")
            if payload.get("originator") == "codex_exec":
                s.kind = "headless"
        elif (d.get("type") == "response_item" and payload.get("type") == "message"
              and payload.get("role") == "user"):
            for item in payload.get("content") or []:
                text = item.get("text", "") if item.get("type") == "input_text" else ""
                if text.startswith("<turn_aborted>"):
                    s.push("[interrupted]", d.get("timestamp"))
                elif not CODEX_INJECTED_RE.match(text):
                    s.add_turn(text, d.get("timestamp"))
    return s.finish()


MINIMAX_ROOT = HOME / ".minimax/v2"


def minimax_meta():
    """Session kind and workspace per session id, from MiniMax Code's runtime db."""
    db = MINIMAX_ROOT / "sqlite/runtime-state.sqlite"
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = con.execute(
            "select session_id, session_kind, json_extract(record_json, '$.workspaceDir')"
            " from local_runtime_sessions").fetchall()
        con.close()
    except sqlite3.Error:
        return {}
    return {sid: (kind, workspace) for sid, kind, workspace in rows}


def parse_minimax(path, meta):
    """path is a session's manifest.json; history is split into generations."""
    session_dir = path.parent
    manifest = load_json(path, {})
    s = Session("minimax", path)
    full_id = manifest.get("sessionId", session_dir.name)
    kind, workspace = meta.get(full_id, (None, None))
    s.id = full_id.replace("mvs_", "", 1)
    if kind == "cron":
        s.kind = "scheduled"
    # Per-session sandboxes under ~/.minimax say nothing about the project.
    if workspace and not workspace.startswith(str(HOME / ".minimax")):
        s.cwd = workspace
    else:
        s.cwd = "MiniMax Code"
    files = []
    for art in load_json(session_dir / "history-catalog.json", {}).get("artifacts", []):
        name = art.get("fileName", "")
        files.append(session_dir / name if art.get("kind") == "active"
                     else session_dir / "snapshots" / name)
    seen = set()
    for file in files or [session_dir / "messages.jsonl"]:
        for d in iter_jsonl(file):
            msg_id = d.get("message_id")
            if msg_id in seen:
                continue
            seen.add(msg_id)
            msg = d.get("message") or {}
            s.stamp(msg.get("timestamp"))
            if msg.get("role") == "toolResult" and msg.get("isError"):
                s.tool_errors += 1
            # Injected notices also use the user role; typed input has msg-user ids.
            if msg.get("role") != "user" or not str(msg_id).startswith("msg-user"):
                continue
            content = msg.get("content")
            if not isinstance(content, str):
                content = " ".join(
                    i.get("text", "") for i in content or [] if i.get("type") == "text")
            s.add_turn(content, msg.get("timestamp"))
    return s.finish()


def session_files(source):
    if source == "claude":
        # Top level only: subagent transcripts live one directory deeper.
        return sorted((HOME / ".claude/projects").glob("*/*.jsonl"))
    if source in ("omp", "pi"):
        return sorted((HOME / ("." + source) / "agent/sessions").glob("*/*.jsonl"))
    if source == "minimax":
        return sorted((MINIMAX_ROOT / "sessions").glob("*/*/*/*/manifest.json"))
    if source == "codex":
        root = HOME / ".codex"
        return sorted(list((root / "sessions").rglob("*.jsonl"))
                      + list((root / "archived_sessions").glob("*.jsonl")))
    return []


def collect_sessions(source, since, until):
    if source == "minimax":
        parser = functools.partial(parse_minimax, meta=minimax_meta())
    else:
        parser = {"claude": parse_claude, "codex": parse_codex}.get(
            source, lambda p: parse_pi(p, source))
    best = {}
    for path in session_files(source):
        # A MiniMax session writes its history next to the manifest, not into it.
        probe = path.parent / "history-catalog.json" if source == "minimax" else path
        try:
            if mtime_of(probe if probe.exists() else path) < since:
                continue
        except OSError:
            continue
        s = parser(path)
        if s is None or not s.turns or s.last is None or s.last < since or s.first >= until:
            continue
        # The same session can sit under two project dirs after a move.
        if s.id not in best or len(s.turns) > len(best[s.id].turns):
            best[s.id] = s
    return drop_copies(best.values())


def drop_copies(sessions):
    """Resuming or forking a session copies its history into a new file.

    Copies share the timestamped first turn, which independent sessions never
    do, so merge each such group into its longest member.
    """
    groups = {}
    for s in sessions:
        groups.setdefault(s.keys[0], []).append(s)
    merged = []
    for group in groups.values():
        main = max(group, key=lambda x: (len(x.keys), x.last))
        if len(group) > 1:
            main.keys = sorted(set().union(*(x.keys for x in group)))
            main.turns = [line for _, line in main.keys]
            main.first = min(x.first for x in group)
            main.last = max(x.last for x in group)
            main.tool_errors = max(x.tool_errors for x in group)
        merged.append(main)
    return merged


def collect_claudeai(cfg, since, until):
    root = cfg["claudeai_backup"]
    if not root:
        return []
    split = root / "conversations/split"
    sessions = []
    for entry in load_json(split / "index.json", []):
        updated = parse_ts(entry.get("updated_at"))
        created = parse_ts(entry.get("created_at"))
        if not updated or updated < since or (created and created >= until):
            continue
        path = split / entry.get("file", "")
        s = Session("claudeai", path)
        s.id = entry.get("uuid", path.stem)
        s.title = entry.get("name") or entry.get("summary") or None
        s.cwd = "claude.ai"
        for msg in load_json(path, {}).get("chat_messages", []):
            s.stamp(msg.get("created_at"))
            if msg.get("sender") != "human":
                continue
            text = msg.get("text") or " ".join(
                c.get("text", "") for c in msg.get("content") or [] if c.get("type") == "text")
            s.add_turn(text, msg.get("created_at"))
        if s.turns:
            sessions.append(s.finish())
    return sessions


def opening_key(text):
    text = re.sub(r"\d+", "#", text.lower())
    return re.sub(r"\s+", " ", text)[:60]


def session_block(s):
    tags = [f"follow-ups {len(s.followups)}"]
    if s.retries:
        tags.append(f"retries {s.retries}")
    if s.interrupts:
        tags.append(f"interrupts {s.interrupts}")
    if s.tool_errors:
        tags.append(f"tool errors {s.tool_errors}")
    if s.kind != "interactive":
        tags.append(s.kind)
    lines = [f"- {day(s.first)} · {s.id[:8]} · {' · '.join(tags)}"]
    if s.title:
        lines.append(f"  title: {clip(s.title, 80)}")
    lines.append(f"  file: {tilde(s.path)}")
    lines.append(f"  > {clip(s.opening, FIRST_PROMPT_CHARS)}")
    for turn in s.followups[:MAX_TURNS]:
        lines.append(f"  - {clip(turn, TURN_CHARS)}")
    if len(s.followups) > MAX_TURNS:
        lines.append(f"  - … {len(s.followups) - MAX_TURNS} more")
    return lines


def render_sessions(source, sessions, since, until):
    sessions.sort(key=lambda s: s.first)
    groups = {}
    for s in sessions:
        groups.setdefault(opening_key(s.opening), []).append(s)
    recurring = {k: v for k, v in groups.items() if len(v) >= RECURRING_MIN}
    kinds = {}
    for s in sessions:
        kinds[s.kind] = kinds.get(s.kind, 0) + 1
    kind_text = ", ".join(f"{k} {n}" for k, n in sorted(kinds.items()))
    followups = sum(len(s.followups) for s in sessions)
    retries = sum(s.retries for s in sessions)
    interrupts = sum(s.interrupts for s in sessions)
    out = [
        f"# {source} sessions · {day(since)} to {day(until)} · {host()}",
        "",
        (f"{len(sessions)} sessions ({kind_text}), {followups} human follow-ups, "
         f"{retries} retries, {interrupts} interrupts."),
        "",
    ]
    if recurring:
        out += [f"## Recurring openings (≥{RECURRING_MIN} times)", ""]
        for items in sorted(recurring.values(), key=len, reverse=True):
            touched = [s for s in items if s.followups]
            projects = ", ".join(sorted({tilde(s.cwd or "?") for s in items}))
            out.append(f"### \"{clip(items[0].opening, 80)}\" × {len(items)}, "
                       f"{len(touched)} with human follow-ups, latest {day(items[-1].first)}")
            out.append(f"projects: {projects}")
            for s in touched:
                out += session_block(s)
            out.append("")
    rest = [s for k, v in groups.items() if k not in recurring for s in v]
    if rest:
        out += ["## Other sessions (by project)", ""]
        by_project = {}
        for s in rest:
            by_project.setdefault(tilde(s.cwd or "?"), []).append(s)
        for project in sorted(by_project):
            out.append(f"### {project}")
            for s in by_project[project]:
                out += session_block(s)
            out.append("")
    return "\n".join(out) + "\n"


def mtime_of(path):
    return dt.datetime.fromtimestamp(path.stat().st_mtime).astimezone()


def render_memory():
    out = [f"# Memories · {host()}", ""]
    count = 0
    for mem_dir in sorted((HOME / ".claude/projects").glob("*/memory")):
        files = sorted(p for p in mem_dir.glob("*.md") if p.name != "MEMORY.md")
        if not files:
            continue
        out.append(f"## {tilde(mem_dir)}")
        for path in files:
            text = path.read_text(errors="replace")
            desc = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
            kind = re.search(r"^\s*type:\s*(\S+)", text, re.MULTILINE)
            desc_text = clip(desc.group(1), 160) if desc else "no description"
            kind_text = kind.group(1) if kind else "?"
            out.append(f"- {path.name} · {kind_text} · {day(mtime_of(path))} · {desc_text}")
            count += 1
        out.append("")
    codex = HOME / ".codex/memories/MEMORY.md"
    if codex.exists():
        size = len(codex.read_text(errors="replace"))
        out += ["## Codex memory (maintained by Codex, read-only)",
                f"- {tilde(codex)} · {size} chars · {day(mtime_of(codex))}", ""]
    return "\n".join(out) + "\n", count




def render_vault(cfg, since, until, first_run):
    root = cfg["vault"]
    exclude = [e.strip("/") for e in cfg["vault_exclude"]]
    full = [f.strip("/") for f in cfg["vault_full_history"]] if first_run else []
    ai_note = re.compile(cfg["vault_ai_marker"], re.MULTILINE)

    def under(rel_dir, prefixes):
        return any(rel_dir == p or rel_dir.startswith(p + "/") for p in prefixes)

    by_dir = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if not d.startswith(".") and d not in ("attachments", "_attachments")]
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir
        if under(rel_dir, exclude):
            dirnames[:] = []
            continue
        whole = under(rel_dir, full)
        for name in filenames:
            if not name.endswith(".md"):
                continue
            path = Path(dirpath) / name
            mtime = mtime_of(path)
            if not whole and not since <= mtime < until:
                continue
            text = path.read_text(errors="replace")
            ai = " · AI" if ai_note.search(text[:800]) else ""
            top = rel_dir.split("/")[0] or "(root)"
            by_dir.setdefault(top, []).append(
                f"- {os.path.join(rel_dir, name)} · {day(mtime)} · {len(text)} chars{ai}")
    count = sum(len(v) for v in by_dir.values())
    out = [f"# Vault notes · {day(since)} to {day(until)}", "",
           f"root: {tilde(root)}. {count} notes; those marked AI were written by an agent."]
    if full:
        out.append(f"First run, so these folders list their full history: {', '.join(full)}.")
    out.append("")
    for top in sorted(by_dir):
        out += [f"## {top} ({len(by_dir[top])})"] + sorted(by_dir[top]) + [""]
    return "\n".join(out) + "\n", count


def cursor_key(source):
    return ("global", source) if source in GLOBAL_SOURCES else ("hosts", host(), source)


def get_cursor(state, source):
    node = state
    for part in cursor_key(source):
        node = node.get(part, {}) if isinstance(node, dict) else {}
    return node if isinstance(node, str) else None


def cmd_scan(args):
    cfg = load_config()
    state = load_json(STATE_PATH, {})
    now = dt.datetime.now().astimezone()
    until = local_midnight(args.until) if args.until else now
    sources = args.sources.split(",") if args.sources else ALL_SOURCES
    run_dir = Path(args.out) if args.out else (
        PRIVATE / "runs" / f"{now.strftime('%Y-%m-%d')}-{host()}")
    run_dir.mkdir(parents=True, exist_ok=True)
    run = {"host": host(), "until": until.isoformat(), "sources": {}}
    print(f"run: {tilde(run_dir)}")
    for source in sources:
        if source not in ALL_SOURCES:
            print(f"  {source}: unknown source, skipped")
            continue
        cursor = get_cursor(state, source)
        if args.since:
            since = local_midnight(args.since)
        elif cursor:
            since = parse_ts(cursor)
        else:
            since = now - dt.timedelta(days=cfg["first_run_days"])
        if source == "memory":
            text, count = render_memory()
        elif source == "vault":
            if not cfg["vault"] or not cfg["vault"].is_dir():
                print(f"  vault: not configured in {tilde(CONFIG_PATH)}, skipped")
                continue
            text, count = render_vault(cfg, since, until, first_run=cursor is None)
        else:
            if source == "claudeai":
                if not cfg["claudeai_backup"]:
                    print(f"  claudeai: not configured in {tilde(CONFIG_PATH)}, skipped")
                    continue
                sessions = collect_claudeai(cfg, since, until)
            else:
                sessions = collect_sessions(source, since, until)
            if not sessions:
                print(f"  {source}: no sessions since {day(since)}")
                continue
            text, count = render_sessions(source, sessions, since, until), len(sessions)
        path = run_dir / f"digest-{source}.md"
        path.write_text(text)
        run["sources"][source] = {"since": since.isoformat(), "count": count}
        size_kb = (len(text.encode()) + 1023) // 1024
        print(f"  {source}: {count} items since {day(since)} -> {path.name} ({size_kb} KB)")
    (run_dir / "run.json").write_text(json.dumps(run, ensure_ascii=False, indent=2))


def cmd_mark(args):
    run = load_json(Path(args.run_dir) / "run.json", None)
    if not run:
        sys.exit(f"no run.json in {args.run_dir}")
    if run["host"] != host():
        sys.exit(f"run belongs to host {run['host']}, this is {host()}")
    state = load_json(STATE_PATH, {})
    for source in run["sources"]:
        if source == "memory":
            continue
        *parents, leaf = cursor_key(source)
        node = state
        for part in parents:
            node = node.setdefault(part, {})
        old = parse_ts(node.get(leaf))
        if old is None or parse_ts(run["until"]) > old:
            node[leaf] = run["until"]
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print(f"cursors advanced to {run['until'][:10]} for: {', '.join(run['sources'])}")


def cmd_status(_args):
    cfg = load_config()
    state = load_json(STATE_PATH, {})
    print(f"host: {host()}")
    print(f"private: {tilde(PRIVATE)} ({'exists' if PRIVATE.exists() else 'missing'})")
    print(f"config: {'found' if CONFIG_PATH.exists() else 'missing, defaults in use'}")
    for source in ALL_SOURCES:
        if source in SESSION_SOURCES:
            have = f"{len(session_files(source))} files"
        elif source == "memory":
            have = f"{len(list((HOME / '.claude/projects').glob('*/memory')))} dirs"
        else:
            key = "vault" if source == "vault" else "claudeai_backup"
            have = tilde(cfg[key]) if cfg[key] else "not configured"
        print(f"  {source:<8} {have:<30} cursor {get_cursor(state, source) or 'none'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    scan = sub.add_parser("scan")
    scan.add_argument("--since")
    scan.add_argument("--until")
    scan.add_argument("--sources", help=",".join(ALL_SOURCES))
    scan.add_argument("--out")
    scan.set_defaults(func=cmd_scan)
    mark = sub.add_parser("mark")
    mark.add_argument("run_dir")
    mark.set_defaults(func=cmd_mark)
    sub.add_parser("status").set_defaults(func=cmd_status)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
