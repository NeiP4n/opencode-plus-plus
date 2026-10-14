#!/bin/sh
# Installs Opencode++ for Linux and macOS with one command:
#
#   curl -fsSL https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/opencode-pp-install.sh | sh
#
# Missing git, curl or unzip come from the system package manager (it may ask
# for your sudo password), Bun from bun.sh. The newest release is checked out
# into ~/.local/share/opencode-pp and the `opencode-pp` command goes to
# ~/.local/bin, which is added to your shell's PATH. A regular opencode keeps
# the `opencode` command. Running this again updates.
set -eu

REPO="${OPENCODE_PP_REPO:-https://github.com/NeiP4n/opencode-plus-plus.git}"
DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}"
BRANCH="${OPENCODE_PP_BRANCH:-lan-rooms}"

fail() {
  echo "opencode-pp: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1
}

# The system package manager installs what the installer itself needs. Root needs no sudo.
packages() {
  sudo=""
  if [ "$(id -u)" -ne 0 ]; then
    need sudo || return 1
    sudo="sudo"
  fi
  if need apt-get; then
    $sudo apt-get update -qq && $sudo apt-get install -y "$@"
  elif need dnf; then
    $sudo dnf install -y "$@"
  elif need pacman; then
    $sudo pacman -S --needed --noconfirm "$@"
  elif need zypper; then
    $sudo zypper --non-interactive install "$@"
  elif need apk; then
    $sudo apk add "$@"
  elif need brew; then
    brew install "$@"
  else
    return 1
  fi
}

missing=""
for tool in git curl unzip; do
  need "$tool" || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Installing$missing…"
  # shellcheck disable=SC2086 # one word per package
  packages $missing || fail "could not install$missing. Install them with your package manager, then run this again."
fi

if ! need bun; then
  echo "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  PATH="$HOME/.bun/bin:$PATH"
  export PATH
fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR…"
  # Refresh only release tags and remove stale local release refs before selecting a version.
  git -C "$DIR" fetch --force --prune origin '+refs/tags/release/*:refs/tags/release/*'
else
  echo "Downloading Opencode++ into $DIR…"
  git clone --filter=blob:none "$REPO" "$DIR"
fi

# Release tag is the normal path. Until the first release exists there is nothing to check
# out, and an installer that only knows tags leaves a newcomer with no way in at all, so the
# branch with the patches is the fallback.
TAG=$(git -C "$DIR" tag -l 'release/*' --sort=-v:refname | head -n 1)
if [ -n "$TAG" ]; then
  git -C "$DIR" checkout --quiet --detach "$TAG"
  VERSION="${TAG#release/}"
else
  echo "No release yet; installing branch $BRANCH."
  # Refresh the tracking ref explicitly; a short branch fetch can leave origin/$BRANCH stale
  # with a narrow/custom remote.origin.fetch refspec.
  git -C "$DIR" fetch --quiet --force origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git -C "$DIR" checkout --quiet --detach "origin/$BRANCH"
  VERSION="$BRANCH (no release yet)"
fi

echo "Installing dependencies…"
# Only what the terminal app needs; the web and desktop apps pull far more.
(cd "$DIR" && bun install --frozen-lockfile --filter ./packages/cli)

mkdir -p "$BIN"
# The command is `opencode-pp`, so a regular opencode on the same machine keeps `opencode`.
# The preload is passed by absolute path: bunfig.toml names it by package, and Bun resolves
# that from the directory the command is started in.
cat >"$BIN/opencode-pp" <<WRAPPER
#!/bin/sh
# Opencode++ $VERSION, installed by opencode-pp-install.sh.
OPENCODE_COMMAND=opencode-pp exec "$(command -v bun)" --preload="$DIR/packages/cli/node_modules/@opentui/solid/scripts/preload.js" "$DIR/packages/cli/src/index.ts" "\$@"
WRAPPER
chmod +x "$BIN/opencode-pp"
# Earlier versions of this installer took the name `opencode`; give it back, but only our own wrapper.
if [ -f "$BIN/opencode" ] && grep -q "installed by opencode-pp-install.sh" "$BIN/opencode"; then
  rm -f "$BIN/opencode"
fi

# New terminals find `opencode-pp` without the user editing anything: one line per shell
# config, written once.
add_path() {
  file="$1"
  line="$2"
  [ -f "$file" ] && grep -qF "$BIN" "$file" && return 0
  mkdir -p "$(dirname "$file")"
  printf '\n# Opencode++\n%s\n' "$line" >>"$file"
}
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    add_path "$HOME/.profile" "export PATH=\"$BIN:\$PATH\""
    [ -f "$HOME/.bashrc" ] && add_path "$HOME/.bashrc" "export PATH=\"$BIN:\$PATH\""
    [ -f "$HOME/.zshrc" ] && add_path "$HOME/.zshrc" "export PATH=\"$BIN:\$PATH\""
    need fish && add_path "$HOME/.config/fish/config.fish" "fish_add_path \"$BIN\""
    ADDED=1
    ;;
esac

echo
echo "Opencode++ $VERSION is installed."
if [ "${ADDED:-0}" = 1 ]; then
  echo "Open a new terminal and run: opencode-pp"
else
  echo "Run: opencode-pp"
fi
