# NIBI-GO Android runtime: sourced by bash through BASH_ENV.
# The host (Kotlin) already sets NIBI_BIN / PATH / GIT_* before the kernel
# starts; this file only adds shell-level compatibility helpers.

# App data scripts cannot be execve()'d on targetSdk 36. Anything the shell
# cannot find (npm .bin, package CLIs) is handed to nibi-run, which resolves
# shebangs and refuses app-data ELF with an actionable message.
command_not_found_handle() {
  if command -v nibi-run >/dev/null 2>&1; then
    nibi-run "$@"
    return $?
  fi
  printf 'nibi: 命令不存在：%s\n' "$1" >&2
  return 127
}

# GNU-ish utilities that Android's toybox either lacks or implements with
# different flags. BusyBox is shipped in jniLibs as libbusybox.so; its applet
# names are symlinks in $NIBI_BIN.
for _nibi_applet in grep sed awk find xargs tar gzip gunzip zcat diff patch \
  wc head tail sort uniq cut tr stat du df; do
  if command -v "busybox" >/dev/null 2>&1; then
    eval "${_nibi_applet}() { busybox ${_nibi_applet} \"\$@\"; }"
  fi
done
unset _nibi_applet

export GIT_CONFIG_NOSYSTEM=1
: "${SSL_CERT_DIR:=/system/etc/security/cacerts}"
export SSL_CERT_DIR
