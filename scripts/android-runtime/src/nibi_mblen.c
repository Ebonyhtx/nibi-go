/* Android bionic only exposes mblen() from API 26; the app minSdk is 24.
 * Bash calls mblen() in locale.c/shmbutil.c, so build with
 * -Dmblen=nibi_mblen and link this object into the bash executable. */
#include <stddef.h>
#include <wchar.h>

int nibi_mblen(const char *s, size_t n) {
  static mbstate_t st;
  size_t r;
  if (s == NULL) {
    return 0; /* Android is UTF-8; no shift states */
  }
  r = mbrtowc(NULL, s, n, &st);
  if (r == (size_t)-1 || r == (size_t)-2) {
    return -1;
  }
  return (int)r;
}
