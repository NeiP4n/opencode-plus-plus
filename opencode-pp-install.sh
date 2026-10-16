#!/bin/sh
# Installs Opencode++ for Linux, macOS and Android (Termux) with one command:
#
#   curl -fsSL https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/opencode-pp-install.sh | sh
#
# Missing git, curl or unzip come from the system package manager (it may ask
# for your sudo password). Bun is downloaded as a release archive so the
# installer works correctly when this script is piped through `sh`, including
# inside Termux/proot-distro. The newest release is checked out into
# ~/.local/share/opencode-pp and the `opencode-pp` command goes to
# ~/.local/bin, which is added to the shell's PATH. A regular opencode keeps
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

# Android (Termux): Bun and the terminal UI's native library are built for glibc Linux, not
# Android, so Opencode++ lives in a Debian made by proot-distro and this same script installs it
# there as on any Linux. The `opencode-pp` command in Termux enters that Debian with the Termux
# home and shared storage visible at their usual paths, in the folder it was started from, and
# starts the interface in its phone layout.
# Running this again in Termux updates, and so does the app's own updater inside Debian.
termux() {
  DISTRO="${OPENCODE_PP_DISTRO:-debian}"
  URL="${OPENCODE_PP_INSTALL_URL:-https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/$BRANCH/opencode-pp-install.sh}"

  if ! need proot-distro; then
    echo "Installing proot-distro…"
    pkg install -y proot-distro || fail "could not install proot-distro. Run: pkg install proot-distro"
  fi
  # Ask proot-distro itself instead of looking for the rootfs folder: newer releases keep
  # "containers" elsewhere, and a stale path made a second run fail with "already exists".
  if ! proot-distro login "$DISTRO" -- true >/dev/null 2>&1; then
    echo "Installing $DISTRO for Opencode++ (once, a few hundred MB)…"
    proot-distro install "$DISTRO" || fail "could not install $DISTRO with proot-distro."
  fi

  # The script goes in through the Termux home, which Debian sees at the same path. A local copy
  # (sh opencode-pp-install.sh) installs itself; `curl | sh` has no file, so it is downloaded.
  mkdir -p "$HOME/.cache"
  script="$HOME/.cache/opencode-pp-install.sh"
  if [ -f "$0" ] && grep -q "installed by opencode-pp-install.sh" "$0"; then
    cp "$0" "$script"
  else
    curl -fsSL "$URL" -o "$script" || fail "could not download $URL"
  fi
  proot-distro login "$DISTRO" --bind "$HOME:$HOME" -- env \
    OPENCODE_PP_REPO="$REPO" OPENCODE_PP_BRANCH="$BRANCH" OPENCODE_PP_TERMUX=1 \
    ${OPENCODE_PP_DIR:+OPENCODE_PP_DIR="$OPENCODE_PP_DIR"} \
    sh "$script" || fail "installing inside $DISTRO failed."

  # proot-distro starts Debian with a clean environment; the terminal type, colors and language
  # come along explicitly. A folder Debian cannot see (inside $PREFIX) starts in Debian's home.
  cat >"$PREFIX/bin/opencode-pp" <<WRAPPER
#!$PREFIX/bin/sh
# Opencode++ for Termux, installed by opencode-pp-install.sh. Runs inside proot-distro $DISTRO.
set -- --bind "\$HOME:\$HOME" -- env OPENCODE_PP_MOBILE=1 TERM="\${TERM:-xterm-256color}" COLORTERM="\${COLORTERM:-truecolor}" LANG="\${LANG:-C.UTF-8}" /root/.local/bin/opencode-pp "\$@"
case "\$PWD" in
  "\$HOME"|"\$HOME"/*|/sdcard|/sdcard/*|/storage/*) set -- --work-dir "\$PWD" "\$@" ;;
esac
exec proot-distro login $DISTRO "\$@"
WRAPPER
  chmod +x "$PREFIX/bin/opencode-pp"

  echo
  echo "Opencode++ is installed in Termux. Run: opencode-pp"
  [ -d "$HOME/storage" ] || echo "To work with files in phone storage, run once: termux-setup-storage"
  exit 0
}
case "${PREFIX:-}" in
  */com.termux/*) need pkg && termux ;;
esac

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

# Install Bun without `curl | bash`. The old approach ran Bun's completion command from a
# piped child shell and did not reliably propagate ~/.bun/bin back to this installer. It also
# made a Bun/proot crash look like a generic installer failure. Downloading the official release
# archive avoids both problems. On Termux/PRoot, try known stable releases until one passes a
# real `bun --version` probe; this handles runtime regressions in newer Bun builds gracefully.
install_bun() {
  install_dir="${BUN_INSTALL:-$HOME/.bun}"
  bin_dir="$install_dir/bin"
  mkdir -p "$bin_dir"

  arch=$(uname -m)
  case "$arch" in
    aarch64|arm64) target="linux-aarch64" ;;
    x86_64|amd64) target="linux-x64" ;;
    *) fail "unsupported CPU architecture for Bun: $arch" ;;
  esac

  if [ -n "${OPENCODE_PP_BUN_VERSION:-}" ]; then
    versions="$OPENCODE_PP_BUN_VERSION"
  elif [ "${OPENCODE_PP_TERMUX:-0}" = 1 ]; then
    # 1.4.2 is the stable glibc build we use first in the PRoot environment. Newer releases
    # can be tried explicitly with OPENCODE_PP_BUN_VERSION if needed.
    versions="1.4.2 1.4.1 1.3.14"
  else
    versions="1.4.3 1.4.2 1.4.1 1.3.14"
  fi

  for version in $versions; do
    url="https://github.com/oven-sh/bun/releases/download/bun-v$version/bun-$target.zip"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/opencode-pp-bun.XXXXXX")"
    archive="$tmp/bun.zip"
    extracted="$tmp/extracted"

    echo "Installing Bun $version ($target)…"
    if ! curl -fsSL --retry 3 -o "$archive" "$url"; then
      rm -rf "$tmp"
      continue
    fi
    if ! unzip -oq "$archive" -d "$extracted"; then
      rm -rf "$tmp"
      continue
    fi

    candidate="$extracted/bun-$target/bun"
    if [ ! -x "$candidate" ]; then
      rm -rf "$tmp"
      continue
    fi

    cp "$candidate" "$bin_dir/bun"
    chmod 755 "$bin_dir/bun"
    rm -rf "$tmp"

    # Do not let a SIGABRT/SIGSYS from an incompatible Bun build kill the installer.
    # A successful version probe also proves that the binary is actually executable here.
    if "$bin_dir/bun" --version >/dev/null 2>&1; then
      PATH="$bin_dir:$PATH"
      export PATH
      return 0
    fi

    echo "Bun $version cannot run in this environment; trying a compatible release…" >&2
    rm -f "$bin_dir/bun"
  done

  fail "could not install a runnable Bun. Try setting OPENCODE_PP_BUN_VERSION to a compatible Bun release."
}

if ! need bun; then
  install_bun
else
  # Existing Bun may be outside PATH in a non-interactive shell. If ~/.bun/bin exists, prefer it.
  case ":$PATH:" in
    *":$HOME/.bun/bin:"*) ;;
    *)
      [ -x "$HOME/.bun/bin/bun" ] && PATH="$HOME/.bun/bin:$PATH" && export PATH
      ;;
  esac
fi

if ! need bun; then
  fail "Bun is not available after installation"
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
  TARGET="$TAG"
  VERSION="${TAG#release/}"
else
  echo "No release yet; installing branch $BRANCH."
  # Refresh the tracking ref explicitly; a short branch fetch can leave origin/$BRANCH stale
  # with a narrow/custom remote.origin.fetch refspec.
  git -C "$DIR" fetch --quiet --force origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" ||
    fail "could not fetch branch $BRANCH"
  TARGET="origin/$BRANCH"
  VERSION="$BRANCH (no release yet)"
fi

# A previous run or a developer may have left tracked/untracked edits in this checkout.
# Stash them before checkout; never discard the user's work to make an update succeed.
LOCAL_CHANGES=$(git -C "$DIR" status --porcelain) || fail "could not inspect local changes in $DIR"
STASHED_LOCAL_CHANGES=0
if [ -n "$LOCAL_CHANGES" ]; then
  echo "Preserving local changes before updating..."
  git -C "$DIR" stash push --include-untracked --message "opencode-pp installer update $(date -u +%Y-%m-%dT%H:%M:%SZ)" ||
    fail "could not save local changes; no checkout was attempted"
  STASHED_LOCAL_CHANGES=1
fi

restore_local_changes() {
  [ "$STASHED_LOCAL_CHANGES" -eq 1 ] || return 0
  echo "Restoring local changes..."
  if git -C "$DIR" stash pop; then
    STASHED_LOCAL_CHANGES=0
    return 0
  fi
  echo "WARNING: some local changes conflict with the updated source; the saved copy remains in Git stash." >&2
  git -C "$DIR" reset --hard --quiet || echo "WARNING: Git could not clean the partially applied changes." >&2
  echo "Inspect the saved work with: git -C \"$DIR\" stash list" >&2
  echo "Resolve any conflict before reapplying the relevant stash." >&2
  STASHED_LOCAL_CHANGES=0
}

if ! git -C "$DIR" checkout --quiet --detach "$TARGET"; then
  restore_local_changes
  fail "git checkout failed"
fi
restore_local_changes

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
