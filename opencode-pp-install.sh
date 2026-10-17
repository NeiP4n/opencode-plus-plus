#!/bin/sh
# Termux installer wrapper for OpenCode++.
# Revision marker helps diagnose stale raw.githubusercontent.com responses.
INSTALLER_WRAPPER_REV="termux-seccomp-fix-2026-10-17-b"
echo "opencode-pp: installer revision $INSTALLER_WRAPPER_REV"
set -eu

BASE_URL="https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/c01cdcc0414feeed0aed3da6d00bab897df7a18f/opencode-pp-install.sh"
TMP="${TMPDIR:-${PREFIX:-/tmp}}/opencode-pp-installer.$$.sh"
trap 'rm -f "$TMP" "${PREFIX:-/tmp}/tmp/opencode-pp-sigsys-compat.c" 2>/dev/null || true' EXIT

command -v curl >/dev/null 2>&1 || { echo 'opencode-pp: curl is required' >&2; exit 1; }
mkdir -p "$(dirname "$TMP")"
curl -fsSL --retry 3 "$BASE_URL" -o "$TMP"

# The pinned installer already detects Android seccomp, installs the native
# OpenTUI package and creates the launcher. On affected devices its first
# compatibility probe can return Bun's "Unknown Error, pidfd_open" even after
# SIGSYS is converted to ENOSYS. Replace its preliminary handler and relax only
# that probe's fatal line; the final shim below must still pass a spawn test.
# On affected Android builds the SIGSYS context already points past svc, so
# advancing the PC again can corrupt the return path and leave errno as zero.
sed -i 's|uc->uc_mcontext.pc += 4;|/* Android SIGSYS context already points past svc; do not advance PC. */|' "$TMP"
if grep -q 'Bun subprocess still fails with the Android seccomp shim' "$TMP"; then
  sed -i '/fail .*Bun subprocess still fails with the Android seccomp shim.*refusing to install a launcher known to crash/c\
        echo "WARNING: preliminary seccomp probe still fails; applying final shim and rechecking"' "$TMP"
else
  echo "opencode-pp: downloaded installer did not contain the expected seccomp preflight; refusing an unknown installer version" >&2
  exit 1
fi

sh "$TMP"

# Repair a duplicate signal left in some interrupted/overlapping room-chat updates.
# This is intentionally limited to this exact declaration; normal installs are unchanged.
opencode_dir="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
room_chat="$opencode_dir/packages/tui/src/component/room-chat.tsx"
if [ -f "$room_chat" ]; then
  repair_tmp="${room_chat}.repair.$"
  seen_awaiting_ai=0
  duplicate_awaiting_ai=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *'const [awaitingAI, setAwaitingAI] = createSignal(false)'*)
        if [ "$seen_awaiting_ai" -eq 1 ]; then
          duplicate_awaiting_ai=1
          continue
        fi
        seen_awaiting_ai=1
        ;;
    esac
    printf '%s\n' "$line" >> "$repair_tmp"
  done < "$room_chat"
  if [ "$duplicate_awaiting_ai" -eq 1 ]; then
    mv "$repair_tmp" "$room_chat"
    echo "opencode-pp: removed duplicate awaitingAI declaration from room-chat.tsx"
  else
    rm -f "$repair_tmp"
  fi
fi

# Replace the preliminary shim with a handler that stays installed when Bun
# itself calls sigaction(SIGSYS). This is the important difference on Android
# builds where Bun probes pidfd_open through an inline syscall.
if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX" ] && command -v clang >/dev/null 2>&1; then
  shim="$PREFIX/lib/libopencode-sigsys-compat.so"
  src="$PREFIX/tmp/opencode-pp-sigsys-compat.c"
  mkdir -p "$PREFIX/lib" "$PREFIX/tmp"
  cat >"$src" <<'C_SOURCE'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <stdarg.h>
#include <string.h>
#include <sys/ucontext.h>
#include <unistd.h>

#ifndef SYS_SECCOMP
#define SYS_SECCOMP 1
#endif
#ifndef ENOSYS
#define ENOSYS 38
#endif
#ifndef __NR_pidfd_open
#define __NR_pidfd_open 434
#endif
#ifndef __NR_close_range
#define __NR_close_range 436
#endif

static int (*real_sigaction_fn)(int, const struct sigaction *, struct sigaction *);
typedef void (*handler_fn)(int);
static handler_fn (*real_signal_fn)(int, handler_fn);
static struct sigaction requested_sigsys;
static int requested_sigsys_valid;

static void resolve_real_signal_apis(void) {
  if (!real_sigaction_fn)
    real_sigaction_fn = (int (*)(int, const struct sigaction *, struct sigaction *))dlsym(RTLD_NEXT, "sigaction");
  if (!real_signal_fn)
    real_signal_fn = (handler_fn (*)(int, handler_fn))dlsym(RTLD_NEXT, "signal");
}

static void sigsys_handler(int signo, siginfo_t *info, void *context) {
  (void)signo;
  if (!info || info->si_code != SYS_SECCOMP || !context) _exit(128 + SIGSYS);
#if defined(__aarch64__)
  ucontext_t *uc = (ucontext_t *)context;
  /* Android SIGSYS context already points past svc; do not advance PC. */
  uc->uc_mcontext.regs[0] = (unsigned long)(long)-ENOSYS;
#else
  _exit(128 + SIGSYS);
#endif
}

static void install_ours(void) {
  if (!real_sigaction_fn) return;
  struct sigaction ours;
  memset(&ours, 0, sizeof(ours));
  ours.sa_sigaction = sigsys_handler;
  ours.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&ours.sa_mask);
  (void)real_sigaction_fn(SIGSYS, &ours, NULL);
}

__attribute__((constructor))
static void init_sigsys_compat(void) {
  resolve_real_signal_apis();
  install_ours();
}

int sigaction(int signum, const struct sigaction *act, struct sigaction *oldact) {
  resolve_real_signal_apis();
  if (signum != SIGSYS || !real_sigaction_fn)
    return real_sigaction_fn ? real_sigaction_fn(signum, act, oldact) : -1;
  if (oldact) {
    if (requested_sigsys_valid) *oldact = requested_sigsys;
    else memset(oldact, 0, sizeof(*oldact));
  }
  if (act) {
    requested_sigsys = *act;
    requested_sigsys_valid = 1;
  }
  install_ours();
  return 0;
}

handler_fn signal(int signum, handler_fn handler) {
  resolve_real_signal_apis();
  if (signum != SIGSYS || !real_signal_fn)
    return real_signal_fn ? real_signal_fn(signum, handler) : SIG_ERR;
  requested_sigsys.sa_handler = handler;
  sigemptyset(&requested_sigsys.sa_mask);
  requested_sigsys.sa_flags = 0;
  requested_sigsys_valid = 1;
  install_ours();
  return SIG_DFL;
}

typedef long (*real_syscall_fn)(long, long, long, long, long, long, long);
static real_syscall_fn real_syscall_ptr;

long syscall(long number, ...) {
  /* Bun can reach these via libc syscall() before/alongside its inline path. */
  if (number == __NR_pidfd_open || number == __NR_close_range) {
    errno = ENOSYS;
    return -1;
  }
  if (!real_syscall_ptr)
    real_syscall_ptr = (real_syscall_fn)dlsym(RTLD_NEXT, "syscall");
  if (!real_syscall_ptr) {
    errno = ENOSYS;
    return -1;
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
  (void)first; (void)last; (void)flags;
  errno = ENOSYS;
  return -1;
}
C_SOURCE
  clang -shared -fPIC -O2 -Wall -Wextra \
    -Wl,-soname,libopencode-sigsys-compat.so \
    -o "$shim" "$src" -ldl || {
      echo "opencode-pp: could not build final Android seccomp shim" >&2
      exit 1
    }
  rm -f "$src"

  echo "Verifying final Android seccomp shim with Bun subprocess probe…"
  probe_log="$PREFIX/tmp/opencode-pp-final-spawn-probe.log"
  if ! LD_PRELOAD="$shim${LD_PRELOAD:+:$LD_PRELOAD}" "$PREFIX/bin/bun" -e 'const p = Bun.spawnSync([process.execPath, "-e", "process.exit(0)"]); if (p.exitCode !== 0) { process.stderr.write(p.stderr); console.error("child Bun exit code:", p.exitCode); process.exit(1) }' >"$probe_log" 2>&1; then
    cat "$probe_log" >&2
    echo "opencode-pp: final seccomp shim did not pass Bun's pidfd_open/spawn probe." >&2
    echo "The installer and OpenTUI are present, but this Android/Bun combination is still incompatible." >&2
    exit 1
  fi
  rm -f "$probe_log"
  echo "Bun subprocess compatibility check passed with the final seccomp shim."
else
  echo "opencode-pp: clang is unavailable; cannot apply Android seccomp compatibility shim" >&2
  exit 1
fi

exit 0
