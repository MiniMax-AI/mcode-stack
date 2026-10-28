#!/usr/bin/env node
// Checks every stack in this repository.
//
// 1. Repository lint (no dependencies): plugin.json parses, its name matches
//    the directory, the icon and every referenced SKILL.md exist, every skill
//    directory is listed in the manifest, and every SKILL.md has frontmatter
//    with a `name` equal to its directory and a non-empty `description`.
// 2. Official MiniMax Code plugin validator: if MINIMAX_CODE_DIR points at a
//    checkout of https://github.com/MiniMax-AI/minimax-code (only
//    tools/plugins and schemas/plugins are needed), each stack is also run
//    through tools/plugins/validate-plugin.mjs.
//
// Usage: node scripts/check.mjs            (lint only)
//        MINIMAX_CODE_DIR=../minimax-code node scripts/check.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STACK_PARENTS = ["stacks", "community", "templates"];
const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

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
