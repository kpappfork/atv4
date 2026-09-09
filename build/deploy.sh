#!/bin/sh
# Push and deploy as the machine account.
#
# Every workflow run records an actor: the account behind the credential that
# triggered it. `gh` falls back to your keyring login when GH_TOKEN is empty,
# so a mistyped or unset token silently deploys under a personal account. This
# script verifies the token's identity first and refuses to continue otherwise.
#
# Usage:  sh build/deploy.sh            push main, deploy, then purge
#         sh build/deploy.sh --no-push  deploy only

set -eu

REPO="kpappfork/atv4"
BOT="kpappfork-ci"
PUSH=1
[ "${1:-}" = "--no-push" ] && PUSH=0

printf 'Token for %s: ' "$BOT" >&2
stty -echo 2>/dev/null || true
read -r BOT_TOKEN
stty echo 2>/dev/null || true
echo >&2
export BOT_TOKEN
[ -n "$BOT_TOKEN" ] || { echo "No token given." >&2; exit 1; }

# --- the guard that stops a personal account being recorded as the actor ---
WHO=$(GH_TOKEN="$BOT_TOKEN" gh api user --jq .login 2>/dev/null | head -1 | tr -d '[:space:]')
# A rejected token makes gh print an error body rather than a login; treat
# anything that is not a plain username as "unknown".
case "$WHO" in
  "" | *[!A-Za-z0-9-]*) WHO="" ;;
esac
if [ "$WHO" != "$BOT" ]; then
  echo "Refusing to continue: this token belongs to '${WHO:-unknown}', not $BOT." >&2
  exit 1
fi
echo "Authenticated as $WHO." >&2

if [ "$PUSH" -eq 1 ]; then
  echo "Pushing main..." >&2
  git -c credential.username="$BOT" \
      -c credential.helper='!f(){ echo username='"$BOT"'; echo "password=$BOT_TOKEN"; };f' \
      push "https://github.com/$REPO.git" main
fi

echo "Dispatching deploy..." >&2
GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/dispatches" -f event_type=deploy

# Wait for the dispatch run to finish before purging, so the new deployment has
# superseded the old one and deleting it cannot take the site offline.
echo "Waiting for the deploy to finish..." >&2
i=0
while [ "$i" -lt 60 ]; do
  sleep 10
  i=$((i + 1))
  RUN=$(GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/actions/runs?event=repository_dispatch&per_page=1" \
          --jq '.workflow_runs[0] | "\(.status) \(.conclusion) \(.actor.login)"' 2>/dev/null || true)
  echo "  $RUN" >&2
  case "$RUN" in
    completed\ success\ *) break ;;
    completed\ *) echo "Deploy did not succeed. Nothing purged." >&2; exit 1 ;;
  esac
done

echo "Purging anything attributed to another account..." >&2
GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/actions/runs" --paginate \
  --jq ".workflow_runs[] | select(.actor.login != \"$BOT\") | .id" 2>/dev/null |
while read -r id; do
  [ -n "$id" ] || continue
  GH_TOKEN="$BOT_TOKEN" gh api -X DELETE "repos/$REPO/actions/runs/$id" >/dev/null 2>&1 &&
    echo "  deleted run $id" >&2 || echo "  could not delete run $id" >&2
done

GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/deployments" \
  --jq ".[] | select(.creator.login != \"$BOT\") | .id" 2>/dev/null |
while read -r id; do
  [ -n "$id" ] || continue
  STATE=$(GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/deployments/$id/statuses" --jq '.[0].state' 2>/dev/null || true)
  if [ "$STATE" = "success" ]; then
    echo "  skipping deployment $id — still the active one" >&2
    continue
  fi
  GH_TOKEN="$BOT_TOKEN" gh api -X DELETE "repos/$REPO/deployments/$id" >/dev/null 2>&1 &&
    echo "  deleted deployment $id" >&2 || echo "  could not delete deployment $id" >&2
done

echo >&2
echo "Remaining actors:" >&2
GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/actions/runs" --jq '.workflow_runs[] | "  run \(.id) \(.actor.login)"' 2>/dev/null || true
GH_TOKEN="$BOT_TOKEN" gh api "repos/$REPO/deployments" --jq '.[] | "  deployment \(.id) \(.creator.login)"' 2>/dev/null || true
