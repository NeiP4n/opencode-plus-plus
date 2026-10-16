#!/bin/sh
# Install Opencode++ for Linux, macOS and Android/Termux.
# Termux uses the official Termux glibc runtime instead of proot-distro. This avoids
# Android ptrace/seccomp crashes in proot while still providing the glibc ABI required
# by Bun and OpenTUI.
set -eu

REPO="${OPENCODE_PP_REPO:-https://github.com/NeiP4n/opencode-plus-plus.git}"
DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}"
BRANCH="${OPENCODE_PP_BRANCH:-lan-rooms}"

fail() { echo "opencode-pp: $1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1; }

packages() {
  sudo=""
  if [ "$(id -u)" -ne 0 ]; then
    need sudo || return 1
    sudo=sudo
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

install_bun() {
  install_dir="${BUN_INSTALL:-$HOME/.bun}"
  bin_dir="$install_dir/bin"
  mkdir -p "$bin_dir"

  case "$(uname -m)" in
    aarch64|arm64) target=linux-aarch64 ;;
    x86_64|amd64) target=linux-x64 ;;
    *) fail "unsupported CPU architecture for Bun: $(uname -m)" ;;
  esac

  if [ -n "${OPENCODE_PP_BUN_VERSION:-}" ]; then
    versions="$OPENCODE_PP_BUN_VERSION"
  else
    versions="1.4.2 1.4.1 1.4.0"
  fi

  for version in $versions; do
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/opencode-pp-bun.XXXXXX")"
    archive="$tmp/bun.zip"
    extract="$tmp/extract"
    url="https://github.com/oven-sh/bun/releases/download/bun-v$version/bun-$target.zip"
    echo "Installing Bun $version ($target)…"

    if ! curl -fsSL --retry 3 -o "$archive" "$url" || ! unzip -oq "$archive" -d "$extract"; then
      rm -rf "$tmp"
      continue
    fi

    candidate="$extract/bun-$target/bun"
    if [ ! -x "$candidate" ]; then
      rm -rf "$tmp"
      continue
    fi
    cp "$candidate" "$bin_dir/bun"
    chmod 755 "$bin_dir/bun"
    rm -rf "$tmp"

    # Android uses bionic, so a glibc Bun must be tested through glibc-runner.
    if [ "${OPENCODE_PP_TERMUX:-0}" = 1 ]; then
      if grun "$bin_dir/bun" --version >/dev/null 2>&1; then
        return 0
      fi
    elif "$bin_dir/bun" --version >/dev/null 2>&1; then
      PATH="$bin_dir:$PATH"
      export PATH
      return 0
    fi
    echo "Bun $version cannot run here; trying an older release…" >&2
    rm -f "$bin_dir/bun"
  done
  fail "could not install a runnable Bun"
}

termux() {
  # Do NOT use proot-distro here. The exact crash reported on the phone is PRoot's
  # tracee/seccomp assertion (IS_IN_SYSENTER), so changing bind mappings cannot fix it.
  # Termux has an official glibc repository and glibc-runner specifically for running
  # glibc Linux binaries without PRoot.
  echo "Configuring Termux glibc runtime…"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y glibc-repo || fail "could not install glibc-repo"
  pkg update -y || fail "could not update Termux package lists"
  pkg install -y glibc glibc-runner git curl unzip || fail "could not install Termux glibc runtime"

  need grun || fail "glibc-runner installed but 'grun' is not available"

  # Mark this before installing Bun so install_bun validates the Linux binary with grun.
  export OPENCODE_PP_TERMUX=1

  # Use a user-local bin directory. It is also where the final opencode-pp wrapper is placed.
  mkdir -p "$BIN"
  case ":$PATH:" in
    *":$BIN:"*) ;;
    *) PATH="$BIN:$PATH"; export PATH ;;
  esac

  # Download/install Bun as a Linux glibc binary. Keep the real binary as `buno` and expose
  # a small `bun` wrapper that always enters the glibc environment through grun.
  if ! need bun; then
    install_bun
  fi
  [ -x "$HOME/.bun/bin/bun" ] || fail "Bun was not installed"
  mv -f "$HOME/.bun/bin/bun" "$HOME/.bun/bin/buno"
  cat >"$BIN/bun" <<'WRAPPER'
#!/bin/sh
exec grun "$HOME/.bun/bin/buno" "$@"
WRAPPER
  chmod +x "$BIN/bun"

  # Make sure the wrapper itself is functional before doing the repository install.
  bun --version || fail "Bun cannot start through glibc-runner"

  if [ -d "$DIR/.git" ]; then
    echo "Updating $DIR…"
    git -C "$DIR" fetch --force --prune origin '+refs/tags/release/*:refs/tags/release/*'
  else
    echo "Downloading Opencode++ into $DIR…"
    git clone --filter=blob:none "$REPO" "$DIR"
  fi

  TAG=$(git -C "$DIR" tag -l 'release/*' --sort=-v:refname | head -n 1)
  if [ -n "$TAG" ]; then
    TARGET="$TAG"
    VERSION="${TAG#release/}"
  else
    echo "No release yet; installing branch $BRANCH."
    git -C "$DIR" fetch --quiet --force origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || fail "could not fetch branch $BRANCH"
    TARGET="origin/$BRANCH"
    VERSION="$BRANCH (no release yet)"
  fi

  LOCAL_CHANGES=$(git -C "$DIR" status --porcelain) || fail "could not inspect local changes"
  STASHED=0
  if [ -n "$LOCAL_CHANGES" ]; then
    echo "Preserving local changes before updating…"
    git -C "$DIR" stash push --include-untracked --message "opencode-pp installer update" || fail "could not save local changes"
    STASHED=1
  fi

  restore() {
    [ "$STASHED" -eq 1 ] || return 0
    echo "Restoring local changes…"
    if git -C "$DIR" stash pop; then
      STASHED=0
    else
      echo "WARNING: changes conflicted; saved copy remains in Git stash." >&2
      git -C "$DIR" reset --hard --quiet || true
      git -C "$DIR" stash list >&2
      STASHED=0
    fi
  }

  if ! git -C "$DIR" checkout --quiet --detach "$TARGET"; then
    restore
    fail "git checkout failed"
  fi
  restore

  echo "Installing dependencies with glibc Bun…"
  (cd "$DIR" && bun install --frozen-lockfile --filter ./packages/cli)

  mkdir -p "$BIN"
  cat >"$BIN/opencode-pp" <<WRAPPER
#!/bin/sh
# Opencode++ $VERSION, installed by opencode-pp-install.sh.
OPENCODE_COMMAND=opencode-pp exec "$(dirname "$0")/bun" --preload="$DIR/packages/cli/node_modules/@opentui/solid/scripts/preload.js" "$DIR/packages/cli/src/index.ts" "\$@"
WRAPPER
  chmod +x "$BIN/opencode-pp"

  echo
  echo "Opencode++ $VERSION is installed in Termux using glibc-runner (no proot)."
  echo "Run: opencode-pp"
  exit 0
}

case "${PREFIX:-}" in
  */com.termux/*) termux ;;
esac

missing=""
for tool in git curl unzip; do
  need "$tool" || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Installing$missing…"
  # shellcheck disable=SC2086
  packages $missing || fail "could not install$missing"
fi

if ! need bun; then
  [ -x "$HOME/.bun/bin/bun" ] && PATH="$HOME/.bun/bin:$PATH" && export PATH
fi
need bun || install_bun
need bun || fail "Bun is not available"

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR…"
  git -C "$DIR" fetch --force --prune origin '+refs/tags/release/*:refs/tags/release/*'
else
  echo "Downloading Opencode++ into $DIR…"
  git clone --filter=blob:none "$REPO" "$DIR"
fi

TAG=$(git -C "$DIR" tag -l 'release/*' --sort=-v:refname | head -n 1)
if [ -n "$TAG" ]; then
  TARGET="$TAG"
  VERSION="${TAG#release/}"
else
  echo "No release yet; installing branch $BRANCH."
  git -C "$DIR" fetch --quiet --force origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || fail "could not fetch branch $BRANCH"
  TARGET="origin/$BRANCH"
  VERSION="$BRANCH (no release yet)"
fi

LOCAL_CHANGES=$(git -C "$DIR" status --porcelain) || fail "could not inspect local changes"
STASHED=0
if [ -n "$LOCAL_CHANGES" ]; then
  echo "Preserving local changes before updating…"
  git -C "$DIR" stash push --include-untracked --message "opencode-pp installer update" || fail "could not save local changes"
  STASHED=1
fi

restore() {
  [ "$STASHED" -eq 1 ] || return 0
  echo "Restoring local changes…"
  if git -C "$DIR" stash pop; then
    STASHED=0
  else
    echo "WARNING: changes conflicted; saved copy remains in Git stash." >&2
    git -C "$DIR" reset --hard --quiet || true
    git -C "$DIR" stash list >&2
    STASHED=0
  fi
}

if ! git -C "$DIR" checkout --quiet --detach "$TARGET"; then
  restore
  fail "git checkout failed"
fi
restore

echo "Installing dependencies…"
(cd "$DIR" && bun install --frozen-lockfile --filter ./packages/cli)

mkdir -p "$BIN"
cat >"$BIN/opencode-pp" <<WRAPPER
#!/bin/sh
# Opencode++ $VERSION, installed by opencode-pp-install.sh.
OPENCODE_COMMAND=opencode-pp exec "$(command -v bun)" --preload="$DIR/packages/cli/node_modules/@opentui/solid/scripts/preload.js" "$DIR/packages/cli/src/index.ts" "\$@"
WRAPPER
chmod +x "$BIN/opencode-pp"

if [ -f "$BIN/opencode" ] && grep -q 'installed by opencode-pp-install.sh' "$BIN/opencode"; then
  rm -f "$BIN/opencode"
fi

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
[ "${ADDED:-0}" = 1 ] && echo "Open a new terminal and run: opencode-pp" || echo "Run: opencode-pp"
