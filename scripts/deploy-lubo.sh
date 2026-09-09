#!/usr/bin/env bash
#
# Deploy an instruction change to the running bot, from a workstation.
#
#   scripts/deploy-lubo.sh            # persona / skill text edits
#   scripts/deploy-lubo.sh --restart  # also needed when the set of files changed
#                                     # (new skill directory, container.json, .env)
#
# Three steps, and skipping any one of them is why "I changed it and the bot
# still says the old thing" keeps happening:
#   1. the server pulls          — without it the file on the server is old
#   2. containers stop           — only when the file SET changed; fragment
#                                  contents are live through the read-only mount
#   3. the session is cleared    — the agent otherwise keeps answering from the
#                                  rules that were in context when it started
set -euo pipefail

SERVER=luno
PROJECT=nanoclaw-v2
AGENT_GROUP=luno
SOCIAL_REPO=social
RESTART=0
[ "${1:-}" = "--restart" ] && RESTART=1

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty — commit first, the server deploys from origin/main." >&2
  exit 1
fi

# Compare against the real remote, not a stale tracking ref: with an outdated
# origin/main the "nothing unpushed" check passes while the server pulls a
# commit that does not contain the edit, and the script would then report a
# deploy that never happened.
git fetch --quiet origin main
LOCAL_HEAD=$(git rev-parse HEAD)
# Own line, and --verify: inside a test the substitution's exit status is
# discarded, so a missing ref would read as "not pushed" instead of as the
# broken remote setup it is.
REMOTE_HEAD=$(git rev-parse --verify origin/main)
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "HEAD is not what origin/main points at — push (or rebase onto) main first." >&2
  exit 1
fi

echo "→ pulling on $SERVER"
ssh "$SERVER" "su - nanoclaw -c 'cd ~/$PROJECT && git pull --ff-only'"

# The social repo is mounted into the luno agent and holds the render pipeline.
# The container has no SSH key, so it cannot pull for itself — the host does it
# here, where the deploy key lives. Without this the bot works from whatever
# state the clone happened to be in.
echo "→ pulling $SOCIAL_REPO on $SERVER"
ssh "$SERVER" "su - nanoclaw -c 'cd ~/$SOCIAL_REPO && git pull --ff-only'"

SERVER_HEAD=$(ssh "$SERVER" "su - nanoclaw -c 'cd ~/$PROJECT && git rev-parse HEAD'" | tr -d '\r\n')
if [ "$SERVER_HEAD" != "$LOCAL_HEAD" ]; then
  echo "Server is on $SERVER_HEAD, expected $LOCAL_HEAD — deploy aborted before clearing the session." >&2
  exit 1
fi

if [ "$RESTART" = "1" ]; then
  # Docker runs as root here, as in docs/FORK-MAINTENANCE.md. Listing and
  # stopping stay separate calls: in a `ps | xargs stop` pipeline a failing
  # `docker ps` leaves xargs nothing to do and the whole thing exits 0, so a
  # permission error would read as a successful restart.
  echo "→ stopping agent containers (next message spawns fresh)"
  NAMES=$(ssh "$SERVER" "docker ps --filter name=$PROJECT --format '{{.Names}}'")
  if [ -n "$NAMES" ]; then
    echo "$NAMES" | while read -r name; do
      # -n: without it ssh drains the loop's stdin and only the first
      # container is ever stopped — a silent partial restart.
      ssh -n "$SERVER" "docker stop '$name'" >/dev/null
      echo "   stopped $name"
    done
  else
    echo "   none running"
  fi
fi

echo "→ clearing the agent session so the new rules are the ones in context"
ssh "$SERVER" "su - nanoclaw -c 'export PATH=\$HOME/.local/bin:\$PATH && cd ~/$PROJECT && pnpm exec tsx scripts/reload-agent.ts $AGENT_GROUP'"

echo "Done. The bot answers the next message with the edited instructions."
