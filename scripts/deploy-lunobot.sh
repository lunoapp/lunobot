#!/usr/bin/env bash
#
# Deploy an instruction change to the running bot, from a workstation.
#
#   scripts/deploy-lunobot.sh            # persona / skill text edits
#   scripts/deploy-lunobot.sh --restart  # also needed when the set of files changed
#                                     # (new skill directory, container.json, .env)
#   scripts/deploy-lunobot.sh --clear    # additionally wipe the group's conversation
#
# Four steps, and skipping the first is why "I changed it and the bot still
# says the old thing" keeps happening:
#   1. the server pulls          — without it the file on the server is old
#   2. containers stop           — only when the file SET changed; fragment
#                                  contents are live through the read-only mount
#   3. mounted clones update     — social is reset, luno and premarising are
#                                  fast-forwarded
#   4. the session is cleared    — only when the running conversation itself is
#                                  the problem
#
# Exit 1 after step 1 with "Not updated on" means the bot is deployed and a
# clone is not. Fix the clone; re-running with --clear does not help.
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
# Clones mounted into agent containers. A container has no SSH key, so the host
# updates them here, where the deploy keys are. RESET_REPOS hold only data a run
# regenerates; FF_REPOS may hold an agent's unpushed work, which a reset would
# erase — a fast-forward refuses instead of overwriting it.
RESET_REPOS=(social)
FF_REPOS=(luno premarising)
FAILED_REPOS=()
KEPT_WORK_REPOS=()
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

# Before any clone is touched: a server on the wrong commit is not a deploy.
SERVER_HEAD=$(ssh "$SERVER" "su - nanoclaw -c 'cd ~/$PROJECT && git rev-parse HEAD'" | tr -d '\r\n')
if [ "$SERVER_HEAD" != "$LOCAL_HEAD" ]; then
  echo "Server is on $SERVER_HEAD, expected $LOCAL_HEAD — deploy aborted before touching clones or sessions." >&2
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

# Clones come after the stop, so with --restart no agent that was running is
# still writing into one; a message arriving in between can spawn a new one.
# Without --restart a running agent can race git here.
#
# A failing clone is reported, not fatal: the bot is already pulled, and the
# steps around it must still run.
#
# Reset for social: a run rewrites src/data/availability.json on every batch, so
# the clone is always dirty and a fast-forward would fail on exactly the deploy
# that carries the fix. Untracked output stays unless upstream adds the same path.
for repo in "${RESET_REPOS[@]}"; do
  echo "→ resetting $repo on $SERVER to origin/main"
  ssh -n "$SERVER" "su - nanoclaw -c 'cd ~/$repo && git fetch --quiet origin main && git reset --hard --quiet origin/main'" \
    || FAILED_REPOS+=("$repo")
done
# --no-overwrite-ignore: a fast-forward otherwise replaces an ignored file an
# agent wrote when upstream starts tracking that path. The branch check keeps a
# fast-forward from landing on whatever branch an agent left checked out.
for repo in "${FF_REPOS[@]}"; do
  echo "→ fast-forwarding $repo on $SERVER"
  if ! ssh -n "$SERVER" "su - nanoclaw -c 'cd ~/$repo && git symbolic-ref --short HEAD | grep -qx main && git fetch --quiet origin main && git merge --ff-only --no-overwrite-ignore --quiet origin/main'"; then
    FAILED_REPOS+=("$repo")
    continue
  fi
  if ! LOCAL_WORK=$(ssh -n "$SERVER" "su - nanoclaw -c 'cd ~/$repo && git status --porcelain && git log --oneline origin/main..HEAD'"); then
    KEPT_WORK_REPOS+=("$repo (state unreadable)")
  elif [ -n "$LOCAL_WORK" ]; then
    KEPT_WORK_REPOS+=("$repo")
  fi
done

if [ "$CLEAR" = "1" ]; then
  echo "→ clearing the $AGENT_GROUP conversation"
  ssh "$SERVER" "su - nanoclaw -c 'export PATH=\$HOME/.local/bin:\$PATH && cd ~/$PROJECT && pnpm exec tsx scripts/reload-agent.ts $AGENT_GROUP'"
fi

# An agent without push credentials leaves its work in the clone. It is kept,
# and nobody sees it until someone pushes it.
if [ "${#KEPT_WORK_REPOS[@]}" -gt 0 ]; then
  echo "Local work kept or unchecked, not in origin/main: ${KEPT_WORK_REPOS[*]} — check with" >&2
  echo "  ssh $SERVER \"su - nanoclaw -c 'cd ~/<repo> && git status && git log origin/main..HEAD'\"" >&2
fi

# Without a restart or a clear nothing ends the running session, so an edited
# rule is on disk and not yet in force. Saying "done" there is the very failure
# this script exists to prevent. The hints print on a failed clone too: the bot
# part of the deploy happened, and its caveats still apply.
DONE="Done."
if [ "${#FAILED_REPOS[@]}" -gt 0 ]; then
  DONE="Bot deployed, clones not (see below)."
fi
if [ "$RESTART" = "1" ] || [ "$CLEAR" = "1" ]; then
  echo "$DONE The bot answers the next message with the edited instructions."
else
  echo "$DONE The bot files on the server are current — but a session already running"
  echo "keeps the rules it started with. Add --restart so the next message spawns"
  echo "a fresh container."
fi
if [ "$CLEAR" = "0" ]; then
  echo "The $AGENT_GROUP conversation is untouched. Add --clear when the running"
  echo "thread itself carries the rule you just corrected."
fi

if [ "${#FAILED_REPOS[@]}" -gt 0 ]; then
  echo "Not updated on $SERVER: ${FAILED_REPOS[*]} — clone missing, fetch failed," >&2
  echo "not on main, diverged, or a local file in the way (git's message is above," >&2
  echo "if it gave one). Fix the clone; re-running with --clear does not help." >&2
  exit 1
fi
