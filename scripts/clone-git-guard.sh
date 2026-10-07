# Sourced, not executed: scripts/deploy-lunobot.sh streams this file to the
# server ahead of the commands it runs in a clone.
#
# The clones the deploy updates are mounted read-write into agent containers,
# .git included. Git executes what a repository's config names — hooks,
# fsmonitor, an uploadpack command, an included file's settings — so a clone an
# agent has written to is untrusted input to every git call made in it. Two
# layers:
#
# - guard_clone refuses a clone whose .git is not a plain directory, that
#   redirects its common dir, or whose .git/config holds any key outside a
#   short allowlist. It reads the file with --file, which does not follow
#   includes and executes nothing.
# - git() pins the settings that run commands, so even an allowed key cannot
#   reach a hook or a monitor, and GIT_CONFIG_NOSYSTEM keeps /etc/gitconfig out.

export GIT_CONFIG_NOSYSTEM=1

git() {
  command git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"
}

# What `git clone` writes, and nothing that names a program or another file.
# core.ignorecase/precomposeunicode are written on macOS.
CLONE_CONFIG_ALLOWLIST='^(remote\.[^.]+\.(url|fetch|pushurl)|branch\.[^.]+\.(remote|merge)|core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode))$'

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
