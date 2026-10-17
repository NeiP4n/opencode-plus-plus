#!/bin/sh
# Install Opencode++ for Linux, macOS and Android/Termux.
# Termux uses the source-patched Android/Bionic Bun build.
set -eu

REPO="${OPENCODE_PP_REPO:-https://github.com/NeiP4n/opencode-plus-plus.git}"
DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}"
BRANCH="${OPENCODE_PP_BRANCH:-lan-rooms}"
TERMUX_BUN_VERSION="${OPENCODE_PP_TERMUX_BUN_VERSION:-1.4.0}"

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

  versions="${OPENCODE_PP_BUN_VERSION:-1.4.2 1.4.1 1.4.0}"
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
    if "$bin_dir/bun" --version >/dev/null 2>&1; then
      PATH="$bin_dir:$PATH"; export PATH
      return 0
    fi
    rm -f "$bin_dir/bun"
  done
  fail "could not install a runnable Bun"
}

install_getrandom_compat() {
  echo "Bun needs the Android getrandom compatibility shim; installing clang to build it…"
  pkg install -y clang || fail "could not install clang for the Android compatibility shim"

  shim_src="$PREFIX/tmp/opencode-pp-getrandom-compat.c"
  shim="$PREFIX/lib/libopencode-getrandom-compat.so"
  mkdir -p "$PREFIX/tmp" "$PREFIX/lib"
  cat >"$shim_src" <<'C_SOURCE'
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <sys/types.h>
#include <unistd.h>

/* Compatibility export for Android releases whose Bionic libc does not export
   getrandom(). Use the kernel's /dev/urandom source; Bun calls this for entropy. */
ssize_t getrandom(void *buffer, size_t length, unsigned int flags) {
  (void)flags;
  if (length == 0) return 0;
  if (buffer == NULL) { errno = EFAULT; return -1; }

  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;

  size_t done = 0;
  while (done < length) {
    ssize_t n = read(fd, (char *)buffer + done, length - done);
    if (n > 0) {
      done += (size_t)n;
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    if (n == 0) errno = EIO;
    if (done == 0) {
      int saved_errno = errno;
      close(fd);
      errno = saved_errno;
      return -1;
    }
    break;
  }

  close(fd);
  return (ssize_t)done;
}
C_SOURCE

  clang -shared -fPIC -O2 -Wall -Wextra -Werror \
    -Wl,-soname,libopencode-getrandom-compat.so \
    -o "$shim" "$shim_src" || fail "could not build the getrandom compatibility shim"

  bun_binary="$PREFIX/lib/bun-termux/bun"
  [ -x "$bun_binary" ] || fail "patched Bun binary not found at $bun_binary"
  probe_log="$PREFIX/tmp/opencode-pp-bun-probe.log"
  if ! LD_PRELOAD="$shim${LD_PRELOAD:+:$LD_PRELOAD}" "$bun_binary" --version >"$probe_log" 2>&1; then
    cat "$probe_log" >&2
    fail "Bun still cannot start with the getrandom compatibility shim; this Android build is not compatible"
  fi

  # The package launcher normally execs the binary directly. Add the shim to
  # both launchers so future bun/bunx commands use it too.
  cat >"$PREFIX/bin/bun" <<'BUN_WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export LD_PRELOAD="$PREFIX/lib/libopencode-getrandom-compat.so${LD_PRELOAD:+:$LD_PRELOAD}"
exec "$PREFIX/lib/bun-termux/bun" "$@"
BUN_WRAPPER
  cat >"$PREFIX/bin/bunx" <<'BUNX_WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export LD_PRELOAD="$PREFIX/lib/libopencode-getrandom-compat.so${LD_PRELOAD:+:$LD_PRELOAD}"
exec -a bunx "$PREFIX/lib/bun-termux/bun" "$@"
BUNX_WRAPPER
  chmod 755 "$PREFIX/bin/bun" "$PREFIX/bin/bunx"
  rm -f "$shim_src" "$probe_log"
}

termux() {
  echo "Configuring native Termux/Android runtime…"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y git curl ca-certificates dpkg || fail "could not install Termux prerequisites"

  if ! curl --version >/dev/null 2>&1; then
    echo "Repairing Termux curl/libcurl/OpenSSL packages…"
    pkg upgrade -y || fail "could not synchronize Termux packages"
    pkg reinstall -y libcurl openssl curl ca-certificates || fail "could not repair Termux curl/libcurl/OpenSSL"
  fi
  curl --version >/dev/null 2>&1 || fail "Termux curl is still broken"

  expected_version="${TERMUX_BUN_VERSION}-patched"
  installed_version="$(dpkg-query -W -f='${Version}' bun 2>/dev/null || true)"
  if [ "$installed_version" != "$expected_version" ] || [ ! -x "$PREFIX/lib/bun-termux/bun" ]; then
    echo "Installing source-patched native Bun for Termux…"
    deb="bun_${TERMUX_BUN_VERSION}-patched_aarch64.deb"
    url="https://github.com/bd-loser/bun-termux/releases/download/v${TERMUX_BUN_VERSION}-patched/$deb"
    tmp="$PREFIX/tmp/opencode-pp-$deb"
    mkdir -p "$PREFIX/tmp"
    echo "Downloading $deb…"
    curl -fL --retry 3 -o "$tmp" "$url" || fail "could not download patched Termux Bun ($url)"
    dpkg -i "$tmp" || {
      echo "Fixing Termux package dependencies…"
      apt-get -f install -y || fail "could not install patched Termux Bun dependencies"
      dpkg -i "$tmp" || fail "could not install patched Termux Bun"
    }
    rm -f "$tmp"
  else
    echo "Found patched Bun package; probing runtime compatibility…"
  fi

  if ! bun --version >/dev/null 2>&1; then
    probe_log="$PREFIX/tmp/opencode-pp-bun-probe.log"
    if bun --version >"$probe_log" 2>&1; then
      :
    elif grep -qi 'getrandom' "$probe_log"; then
      cat "$probe_log" >&2
      install_getrandom_compat
    else
      cat "$probe_log" >&2
      fail "patched Termux Bun cannot start; see the loader error above"
    fi
    rm -f "$probe_log"
  fi
  bun --version || fail "patched Termux Bun cannot start"

  mkdir -p "$BIN"
  case ":$PATH:" in *":$BIN:"*) ;; *) PATH="$BIN:$PATH"; export PATH ;; esac
  install_opencode
  exit 0
}

install_opencode() {
  if [ -d "$DIR/.git" ]; then
    echo "Updating $DIR…"
    git -C "$DIR" fetch --force --prune origin '+refs/tags/release/*:refs/tags/release/*'
  else
    echo "Downloading Opencode++ into $DIR…"
    git clone --filter=blob:none "$REPO" "$DIR"
  fi

  TAG=$(git -C "$DIR" tag -l 'release/*' --sort=-v:refname | head -n 1)
  if [ -n "$TAG" ]; then
    TARGET="$TAG"; VERSION="${TAG#release/}"
  else
    echo "No release yet; installing branch $BRANCH."
    git -C "$DIR" fetch --quiet --force origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || fail "could not fetch branch $BRANCH"
    TARGET="origin/$BRANCH"; VERSION="$BRANCH (no release yet)"
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
    if git -C "$DIR" stash pop; then STASHED=0; else
      echo "WARNING: changes conflicted; saved copy remains in Git stash." >&2
      git -C "$DIR" reset --hard --quiet || true
      git -C "$DIR" stash list >&2
      STASHED=0
    fi
  }
  if ! git -C "$DIR" checkout --quiet --detach "$TARGET"; then restore; fail "git checkout failed"; fi
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

  if [ -f "$BIN/opencode" ] && grep -q 'installed by opencode-pp-install.sh' "$BIN/opencode"; then rm -f "$BIN/opencode"; fi
  add_path() {
    file="$1"; line="$2"
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
      ADDED=1 ;;
  esac
  echo
  echo "Opencode++ $VERSION is installed."
  [ "${ADDED:-0}" = 1 ] && echo "Open a new terminal and run: opencode-pp" || echo "Run: opencode-pp"
}

case "${PREFIX:-}" in */com.termux/*) termux ;; esac

missing=""
for tool in git curl unzip; do need "$tool" || missing="$missing $tool"; done
if [ -n "$missing" ]; then
  echo "Installing$missing…"
  packages $missing || fail "could not install$missing"
fi
if ! need bun; then
  [ -x "$HOME/.bun/bin/bun" ] && PATH="$HOME/.bun/bin:$PATH" && export PATH
fi
need bun || install_bun
need bun || fail "Bun is not available"
install_opencode
