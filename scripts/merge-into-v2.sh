#!/usr/bin/env bash
set -euo pipefail

# Merge all v2 feature branches into v2 (not main).
# Safe to re-run: already-merged branches are skipped.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "Error: not inside a git repository."
  exit 1
fi

cd "${REPO_ROOT}"

echo "Repo root: ${REPO_ROOT}"

echo "Fetching remotes..."
git fetch origin --prune

if ! git show-ref --verify --quiet refs/heads/v2; then
  echo "Error: branch 'v2' does not exist. Run bootstrap script first."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree has uncommitted changes. Commit/stash first."
  exit 1
fi

BRANCHES=(
  "feat/v2-core-controls"
  "feat/v2-attack-taxonomy"
  "feat/v2-judge-panel"
  "feat/v2-metrics-reliability"
  "feat/v2-report-perf"
  "feat/v2-paper-recipes"
)

echo "Switching to v2..."
git switch v2

for b in "${BRANCHES[@]}"; do
  echo
  echo "==> ${b}"

  if ! git show-ref --verify --quiet "refs/heads/${b}"; then
    echo "Skip: branch does not exist locally."
    continue
  fi

  if git merge-base --is-ancestor "${b}" HEAD; then
    echo "Already merged: ${b}"
    continue
  fi

  echo "Merging ${b} into v2..."
  git merge --no-ff "${b}"
done

echo
echo "Merge sequence complete."
echo "Current branch: $(git branch --show-current)"

echo
echo "Optional verification commands:"
echo "  pnpm build"
echo "  pnpm smoke"

echo
echo "Push v2 with:"
echo "  git push origin v2"
