#!/bin/sh
# Canonical Opencode++ installer for Linux, macOS and Android/Termux.
# This file itself contains the installer; it never downloads an old pinned revision.
INSTALLER_REVISION="lan-rooms-unified-2026-10-18"
echo "opencode-pp: installer revision $INSTALLER_REVISION"
set -eu

REPO="${OPENCODE_PP_REPO:-https://github.com/NeiP4n/opencode-plus-plus.git}"
DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
BRANCH="${OPENCODE_PP_BRANCH:-lan-rooms}"
# 1.4.0-patched still calls close_range(436), which Android 12's seccomp policy
# traps with SIGSYS ("Bad system call"); 1.4.3-patched replaces that syscall.
TERMUX_BUN_VERSION="${OPENCODE_PP_TERMUX_BUN_VERSION:-1.4.3}"
# Android-native OpenTUI binaries are published with the 0.5.17 package set.
# Keep this override available for testing a later compatible AndroidTUI set.
TERMUX_OPENTUI_VERSION="${OPENCODE_PP_TERMUX_OPENTUI_VERSION:-0.5.17}"
TERMUX_RELEASES="https://github.com/bd-loser/bun-termux/releases/download"
TERMUX_MODE=0
case "${PREFIX:-}" in
  # $PREFIX/bin is always on Termux's PATH, so no shell profile edits are needed.
  */com.termux/*) BIN="${OPENCODE_PP_BIN:-$PREFIX/bin}"; TERMUX_MODE=1 ;;
  *) BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}" ;;
esac

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

# Work around Android seccomp SIGSYS traps seen on some Android releases.
# The shim emulates a trapped syscall as -ENOSYS so runtimes can take their
# normal fallback path; close_range is also intercepted for child-spawn paths.
install_sigsys_compat() {
  shim="$PREFIX/lib/libopencode-sigsys-compat.so"
  [ -f "$shim" ] && return 0

  echo "Bun child-process startup is blocked by Android seccomp; building compatibility shim…"
  pkg install -y clang || fail "could not install clang for the Android seccomp compatibility shim"

  shim_src="$PREFIX/tmp/opencode-pp-sigsys-compat.c"
  mkdir -p "$PREFIX/tmp" "$PREFIX/lib"
  cat >"$shim_src" <<'C_SOURCE'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/ucontext.h>
#include <unistd.h>

#ifndef SYS_SECCOMP
#define SYS_SECCOMP 1
#endif
#ifndef ENOSYS
#define ENOSYS 38
#endif
#ifndef __NR_close_range
#define __NR_close_range 436
#endif

/*
 * Based on the Android seccomp compatibility approach documented by
 * Hope2333/opencode-termux (MIT): a syscall trapped by Android's zygote
 * filter arrives as SIGSYS instead of returning ENOSYS. On aarch64 Bionic,
 * skip the trapped svc and set x0 to -ENOSYS. This is only activated when
 * the installer's child-process probe reproduces SIGSYS.
 */
static void sigsys_handler(int signo, siginfo_t *info, void *context) {
  (void)signo;
  if (!info || info->si_code != SYS_SECCOMP || !context) _exit(128 + SIGSYS);
#if defined(__aarch64__)
  ucontext_t *uc = (ucontext_t *)context;
  uc->uc_mcontext.pc += 4;
  uc->uc_mcontext.regs[0] = (unsigned long)(long)-ENOSYS;
#else
  _exit(128 + SIGSYS);
#endif
}

__attribute__((constructor))
static void install_sigsys_handler(void) {
  struct sigaction sa = {0};
  sa.sa_sigaction = sigsys_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  (void)sigaction(SIGSYS, &sa, NULL);
}

typedef long (*real_syscall_t)(long, long, long, long, long, long, long);
static real_syscall_t real_syscall_ptr;

long syscall(long number, ...) {
  if (number == __NR_close_range) {
    errno = ENOSYS;
    return -1;
  }
  if (!real_syscall_ptr) {
    real_syscall_ptr = (real_syscall_t)dlsym(RTLD_NEXT, "syscall");
    if (!real_syscall_ptr) {
      errno = ENOSYS;
      return -1;
    }
  }
  va_list ap;
  va_start(ap, number);
  long a = va_arg(ap, long);
  long b = va_arg(ap, long);
  long c = va_arg(ap, long);
  long d = va_arg(ap, long);
  long e = va_arg(ap, long);
  long f = va_arg(ap, long);
  va_end(ap);
  return real_syscall_ptr(number, a, b, c, d, e, f);
}

int close_range(unsigned int first, unsigned int last, unsigned int flags) {
  (void)first;
  (void)last;
  (void)flags;
  errno = ENOSYS;
  return -1;
}
C_SOURCE

  clang -shared -fPIC -O2 -Wall -Wextra \
    -Wl,-soname,libopencode-sigsys-compat.so \
    -o "$shim" "$shim_src" -ldl || fail "could not build the Android seccomp compatibility shim"
  rm -f "$shim_src"
}

termux() {
  # Keep the runtime mode separate from TERMUX_ENV, which is a multiline
  # launcher fragment and must not decide whether Android dependencies install.
  TERMUX_MODE=1
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

  probe_log="$PREFIX/tmp/opencode-pp-bun-probe.log"
  status=0
  "$PREFIX/bin/bun" --version >"$probe_log" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    cat "$probe_log" >&2
    if grep -qi 'getrandom' "$probe_log"; then
      install_getrandom_compat
    elif [ "$status" -eq 159 ]; then
      fail "Bun was killed by Android seccomp (Bad system call); Android 10+ on aarch64 is required"
    else
      fail "patched Termux Bun cannot start; see the loader error above"
    fi
  fi
  rm -f "$probe_log"
  "$PREFIX/bin/bun" --version || fail "patched Termux Bun cannot start"

  # A version check alone doesn't exercise Bun's process-spawn path. On some
  # Android seccomp profiles that path can still terminate with SIGSYS.
  echo "Checking Bun subprocess compatibility…"
  spawn_probe_log="$PREFIX/tmp/opencode-pp-bun-spawn-probe.log"
  status=0
  "$PREFIX/bin/bun" -e 'const p = Bun.spawnSync([process.execPath, "-e", "process.exit(0)"]); if (p.exitCode !== 0) { process.stderr.write(p.stderr); console.error("child Bun exit code:", p.exitCode); process.exit(1) }' >"$spawn_probe_log" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    cat "$spawn_probe_log" >&2
    if [ "$status" -eq 159 ] || grep -qiE 'Bad system call|SIGSYS' "$spawn_probe_log"; then
      install_sigsys_compat
      echo "Retrying Bun subprocess compatibility with the seccomp shim…"
      status=0
      LD_PRELOAD="$PREFIX/lib/libopencode-sigsys-compat.so${LD_PRELOAD:+:$LD_PRELOAD}" \
        "$PREFIX/bin/bun" -e 'const p = Bun.spawnSync([process.execPath, "-e", "process.exit(0)"]); if (p.exitCode !== 0) { process.stderr.write(p.stderr); console.error("child Bun exit code:", p.exitCode); process.exit(1) }' \
        >"$spawn_probe_log" 2>&1 || status=$?
      if [ "$status" -ne 0 ]; then
        cat "$spawn_probe_log" >&2
        fail "Bun subprocess still fails with the Android seccomp shim; refusing to install a launcher known to crash"
      fi
      TERMUX_SIGSYS_COMPAT=1
      echo "Bun subprocess compatibility check passed with the seccomp shim."
    else
      fail "Bun subprocess preflight failed (exit $status); refusing to install a launcher known to be unreliable"
    fi
  fi
  rm -f "$spawn_probe_log"

  install_termux_pty
  if [ "${TERMUX_SIGSYS_COMPAT:-0}" = 1 ]; then
    TERMUX_ENV="$TERMUX_ENV
export LD_PRELOAD=\"$PREFIX/lib/libopencode-sigsys-compat.so\${LD_PRELOAD:+:\$LD_PRELOAD}\""
  fi
  # Earlier installers put the launcher in ~/.local/bin, which Termux never puts on PATH.
  old="$HOME/.local/bin/opencode-pp"
  if [ "$old" != "$BIN/opencode-pp" ] && [ -f "$old" ] && grep -q 'installed by install.sh' "$old"; then rm -f "$old"; fi
  # Pin the runtime in the generated launcher. Do not bake in whichever
  # unrelated Bun happens to appear first on PATH during installation.
  OPENCODE_PP_BUN_BIN="$PREFIX/bin/bun"
  export OPENCODE_PP_BUN_BIN
  install_opencode
  exit 0
}

# The npm prebuilts of bun-pty and opencode-pty target glibc and cannot load on
# Bionic, so terminals need the Android builds published next to the Termux Bun.
install_termux_pty() {
  lib="$PREFIX/lib/opencode-pp"
  mkdir -p "$lib"
  fetch_checked "$TERMUX_RELEASES/bun-pty-v0.4.11" librust_pty_arm64_bionic.so "$lib/librust_pty_arm64_bionic.so"
  fetch_checked "$TERMUX_RELEASES/opencode-pty-v0.2.0" opencode-pty-android-aarch64 "$lib/opencode-pty"
  chmod 755 "$lib/opencode-pty"
  TERMUX_ENV="export BUN_PTY_LIB=\"$lib/librust_pty_arm64_bionic.so\"
export OPENCODE_PTY_BIN=\"$lib/opencode-pty\"
# Android has no writable /tmp.
export OPENCODE_PTY_SOCKET_DIR=\"\${OPENCODE_PTY_SOCKET_DIR:-\${TMPDIR:-$PREFIX/tmp}}\""
}

fetch_checked() {
  base="$1"; name="$2"; dest="$3"
  sums="$(curl -fsSL --retry 3 "$base/SHA256SUMS")" || fail "could not download $base/SHA256SUMS"
  expected="$(printf '%s\n' "$sums" | awk -v n="$name" '$2 == n { print $1 }')"
  [ -n "$expected" ] || fail "no checksum for $name"
  if [ -f "$dest" ] && [ "$(sha256sum "$dest" | cut -d' ' -f1)" = "$expected" ]; then return 0; fi
  echo "Downloading $name…"
  curl -fL --retry 3 -o "$dest.tmp" "$base/$name" || fail "could not download $base/$name"
  [ "$(sha256sum "$dest.tmp" | cut -d' ' -f1)" = "$expected" ] || { rm -f "$dest.tmp"; fail "checksum mismatch for $name"; }
  mv "$dest.tmp" "$dest"
}

# Replace OpenTUI's unsupported upstream platform packages with the Android/Bionic
# build maintained by bd-loser/opentui. Do this before bun install so both the
# JavaScript wrappers and native renderer resolve to compatible Android assets.
prepare_termux_opentui() {
  patcher="$PREFIX/tmp/opencode-pp-androidtui-config.mjs"
  mkdir -p "$PREFIX/tmp"
  cat >"$patcher" <<'ANDROIDTUI_CONFIG'
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(process.argv[2] ?? "")
const version = process.argv[3] ?? "0.5.17"
if (!root || !existsSync(path.join(root, "package.json"))) {
  throw new Error("Could not locate the OpenCode++ package.json for Termux configuration")
}
const aliases = {
  "@opentui/core": `npm:@androidtui/core@${version}`,
  "@opentui/keymap": `npm:@androidtui/keymap@${version}`,
  "@opentui/solid": `npm:@androidtui/solid@${version}`,
}
const nativeKey = "@androidtui/core-android-arm64"
const nativeVersion = version
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n")

const rootFile = path.join(root, "package.json")
const rootPkg = readJson(rootFile)
rootPkg.workspaces ??= {}
rootPkg.workspaces.catalog ??= {}
Object.assign(rootPkg.workspaces.catalog, aliases)
rootPkg.overrides ??= {}
rootPkg.optionalDependencies ??= {}
// This installer runs the TypeScript source directly, not Bun's compiled
// single-file output. Keep the Android native asset under its real package
// name; aliasing it to @opentui/core-android-arm64 can leave Bun's filtered
// workspace install without a resolvable @androidtui package.
delete rootPkg.overrides["@opentui/core-android-arm64"]
delete rootPkg.overrides["@androidtui/core-android-arm64"]
delete rootPkg.optionalDependencies["@opentui/core-android-arm64"]
rootPkg.optionalDependencies[nativeKey] = nativeVersion
writeJson(rootFile, rootPkg)

// The installer uses --filter ./packages/cli. The native Android library must
// also be declared by the CLI workspace so Bun links it into the runtime tree.
const cliFile = path.join(root, "packages", "cli", "package.json")
if (!existsSync(cliFile)) throw new Error("Could not locate packages/cli/package.json")
const cliPkg = readJson(cliFile)
cliPkg.optionalDependencies ??= {}
delete cliPkg.optionalDependencies["@opentui/core-android-arm64"]
cliPkg.optionalDependencies[nativeKey] = nativeVersion
writeJson(cliFile, cliPkg)

function rewriteMap(map) {
  if (!map || typeof map !== "object") return false
  let changed = false
  for (const [key, alias] of Object.entries(aliases)) {
    const current = map[key]
    if (typeof current !== "string" || current === "catalog:" || current.startsWith("workspace:")) continue
    if (current !== alias) {
      map[key] = alias
      changed = true
    }
  }
  return changed
}

const skip = new Set([".git", "node_modules", "dist", ".turbo", ".opencode"])
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(path.join(dir, entry.name))
      continue
    }
    if (entry.name !== "package.json") continue
    const file = path.join(dir, entry.name)
    const pkg = readJson(file)
    const changed =
      rewriteMap(pkg.dependencies) |
      rewriteMap(pkg.devDependencies) |
      rewriteMap(pkg.peerDependencies) |
      rewriteMap(pkg.workspaces?.catalog)
    if (changed) writeJson(file, pkg)
  }
}
walk(root)

const bunfig = path.join(root, "bunfig.toml")
if (existsSync(bunfig)) {
  let text = readFileSync(bunfig, "utf8")
  const match = text.match(/^minimumReleaseAgeExcludes\s*=\s*(\[[^\n]*\])\s*$/m)
  if (!match) throw new Error("Could not find minimumReleaseAgeExcludes in bunfig.toml")
  const excludes = JSON.parse(match[1])
  for (const name of ["@androidtui/core", "@androidtui/keymap", "@androidtui/solid", "@androidtui/core-android-arm64"]) {
    if (!excludes.includes(name)) excludes.push(name)
  }
  text = text.replace(match[0], `minimumReleaseAgeExcludes = ${JSON.stringify(excludes)}`)
  writeFileSync(bunfig, text)
}
console.log(`Configured @androidtui OpenTUI packages at ${version} for Termux`)
ANDROIDTUI_CONFIG
  "$BUN_BIN" "$patcher" "$DIR" "$TERMUX_OPENTUI_VERSION" || fail "could not configure Android-compatible OpenTUI packages"
  rm -f "$patcher"
}

install_opencode() {
  if [ -n "${OPENCODE_PP_BUN_BIN:-}" ]; then
    BUN_BIN="$OPENCODE_PP_BUN_BIN"
  else
    BUN_BIN="$(command -v bun || true)"
  fi
  [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN" ] || fail "Bun executable not found or not executable: $BUN_BIN"

  # Child scripts and lifecycle hooks must also resolve the same runtime.
  PATH="$(dirname "$BUN_BIN"):$PATH"
  export PATH

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

  LOCAL_CHANGES=$(git -C "$DIR" status --porcelain --untracked-files=no) || fail "could not inspect local changes"
  STASHED=0
  if [ -n "$LOCAL_CHANGES" ]; then
    echo "Preserving local changes before updating…"
    git -C "$DIR" stash push --message "opencode-pp installer update $(date -u +%Y-%m-%dT%H:%M:%SZ)" || fail "could not save tracked local changes"
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

  if [ "${TERMUX_MODE:-0}" = 1 ]; then
    echo "Termux detected: preparing Android/Bionic OpenTUI renderer…"
    prepare_termux_opentui
    echo "Installing Android-compatible OpenTUI packages…"
    # The Android aliases require a lockfile refresh; frozen-lockfile would
    # reject the platform-specific dependency mapping.
    (cd "$DIR" && "$BUN_BIN" install --filter ./packages/cli) || fail "could not install Android-compatible OpenTUI dependencies"
    (cd "$DIR/packages/cli" && "$BUN_BIN" -e 'import { existsSync } from "node:fs"; import path from "node:path"; const candidates = [path.join(process.cwd(), "node_modules/@androidtui/core-android-arm64/libopentui.so"), path.resolve(process.cwd(), "../../node_modules/@androidtui/core-android-arm64/libopentui.so")]; const asset = candidates.find(existsSync); if (!asset) throw new Error("libopentui.so missing from @androidtui/core-android-arm64"); console.log("Android OpenTUI native asset:", asset)') || fail "Android OpenTUI native library is missing from the CLI dependency tree"
  else
    echo "Installing dependencies…"
    (cd "$DIR" && "$BUN_BIN" install --frozen-lockfile --filter ./packages/cli)
  fi

  mkdir -p "$BIN"
  cat >"$BIN/opencode-pp" <<WRAPPER
#!/bin/sh
# Opencode++ $VERSION, installed by opencode-pp-install.sh.
${TERMUX_ENV:-}
OPENCODE_COMMAND=opencode-pp exec "$BUN_BIN" --preload="$DIR/packages/cli/node_modules/@opentui/solid/scripts/preload.js" "$DIR/packages/cli/src/index.ts" "\$@"
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
      # bash reads ~/.bash_profile instead of ~/.profile when it exists.
      [ -f "$HOME/.bash_profile" ] && add_path "$HOME/.bash_profile" "export PATH=\"$BIN:\$PATH\""
      { [ -f "$HOME/.bashrc" ] || need bash; } && add_path "$HOME/.bashrc" "export PATH=\"$BIN:\$PATH\""
      { [ -f "$HOME/.zshrc" ] || need zsh; } && add_path "$HOME/.zshrc" "export PATH=\"$BIN:\$PATH\""
      need fish && add_path "$HOME/.config/fish/config.fish" "fish_add_path \"$BIN\""
      ADDED=1 ;;
  esac
  echo
  echo "Opencode++ $VERSION is installed."
  if [ "${ADDED:-0}" = 1 ]; then
    echo "PATH was updated for new terminals. To use it in this one, run:"
    echo "  export PATH=\"$BIN:\$PATH\" && opencode-pp"
  else
    echo "Run: opencode-pp"
  fi
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
