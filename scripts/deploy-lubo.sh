#!/usr/bin/env bash
#
# Deploy an instruction change to the running bot, from a workstation.
#
#   scripts/deploy-lubo.sh            # persona / skill text edits
#   scripts/deploy-lubo.sh --restart  # also needed when the set of files changed
#                                     # (new skill directory, container.json, .env)
#   scripts/deploy-lubo.sh --clear    # additionally wipe the group's conversation
#
# Three steps, and skipping the first is why "I changed it and the bot still
# says the old thing" keeps happening:
#   1. the server pulls          — without it the file on the server is old
#   2. containers stop           — only when the file SET changed; fragment
#                                  contents are live through the read-only mount
#   3. the session is cleared    — only when the running conversation itself is
#                                  the problem
#
# A restarted container builds a fresh system prompt from the files on disk, so
# edited rules are in force without a clear. What a clear removes is the
# transcript: the old rule quoted back, the wrong answer already given, the
# habit formed under it. That is worth having when a rule was wrong, and it
# costs the person in that chat their thread every time it is not.
set -euo pipefail

SERVER=luno
PROJECT=nanoclaw-v2
AGENT_GROUP=luno
SOCIAL_REPO=social
RESTART=0
CLEAR=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --clear) CLEAR=1 ;;
    *) echo "Unknown option: $arg (--restart, --clear)" >&2; exit 1 ;;
  esac
done

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
#
# Reset, not pull: building a batch overwrites the tracked data file
# src/data/availability.json, so the clone is dirty after every run the bot
# makes. `git pull --ff-only` then fails the moment a commit touches that file
# — which is exactly the deploy that carries the fix for it. The clone is a
# deploy target, not a workspace: the canonical data comes from the repo, and
# the bot refetches when it builds. Untracked files (output/) stay.
echo "→ resetting $SOCIAL_REPO on $SERVER to origin/main"
ssh "$SERVER" "su - nanoclaw -c 'cd ~/$SOCIAL_REPO && git fetch --quiet origin main && git reset --hard --quiet origin/main'"

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

if [ "$CLEAR" = "1" ]; then
  echo "→ clearing the $AGENT_GROUP conversation"
  ssh "$SERVER" "su - nanoclaw -c 'export PATH=\$HOME/.local/bin:\$PATH && cd ~/$PROJECT && pnpm exec tsx scripts/reload-agent.ts $AGENT_GROUP'"
fi

echo "Done. The bot answers the next message with the edited instructions."
if [ "$CLEAR" = "0" ]; then
  echo "The $AGENT_GROUP conversation is untouched. Add --clear when the running"
  echo "thread itself carries the rule you just corrected."
fi
