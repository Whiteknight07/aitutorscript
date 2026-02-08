#!/usr/bin/env bash
set -euo pipefail

# Bootstrap parallel worktrees for v2 development.
# Safe to re-run: existing branches/worktrees are skipped.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "Error: not inside a git repository."
  exit 1
fi

cd "${REPO_ROOT}"

echo "Repo root: ${REPO_ROOT}"

echo "Fetching remotes..."
git fetch origin --prune

BASE_REF="main"
if git show-ref --verify --quiet refs/remotes/origin/main; then
  BASE_REF="origin/main"
fi

echo "Using base ref: ${BASE_REF}"

if git show-ref --verify --quiet refs/heads/v2; then
  echo "Branch 'v2' already exists."
else
  echo "Creating branch 'v2' from ${BASE_REF}..."
  git branch v2 "${BASE_REF}"
fi

WORKTREE_ROOT="${WORKTREE_ROOT:-${REPO_ROOT}-wt}"
mkdir -p "${WORKTREE_ROOT}"

echo "Worktree root: ${WORKTREE_ROOT}"

# name|branch
TARGETS=(
  "core-controls|feat/v2-core-controls"
  "judge-panel|feat/v2-judge-panel"
  "attack-taxonomy|feat/v2-attack-taxonomy"
  "metrics-reliability|feat/v2-metrics-reliability"
  "report-perf|feat/v2-report-perf"
  "paper-recipes|feat/v2-paper-recipes"
)

worktree_exists_for_path() {
  local p="$1"
  git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -Fx -- "$p" >/dev/null 2>&1
}

branch_checked_out_somewhere() {
  local b="$1"
  git worktree list --porcelain | awk '/^branch /{print $2}' | grep -Fx -- "refs/heads/${b}" >/dev/null 2>&1
}

for item in "${TARGETS[@]}"; do
  name="${item%%|*}"
  branch="${item##*|}"
  path="${WORKTREE_ROOT}/${name}"

  echo
  echo "==> ${name} (${branch})"

  if worktree_exists_for_path "${path}"; then
    echo "Path already registered as worktree: ${path}"
    continue
  fi

  if [[ -e "${path}" ]] && [[ -n "$(ls -A "${path}" 2>/dev/null || true)" ]]; then
    echo "Skip: path exists and is non-empty but not a registered worktree: ${path}"
    echo "      Move/remove it manually, then re-run."
    continue
  fi

  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    if branch_checked_out_somewhere "${branch}"; then
      echo "Branch already checked out in another worktree: ${branch}"
      echo "Skipping add for ${path}."
      continue
    fi
    echo "Adding worktree from existing branch..."
    git worktree add "${path}" "${branch}"
  else
    echo "Creating branch + worktree from ${BASE_REF}..."
    git worktree add -b "${branch}" "${path}" "${BASE_REF}"
  fi

done

echo
echo "Done. Current worktrees:"
git worktree list

echo
echo "Next: open one terminal per worktree under ${WORKTREE_ROOT} and start one Codex session in each."
