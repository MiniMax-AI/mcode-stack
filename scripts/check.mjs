#!/usr/bin/env node
// Checks every stack in this repository.
//
// 1. Repository lint (no dependencies): plugin.json parses, its name matches
//    the directory, the icon and every referenced SKILL.md exist, every skill
//    directory is listed in the manifest, and every SKILL.md has frontmatter
//    with a `name` equal to its directory and a non-empty `description`.
// 2. Marketplace: .claude-plugin/marketplace.json has exactly one entry per
//    stack under stacks/ and community/, named after its directory, with the
//    same description as its plugin.json and no component fields (the stack's
//    own plugin.json defines its skills).
// 3. Version bump: if CHECK_BASE names a commit, every stack whose files
//    changed since its merge base with HEAD (uncommitted changes included)
//    must have a higher plugin.json "version" than at that merge base.
//    Marketplace installs look at the version to decide whether an update is
//    available, so a change without a bump never reaches installed copies.
// 4. Official MiniMax Code plugin validator: if MINIMAX_CODE_DIR points at a
//    checkout of https://github.com/MiniMax-AI/minimax-code (only
//    tools/plugins and schemas/plugins are needed), each stack is also run
//    through tools/plugins/validate-plugin.mjs.
//
// Usage: node scripts/check.mjs                         (lint and marketplace)
//        CHECK_BASE=origin/main node scripts/check.mjs  (plus the version bump check)
//        MINIMAX_CODE_DIR=../minimax-code node scripts/check.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STACK_PARENTS = ["stacks", "community", "templates"];
/** Stacks under these parents are published in the marketplace. */
const PUBLISHED_PARENTS = ["stacks", "community"];
const MARKETPLACE = ".claude-plugin/marketplace.json";
const COMPONENT_FIELDS = ["skills", "commands", "agents", "hooks", "mcpServers"];
const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
/** Parsed plugin.json of each stack root that has a valid one. */
const manifests = new Map();

function dirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

function frontmatter(text, where) {
  if (text.charCodeAt(0) === 0xfeff) err(where, "BOM is not allowed");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(text);
  if (!m) {
    err(where, "must start with a closed YAML frontmatter block");
    return {};
  }
  const out = {};
  for (const line of m[1].split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
    if (!kv) {
      err(where, `unsupported frontmatter line (keep it flat, one key per line): ${line}`);
      continue;
    }
    let value = kv[2].trim();
    const quoted = /^(["']).*\1$/u.test(value) && value.length >= 2;
    if (quoted) value = value.slice(1, -1);
    else if (/: |\s#/u.test(value) || /^[[\]{}>|*&!%@`"']/u.test(value))
      err(where, `"${kv[1]}" must be quoted (contains YAML special characters)`);
    if (kv[1] in out) err(where, `duplicate key "${kv[1]}"`);
    out[kv[1]] = value;
  }
  return out;
}

function checkSkill(skillDir, name) {
  const file = join(skillDir, "SKILL.md");
  const where = relative(ROOT, file);
  if (!existsSync(file)) return err(relative(ROOT, skillDir), "missing SKILL.md");
  const fm = frontmatter(readFileSync(file, "utf8"), where);
  if (!fm.name) err(where, 'frontmatter "name" is required');
  else if (fm.name !== name) err(where, `name "${fm.name}" != directory "${name}"`);
  if (!ID.test(name)) err(where, `skill id "${name}" should be lowercase letters, digits and - . _`);
  if (!fm.description || !fm.description.trim()) err(where, 'frontmatter "description" is required');
  else if (fm.description.length > 1024) err(where, "description is longer than 1024 characters");
}

function checkStack(root) {
  const name = root.split("/").pop();
  const where = relative(ROOT, root);
  const manifestPath = join(root, ".minimax-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return err(where, "missing .minimax-plugin/plugin.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return err(where, `plugin.json does not parse: ${e.message}`);
  }
  manifests.set(root, manifest);
  if (manifest.name !== name) err(where, `plugin name "${manifest.name}" != directory "${name}"`);
  if (!ID.test(name)) err(where, `stack id "${name}" should be lowercase letters, digits and - . _`);
  if (manifest.icon && !existsSync(join(root, manifest.icon))) err(where, `icon ${manifest.icon} does not exist`);
  if (!existsSync(join(root, "WORKFLOW.md"))) err(where, "missing WORKFLOW.md");
  const listed = new Set(manifest.skills ?? []);
  for (const ref of listed) if (!existsSync(join(root, ref))) err(where, `skills entry ${ref} does not exist`);
  for (const skill of dirs(join(root, "skills"))) {
    const ref = `skills/${skill}/SKILL.md`;
    if (!listed.has(ref)) err(where, `${ref} is not listed in plugin.json "skills"`);
    checkSkill(join(root, "skills", skill), skill);
  }
}

const stacks = [];
for (const parent of STACK_PARENTS)
  for (const d of dirs(join(ROOT, parent))) {
    const root = join(ROOT, parent, d);
    if (existsSync(join(root, ".minimax-plugin")) || existsSync(join(root, "skills"))) stacks.push(root);
  }

for (const root of stacks) checkStack(root);

function checkMarketplace() {
  const file = join(ROOT, MARKETPLACE);
  if (!existsSync(file)) return err(MARKETPLACE, "missing");
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return err(MARKETPLACE, `does not parse: ${e.message}`);
  }
  if (!catalog.name) err(MARKETPLACE, '"name" is required');
  if (!Array.isArray(catalog.plugins)) return err(MARKETPLACE, '"plugins" must be a list');
  const published = new Map(
    stacks
      .map((root) => [relative(ROOT, root), root])
      .filter(([rel]) => PUBLISHED_PARENTS.includes(rel.split("/")[0])),
  );
  const listed = new Set();
  for (const entry of catalog.plugins) {
    const where = `${MARKETPLACE} entry "${entry?.name}"`;
    const rel = typeof entry?.source === "string" ? entry.source.replace(/^\.\//u, "").replace(/\/$/u, "") : "";
    if (!published.has(rel)) {
      err(where, `"source" must be "./<stacks|community>/<id>" of an existing stack, got ${JSON.stringify(entry?.source)}`);
      continue;
    }
    if (listed.has(rel)) err(where, `${rel} is listed twice`);
    listed.add(rel);
    if (entry.name !== rel.split("/").pop()) err(where, `"name" must equal the stack directory name`);
    for (const field of COMPONENT_FIELDS)
      if (field in entry) err(where, `do not set "${field}"; the stack's plugin.json defines its components`);
    const manifest = manifests.get(published.get(rel));
    if (manifest && entry.description !== manifest.description)
      err(where, '"description" must equal the description in the stack\'s plugin.json');
  }
  for (const rel of published.keys()) if (!listed.has(rel)) err(MARKETPLACE, `${rel} has no entry`);
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function semver(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)/u.exec(typeof value === "string" ? value : "");
  return m ? m.slice(1).map(Number) : undefined;
}

function isHigher(next, previous) {
  for (let i = 0; i < 3; i += 1) if (next[i] !== previous[i]) return next[i] > previous[i];
  return false;
}

function checkVersionBumps() {
  const base = process.env.CHECK_BASE;
  if (!base) return console.log("note: CHECK_BASE not set, skipping the version bump check.");
  const mergeBase = git(["merge-base", base, "HEAD"]);
  if (!mergeBase) return err("CHECK_BASE", `no merge base between ${base} and HEAD (fetch full history)`);
  for (const root of stacks) {
    const rel = relative(ROOT, root);
    if (!PUBLISHED_PARENTS.includes(rel.split("/")[0])) continue;
    if (!git(["diff", "--name-only", mergeBase, "--", rel])) continue;
    const before = git(["show", `${mergeBase}:${rel}/.minimax-plugin/plugin.json`]);
    if (before === undefined) continue; // a new stack has nothing to bump from
    let previous;
    try {
      previous = JSON.parse(before).version;
    } catch {
      continue;
    }
    const current = manifests.get(root)?.version;
    const next = semver(current);
    const prev = semver(previous);
    if (!next || !prev || !isHigher(next, prev))
      err(rel, `files changed since ${base}, but version ${current} is not higher than ${previous}; bump "version" in .minimax-plugin/plugin.json so marketplace installs see the update`);
  }
}

checkMarketplace();
checkVersionBumps();

const upstream = process.env.MINIMAX_CODE_DIR;
if (upstream) {
  const validator = join(upstream, "tools", "plugins", "validate-plugin.mjs");
  if (!existsSync(validator)) err("MINIMAX_CODE_DIR", `${validator} not found`);
  else
    for (const root of stacks) {
      const r = spawnSync(process.execPath, [validator, root], { encoding: "utf8" });
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      if (r.status !== 0) err(relative(ROOT, root), "official validate-plugin.mjs failed");
    }
} else {
  console.log("note: MINIMAX_CODE_DIR not set, skipping the official MiniMax Code plugin validator.");
}

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\ncheck: ${errors.length} problem(s) in ${stacks.length} stack(s).`);
  process.exit(1);
}
console.log(`check: ${stacks.length} stack(s) passed: ${stacks.map((s) => relative(ROOT, s)).join(", ")}`);
