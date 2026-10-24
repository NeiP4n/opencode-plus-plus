#!/bin/sh
# Removes Opencode++ installed by install.sh on Linux, macOS and Android/Termux:
#
#   curl -fsSL https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/uninstall.sh | sh
#
# Removes the source checkout, the `opencode-pp` command, the PATH lines the installer
# added and, on Termux, the Android libraries it built or downloaded. Sessions, settings
# and credentials in ~/.config/opencode and ~/.local/share/opencode are shared with a
# regular opencode, so they stay unless OPENCODE_PP_PURGE=1 is set. Bun and git stay too:
# other programs may use them.
set -eu

DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
case "${PREFIX:-}" in
  */com.termux/*) BIN="${OPENCODE_PP_BIN:-$PREFIX/bin}"; TERMUX_MODE=1 ;;
  *) BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}"; TERMUX_MODE=0 ;;
esac

removed=0
gone() {
  echo "Removed $1"
  removed=1
}

# Only wrappers this project's installers wrote; an unrelated `opencode-pp` stays.
ours() {
  [ -f "$1" ] && grep -qE 'installed by (install\.sh|opencode-pp-install\.sh)' "$1"
}
for file in "$BIN/opencode-pp" "$BIN/opencode" "$HOME/.local/bin/opencode-pp"; do
  if ours "$file"; then
    rm -f "$file"
    gone "$file"
  fi
done

if [ -d "$DIR/.git" ]; then
  # The installer keeps local edits in a stash across updates; say so before they go.
  stashes=$(git -C "$DIR" stash list 2>/dev/null | wc -l | tr -d ' ')
  [ "${stashes:-0}" -gt 0 ] && echo "Note: $DIR had $stashes saved local change(s) in Git stash; they are removed with it."
  rm -rf "$DIR"
  gone "$DIR"
elif [ -e "$DIR" ]; then
  echo "Skipped $DIR: not an Opencode++ checkout." >&2
fi

# Drops the installer's `# Opencode++` marker and the PATH line written right after it.
clean_path() {
  file="$1"
  [ -f "$file" ] && grep -qx '# Opencode++' "$file" || return 0
  tmp="$file.opencode-pp.$$"
  awk -v bin="$BIN" '
    $0 == "# Opencode++" { held = $0; next }
    held != "" {
      if (index($0, bin) && ($0 ~ /^export PATH=/ || $0 ~ /^fish_add_path /)) { held = ""; next }
      print held; held = ""
    }
    { print }
    END { if (held != "") print held }
  ' "$file" >"$tmp"
  # cat keeps the file's owner, mode and symlinks, which mv would replace.
  cat "$tmp" >"$file"
  rm -f "$tmp"
  echo "Cleaned PATH in $file"
}
for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.config/fish/config.fish"; do
  clean_path "$file"
done

if [ "$TERMUX_MODE" = 1 ]; then
  for file in "$PREFIX/lib/opencode-pp" "$PREFIX/lib/libopencode-sigsys-compat.so"; do
    if [ -e "$file" ]; then
      rm -rf "$file"
      gone "$file"
    fi
  done
  # The getrandom shim stays when the Bun launchers still load it; without it Bun would not start.
  shim="$PREFIX/lib/libopencode-getrandom-compat.so"
  if [ -f "$shim" ] && ! grep -qs 'libopencode-getrandom-compat' "$PREFIX/bin/bun" "$PREFIX/bin/bunx"; then
    rm -f "$shim"
    gone "$shim"
  fi
fi

if [ "${OPENCODE_PP_PURGE:-0}" = 1 ]; then
  # The same folders a regular opencode uses: purging removes its sessions and settings too.
  for dir in \
    "${XDG_DATA_HOME:-$HOME/.local/share}/opencode" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/opencode" \
    "${XDG_STATE_HOME:-$HOME/.local/state}/opencode" \
    "${XDG_CACHE_HOME:-$HOME/.cache}/opencode"; do
    if [ -e "$dir" ]; then
      rm -rf "$dir"
      gone "$dir"
    fi
  done
fi

echo
if [ "$removed" = 1 ]; then
  echo "Opencode++ is uninstalled."
else
  echo "Opencode++ was not found in $DIR or $BIN."
fi
if [ "${OPENCODE_PP_PURGE:-0}" != 1 ]; then
  echo "Sessions and settings in ~/.config/opencode and ~/.local/share/opencode are kept (shared with opencode)."
  echo "To remove them too, run the same command with OPENCODE_PP_PURGE=1 in front of sh."
fi
