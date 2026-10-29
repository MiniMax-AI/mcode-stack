#!/usr/bin/env bash
# Install one stack into Claude Code, Codex, or ~/.agents/skills/.
#
# Usage: scripts/install.sh [stack]
#   stack defaults to ronny. Example: scripts/install.sh jiachen
#
# When claude or codex is on PATH, this runs that product's marketplace
# install. When neither is, it copies every skill directory under the stack
# into ~/.agents/skills/.

set -euo pipefail

STACK="${1:-ronny}"
MARKETPLACE="MiniMax-AI/mcode-stack"
MARKETPLACE_NAME="mcode-stack"

if [[ "${STACK}" == "-h" || "${STACK}" == "--help" ]]; then
  echo "Usage: scripts/install.sh [stack]"
  echo "  stack defaults to ronny. Example: scripts/install.sh jiachen"
  exit 0
fi

if [[ $# -gt 1 ]]; then
  echo "Usage: scripts/install.sh [stack]" >&2
  exit 1
fi

if [[ ! "${STACK}" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Stack name must be lowercase letters, digits, and hyphens." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/stacks/${STACK}/skills"

if [[ ! -d "${SRC}" ]]; then
  echo "No skills directory for stack '${STACK}' at ${SRC}" >&2
  exit 1
fi

copy_skills() {
  local dest="${HOME}/.agents/skills"
  local skill name found=0
  mkdir -p "${dest}"
  shopt -s nullglob
  for skill in "${SRC}"/*/; do
    if [[ -f "${skill}SKILL.md" ]]; then
      name="$(basename "${skill}")"
      rm -rf "${dest}/${name}"
      cp -R "${skill%/}" "${dest}/${name}"
      found=1
    fi
  done
  shopt -u nullglob
  if [[ "${found}" -eq 0 ]]; then
    echo "No skills with SKILL.md under ${SRC}" >&2
    exit 1
  fi
  echo "Copied skills from stacks/${STACK} into ${dest}/"
}

used=0
if command -v claude >/dev/null 2>&1; then
  echo "Installing ${STACK} with Claude Code"
  claude plugin install "${STACK}" --marketplace "${MARKETPLACE}"
  used=1
fi
if command -v codex >/dev/null 2>&1; then
  echo "Installing ${STACK} with Codex"
  codex plugin marketplace add "${MARKETPLACE}"
  codex plugin add "${STACK}@${MARKETPLACE_NAME}"
  used=1
fi
if [[ "${used}" -eq 0 ]]; then
  echo "claude and codex are not on PATH; copying skills into ~/.agents/skills/"
  copy_skills
fi
