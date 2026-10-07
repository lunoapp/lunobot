# Sourced, not executed: scripts/deploy-lunobot.sh streams this file to the
# server ahead of the commands it runs in a clone.
#
# The clones the deploy updates are mounted read-write into agent containers,
# .git included. Git executes what a repository's config names — hooks,
# fsmonitor, filters, an uploadpack command, a credential helper, an included
# file's settings — so a clone an agent has written to is untrusted input to
# every git call made in it. Three layers:
#
# - guard_clone refuses a clone whose .git is not a plain directory, that
#   redirects its common dir, or whose .git/config holds any key outside a
#   short allowlist. It reads the file with --file, which does not follow
#   includes and executes nothing.
# - git() pins every setting that runs a program or reaches another repo, with
#   the caller's GIT_* environment, the system and the global config removed.
# - fetch_main fetches an explicit URL, read from the allowlisted config and
#   checked to be an ssh GitHub URL of an expected owner, never "origin" by name.

for var in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$var"
done
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null

git() {
  command git \
    -c core.hooksPath=/dev/null \
    -c core.fsmonitor=false \
    -c core.sshCommand=ssh \
    -c core.askPass= \
    -c core.gitProxy= \
    -c core.alternateRefsCommand= \
    -c credential.helper= \
    -c protocol.allow=never \
    -c protocol.ssh.allow=always \
    -c protocol.file.allow=never \
    -c remote.origin.uploadpack=git-upload-pack \
    -c gc.auto=0 \
    -c maintenance.auto=false \
    -c submodule.recurse=false \
    -c fetch.recurseSubmodules=false \
    -c diff.ignoreSubmodules=all \
    -c status.submoduleSummary=false \
    -c core.worktree= \
    -c core.attributesFile=/dev/null \
    -c merge.verifySignatures=false \
    -c gpg.program=false \
    "$@"
}

# What `git clone` writes, plus what the server's checkouts carry today
# (core.hookspath in nanoclaw-v2 — pinned above anyway) and a commit identity.
# Nothing that names a program or another file. `git config --list` prints
# keys lower-cased. core.ignorecase/precomposeunicode are written on macOS.
CLONE_CONFIG_ALLOWLIST='^(remote\.[^.]+\.(url|fetch|pushurl)|branch\.[^.]+\.(remote|merge)|core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|hookspath)|user\.(name|email))$'

# ssh GitHub remotes of the owners the server pulls from: github.com itself or
# one of the host aliases in the nanoclaw user's ~/.ssh/config, each of which
# carries its own deploy key. Exact names, no wildcard.
CLONE_URL_PATTERN='^(git@(github\.com|github-luno|github-prema):|ssh://git@(github\.com|github-luno|github-prema)/)(lunoapp|Prema-Rising)/[A-Za-z0-9._-]+$'

guard_clone() {
  local dir="$1"
  if [ ! -d "$dir/.git" ] || [ -L "$dir/.git" ]; then
    echo "refusing: $dir/.git is not a plain directory" >&2
    return 1
  fi
  if [ -e "$dir/.git/commondir" ]; then
    echo "refusing: $dir/.git/commondir redirects the repository" >&2
    return 1
  fi
  # Attributes name filter and diff drivers; config cannot define one past the
  # allowlist, but an attributes file is where an agent would start.
  if [ -s "$dir/.git/info/attributes" ] || [ -L "$dir/.git/info/attributes" ]; then
    echo "refusing: $dir/.git/info/attributes is not empty" >&2
    return 1
  fi
  local keys bad
  if ! keys="$(command git config --file "$dir/.git/config" --name-only --list)"; then
    echo "refusing: $dir/.git/config is unreadable" >&2
    return 1
  fi
  bad="$(printf '%s\n' "$keys" | grep -Ev "$CLONE_CONFIG_ALLOWLIST" | grep -v '^$' || true)"
  if [ -n "$bad" ]; then
    echo "refusing: $dir/.git/config has keys outside the allowlist — remove them by hand:" >&2
    printf '  %s\n' $bad >&2
    return 1
  fi
}

# Fetch main from the clone's origin URL into refs/remotes/origin/main. Run
# inside the clone, after guard_clone.
fetch_main() {
  local url
  url="$(command git config --file .git/config --get remote.origin.url || true)"
  if ! printf '%s' "$url" | grep -Eq "$CLONE_URL_PATTERN"; then
    echo "refusing: $(pwd) origin URL '$url' is not an expected ssh GitHub URL" >&2
    return 1
  fi
  git fetch --quiet --no-recurse-submodules "$url" '+refs/heads/main:refs/remotes/origin/main'
}
