#!/usr/bin/env bash
# Work around a linuxdeploy-plugin-gtk bug that breaks the AppImage bundle on
# multilib distros (Fedora, Arch, openSUSE — anywhere 32-bit libs live in
# /usr/lib and 64-bit libs in /usr/lib64).
#
# The plugin deploys the GIO TLS module with a `find /usr/lib*` glob, which also
# matches the i686 copy of libgiognutls.so if any *.i686 package is installed
# (Steam, Wine, …). linuxdeploy then drags that library's 32-bit dependencies
# into the AppDir, and appimagetool refuses to package a multi-architecture
# AppDir:
#
#   More than one architectures were found of the AppDir source directory
#
# This rewrites the glob to the native libdir that pkg-config already resolved
# a few lines above. It's idempotent, and a no-op on non-Linux hosts.
#
# Tauri caches the plugin in ~/.cache/tauri and only re-downloads it when the
# file is missing, so patching the cache is enough — but we fetch it first if it
# isn't there yet, otherwise the first build would download a pristine copy and
# fail before we ever get a chance to patch it.
set -euo pipefail

[ "$(uname -s)" = "Linux" ] || exit 0

PLUGIN="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-gtk.sh"
PLUGIN_URL="https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh"

if [ ! -f "$PLUGIN" ]; then
  mkdir -p "$(dirname "$PLUGIN")"
  echo "fix-linuxdeploy-gtk: downloading $PLUGIN_URL"
  curl -fsSL "$PLUGIN_URL" -o "$PLUGIN"
  chmod +x "$PLUGIN"
fi

if grep -q 'find /usr/lib\* -name libgiognutls.so' "$PLUGIN"; then
  sed -i \
    -e 's|find /usr/lib\* -name libgiognutls.so|find "$gio_libdir" -name libgiognutls.so|' \
    -e 's|find "$APPDIR"/usr/lib\* -name libgiognutls.so|find "$APPDIR$gio_libdir" -name libgiognutls.so|' \
    "$PLUGIN"
  echo "fix-linuxdeploy-gtk: patched $PLUGIN"
else
  echo "fix-linuxdeploy-gtk: $PLUGIN already patched"
fi
