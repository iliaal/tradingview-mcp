#!/usr/bin/env bash
# Audit forks of an upstream repo for novel features.
#
# Pulls the top N forks by pushed_at, filters to those with meaningful
# divergence (ahead_by >= MIN_AHEAD), and emits a markdown report listing
# their unique commits and added files per fork. Run periodically to spot
# upstream activity worth porting.
#
# Output goes to stdout — redirect to save:
#   ./scripts/audit_forks.sh --top 100 > /tmp/fork_audit.md
#
# Requires: gh (authenticated), jq.

set -uo pipefail

UPSTREAM="${UPSTREAM:-tradesdontlie/tradingview-mcp}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
TOP_N="${TOP_N:-100}"
MIN_AHEAD="${MIN_AHEAD:-3}"
MAX_COMMITS_PER_FORK="${MAX_COMMITS_PER_FORK:-30}"
MAX_FILES_PER_FORK="${MAX_FILES_PER_FORK:-20}"

usage() {
  cat <<EOF
Usage: $0 [--top N] [--min-ahead N] [--upstream owner/repo] [--upstream-branch BRANCH]

Defaults: --top $TOP_N --min-ahead $MIN_AHEAD --upstream $UPSTREAM --upstream-branch $UPSTREAM_BRANCH

Env overrides: UPSTREAM, UPSTREAM_BRANCH, TOP_N, MIN_AHEAD, MAX_COMMITS_PER_FORK, MAX_FILES_PER_FORK.

Output is markdown on stdout. Progress on stderr.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top) TOP_N="$2"; shift 2 ;;
    --min-ahead) MIN_AHEAD="$2"; shift 2 ;;
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --upstream-branch) UPSTREAM_BRANCH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated — run 'gh auth login'" >&2; exit 1; }

echo "Fetching forks of $UPSTREAM..." >&2
forks_json=$(gh api "repos/$UPSTREAM/forks" --paginate \
  -q '.[] | {name: .full_name, pushed: .pushed_at, default_branch: .default_branch, description: .description, html_url: .html_url}' \
  | jq -s --argjson n "$TOP_N" 'sort_by(.pushed) | reverse | .[0:$n]')

total=$(jq 'length' <<<"$forks_json")
echo "Pulled $total forks (top $TOP_N by pushed_at)." >&2
echo >&2

# Markdown header to stdout
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat <<EOF
# Fork audit: \`$UPSTREAM\`

Generated: $ts
Top $total forks by \`pushed_at\` desc. Divergence threshold: \`ahead_by >= $MIN_AHEAD\`.

EOF

# Iterate, computing divergence. Per-fork compare blobs are written to a
# tempdir keyed by index — accumulating them inline blew past ARG_MAX once
# 20+ rich compare payloads piled up.
tmpdir=$(mktemp -d -t fork_audit.XXXXXX)
trap 'rm -rf "$tmpdir"' EXIT

survivors_meta=()
i=0
while IFS= read -r fork; do
  i=$((i+1))
  name=$(jq -r .name <<<"$fork")
  branch=$(jq -r .default_branch <<<"$fork")
  printf "[%3d/%d] %-50s " "$i" "$total" "$name" >&2

  owner="${name%%/*}"
  repo="${name#*/}"
  compare_path="$tmpdir/$i.json"
  if ! gh api "repos/$UPSTREAM/compare/$UPSTREAM_BRANCH...$owner:$repo:$branch" >"$compare_path" 2>/dev/null; then
    echo '{}' >"$compare_path"
  fi
  ahead=$(jq -r '.ahead_by // 0' "$compare_path")
  behind=$(jq -r '.behind_by // 0' "$compare_path")
  printf "ahead=%s\n" "$ahead" >&2

  if [ "$ahead" -ge "$MIN_AHEAD" ]; then
    enriched=$(jq -c --arg p "$compare_path" --argjson a "$ahead" --argjson b "$behind" \
      '. + {ahead_by: $a, behind_by: $b, _compare_path: $p}' <<<"$fork")
    survivors_meta+=("$enriched")
  else
    rm -f "$compare_path"
  fi
done < <(jq -c '.[]' <<<"$forks_json")

survivor_count=${#survivors_meta[@]}

cat <<EOF
## Summary

- Total scanned: $total
- Survivors (ahead_by ≥ $MIN_AHEAD): $survivor_count
- Untouched / trivial: $((total - survivor_count))

EOF

if [ "$survivor_count" -eq 0 ]; then
  echo "No forks with meaningful divergence."
  exit 0
fi

echo "## Findings"
echo

printf '%s\n' "${survivors_meta[@]}" | jq -cs 'sort_by(-.ahead_by) | .[]' | while IFS= read -r fork; do
  name=$(jq -r .name <<<"$fork")
  branch=$(jq -r .default_branch <<<"$fork")
  url=$(jq -r .html_url <<<"$fork")
  ahead=$(jq -r .ahead_by <<<"$fork")
  behind=$(jq -r .behind_by <<<"$fork")
  desc=$(jq -r '.description // ""' <<<"$fork")
  pushed=$(jq -r .pushed <<<"$fork")
  cmp_path=$(jq -r '._compare_path' <<<"$fork")

  echo "### [$name]($url)"
  echo
  echo "- Ahead by **$ahead** / behind by $behind"
  echo "- Default branch: \`$branch\`"
  echo "- Last push: $pushed"
  [ -n "$desc" ] && [ "$desc" != "null" ] && echo "- Description: $desc"
  echo

  echo "**Commit messages (deduped, first line, top $MAX_COMMITS_PER_FORK):**"
  echo
  msgs=$(jq -r --argjson n "$MAX_COMMITS_PER_FORK" \
    '[.commits[]?.commit.message // empty | split("\n")[0]] | unique | .[0:$n] | .[]' "$cmp_path" 2>/dev/null || true)
  if [ -n "$msgs" ]; then
    echo "$msgs" | sed 's/^/- /'
  else
    echo "_(none)_"
  fi
  echo

  added=$(jq -r --argjson n "$MAX_FILES_PER_FORK" \
    '[.files[]? | select(.status=="added") | .filename] | .[0:$n] | .[]' "$cmp_path" 2>/dev/null || true)
  if [ -n "$added" ]; then
    echo "**Added files (top $MAX_FILES_PER_FORK):**"
    echo
    echo "$added" | sed 's/^/- `/' | sed 's/$/`/'
    echo
  fi

  modified=$(jq -r --argjson n "$MAX_FILES_PER_FORK" \
    '[.files[]? | select(.status=="modified") | .filename] | .[0:$n] | .[]' "$cmp_path" 2>/dev/null || true)
  if [ -n "$modified" ]; then
    echo "**Modified files (top $MAX_FILES_PER_FORK):**"
    echo
    echo "$modified" | sed 's/^/- `/' | sed 's/$/`/'
    echo
  fi

  echo "---"
  echo
done
