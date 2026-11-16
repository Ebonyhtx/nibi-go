/*
 * nibi-run — the one executable Android lets us run from app data.
 *
 * targetSdk 36 / Android 16 refuses execve() on files in the app's data dir.
 * Only nativeLibraryDir is executable, and jniLibs can only hold flat
 * lib*.so names. nibi-run therefore lives in jniLibs as libnibi_run.so and
 * is exposed as $NIBI_BIN/nibi-run (a symlink); everything user-visible
 * (shebang scripts, npm .bin entries, pip console scripts) is resolved here.
 *
 * It also refuses to exec app-data ELF files with an actionable message
 * instead of a bare EACCES from the kernel.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

extern char **environ;

static int trace_enabled(void) {
  const char *v = getenv("NIBI_RUN_TRACE");
  return v && *v && strcmp(v, "0") != 0;
}

static void trace(const char *fmt, const char *a, const char *b) {
  if (!trace_enabled()) return;
  fprintf(stderr, "nibi-run: ");
  fprintf(stderr, fmt, a ? a : "", b ? b : "");
  fputc('\n', stderr);
}

static int is_elf(const char *path) {
  unsigned char magic[4];
  FILE *f = fopen(path, "rb");
  if (!f) return 0;
  size_t n = fread(magic, 1, sizeof(magic), f);
  fclose(f);
  return n == 4 && magic[0] == 0x7f && magic[1] == 'E' && magic[2] == 'L' &&
         magic[3] == 'F';
}

/* Read the first line; returns 1 when it starts with #!. */
static int read_shebang(const char *path, char *line, size_t cap) {
  FILE *f = fopen(path, "rb");
  if (!f) return 0;
  size_t n = fread(line, 1, cap - 1, f);
  fclose(f);
  line[n] = '\0';
  if (n < 2 || line[0] != '#' || line[1] != '!') return 0;
  char *nl = strchr(line, '\n');
  if (nl) *nl = '\0';
  return 1;
}

static int file_exists(const char *path) {
  struct stat st;
  return stat(path, &st) == 0;
}

static int executable(const char *path) {
  return access(path, X_OK) == 0 && file_exists(path);
}

/* realpath() allocation helper; returns NULL on failure. */
static char *real_or_null(const char *path) {
  char *out = realpath(path, NULL);
  return out;
}

static const char *native_dir(void) {
  static char dir[PATH_MAX];
  const char *env = getenv("NIBI_NATIVE_LIB_DIR");
  if (env && *env) return env;
  ssize_t n = readlink("/proc/self/exe", dir, sizeof(dir) - 1);
  if (n <= 0) return NULL;
  dir[n] = '\0';
  char *slash = strrchr(dir, '/');
  if (!slash) return NULL;
  *slash = '\0';
  return dir;
}

static int under_dir(const char *path, const char *dir) {
  if (!dir || !*dir) return 0;
  size_t n = strlen(dir);
  if (strncmp(path, dir, n) != 0) return 0;
  return path[n] == '\0' || path[n] == '/';
}

static void die_app_data_elf(const char *path) {
  fprintf(stderr,
          "nibi-run: 这是 App 数据目录里的原生二进制：%s\n"
          "Android 16 不允许执行 App 数据目录里的 ELF（targetSdk 36 的 noexec 限制）。\n"
          "请改用 Android/bionic 构建的版本，或把脚本交给 nibi-run（脚本不受此限制）。\n",
          path);
  exit(126);
}

static char *join2(const char *a, const char *b) {
  size_t na = strlen(a), nb = strlen(b);
  char *out = malloc(na + nb + 2);
  if (!out) return NULL;
  memcpy(out, a, na);
  out[na] = '/';
  memcpy(out + na + 1, b, nb + 1);
  return out;
}

static const char *bin_dir(void) {
  return getenv("NIBI_BIN");
}

static int is_self(const char *path) {
  char self[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", self, sizeof(self) - 1);
  if (n <= 0) return 0;
  self[n] = '\0';
  char *real = realpath(path, NULL);
  if (!real) return 0;
  int same = strcmp(real, self) == 0;
  free(real);
  return same;
}

static char *search_bin(const char *name) {
  const char *bin = bin_dir();
  if (!bin || !*bin) return NULL;
  char *cand = join2(bin, name);
  /* npm .bin 的常见装法是 $NIBI_BIN/<name> -> nibi-run；跳过自身，
   * 继续去 $NIBI_PACKAGES 找真正的包入口。 */
  if (cand && executable(cand) && !is_self(cand)) return cand;
  free(cand);
  return NULL;
}

/* npm 本地安装：nibi-npm.js 把 node_modules/.bin/<name> 换成指向本程序的
 * symlink，真实入口放在 .bin/.nibi-targets/<name>。shell 通过 PATH 执行时
 * argv[0] 仍是裸命令名，所以还要从 cwd 向上找 node_modules/.bin。 */
static char *shim_in_dir(const char *dir, const char *name, int nested) {
  char *store;
  if (nested) {
    char *modules = join2(dir, "node_modules");
    char *bin = modules ? join2(modules, ".bin") : NULL;
    store = bin ? join2(bin, ".nibi-targets") : NULL;
    free(modules);
    free(bin);
  } else {
    store = join2(dir, ".nibi-targets");
  }
  char *cand = store ? join2(store, name) : NULL;
  free(store);
  if (cand && file_exists(cand)) return cand;
  free(cand);
  return NULL;
}

static char *search_bin_shim(const char *argv0, const char *name) {
  if (argv0) {
    const char *slash = strrchr(argv0, '/');
    if (slash) {
      size_t n = (size_t)(slash - argv0);
      char *dir = malloc(n + 1);
      if (dir) {
        memcpy(dir, argv0, n);
        dir[n] = '\0';
        char *cand = shim_in_dir(dir, name, 0);
        free(dir);
        if (cand) return cand;
      }
    }
  }
  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof(cwd))) return NULL;
  for (;;) {
    char *cand = shim_in_dir(cwd, name, 1);
    if (cand) return cand;
    char *up = strrchr(cwd, '/');
    if (!up || up == cwd) break;
    *up = '\0';
  }
  return NULL;
}

/* Search $PATH. Skips the git-core dispatcher symlinks that point back to
 * this executable: git prepends exec-path to PATH for child commands, and
 * without this guard `git submodule` would recurse into nibi-run forever. */
static char *search_path(const char *name) {
  const char *path = getenv("PATH");
  if (!path || !*path) return NULL;
  char *copy = strdup(path);
  if (!copy) return NULL;
  char *save = NULL;
  for (char *dir = strtok_r(copy, ":", &save); dir; dir = strtok_r(NULL, ":", &save)) {
    if (!*dir) dir = ".";
    char *cand = join2(dir, name);
    if (cand && executable(cand) && !is_self(cand)) {
      free(copy);
      return cand;
    }
    free(cand);
  }
  free(copy);
  return NULL;
}

static char *search_git_scripts(const char *name) {
  const char *rt = getenv("NIBI_RUNTIME_DIR");
  if (!rt || !*rt) return NULL;
  char *dir = join2(rt, "git-scripts");
  if (!dir) return NULL;
  char *cand = join2(dir, name);
  free(dir);
  /* 脚本在 APK asset 里是 0644；nibi-run 会读 shebang 再 exec 解释器，不需要 X_OK。 */
  if (cand && file_exists(cand)) return cand;
  free(cand);
  return NULL;
}

/* git 的 shell 脚本会 `. git-sh-setup`，必须能从 PATH 找到真实文件；
 * git-core 里既有 source-only 脚本，也有指向本程序的 exec 命令 symlink。 */
static void prepend_git_scripts_to_path(void) {
  const char *rt = getenv("NIBI_RUNTIME_DIR");
  if (!rt || !*rt) return;
  char *scripts = join2(rt, "git-scripts");
  char *core = join2(rt, "git-core");
  const char *old = getenv("PATH");
  const char *s = scripts ? scripts : "";
  const char *c = core ? core : "";
  size_t n = strlen(s) + strlen(c) + (old ? strlen(old) : 0) + 4;
  char *next = malloc(n);
  if (next) {
    if (*s && *c) {
      snprintf(next, n, "%s:%s:%s", s, c, old ? old : "");
    } else if (*s) {
      snprintf(next, n, "%s:%s", s, old ? old : "");
    } else if (*c) {
      snprintf(next, n, "%s:%s", c, old ? old : "");
    } else {
      snprintf(next, n, "%s", old ? old : "");
    }
    setenv("PATH", next, 1);
    free(next);
  }
  free(scripts);
  free(core);
}

/* npm/pip 安装的 CLI：.bin 里的条目通常是指向 JS/py 的 symlink，目标没有 X_OK，
 * 但 nibi-run 会读 shebang 再 exec 解释器，所以只要求文件存在。 */
static char *search_packages(const char *name) {
  const char *pkgs = getenv("NIBI_PACKAGES");
  if (!pkgs || !*pkgs) return NULL;
  const char *subdirs[] = {"npm/.nibi-bins", "npm/node_modules/.bin", "npm/bin", "pip/bin", NULL};
  for (int i = 0; subdirs[i]; i++) {
    char *dir = join2(pkgs, subdirs[i]);
    if (!dir) continue;
    char *cand = join2(dir, name);
    free(dir);
    /* .bin/<name> 可能已被安装器重写成指向本程序的 shim，跳过它继续找真身。 */
    if (cand && file_exists(cand) && !is_self(cand)) return cand;
    free(cand);
  }
  return NULL;
}

static char *map_interp(const char *interp) {
  const char *bin = bin_dir();
  const char *base = strrchr(interp, '/');
  base = base ? base + 1 : interp;
  if (strcmp(base, "bash") == 0 || strcmp(base, "zsh") == 0) {
    if (bin) {
      char *p = join2(bin, "bash");
      if (p && executable(p)) return p;
      free(p);
    }
    return NULL;
  }
  if (strcmp(base, "sh") == 0) {
    if (bin) {
      char *p = join2(bin, "bash");
      if (p && executable(p)) return p;
      free(p);
    }
    if (file_exists("/system/bin/sh")) return strdup("/system/bin/sh");
    return NULL;
  }
  if (strcmp(base, "node") == 0 || strcmp(base, "nodejs") == 0) {
    if (!bin) return NULL;
    char *p = join2(bin, "node");
    if (p && executable(p)) return p;
    free(p);
    return NULL;
  }
  if (strncmp(base, "python", 6) == 0) {
    if (!bin) return NULL;
    char *p = join2(bin, "python3");
    if (p && executable(p)) return p;
    free(p);
    p = join2(bin, "python");
    if (p && executable(p)) return p;
    free(p);
    return NULL;
  }
  if (executable(interp)) return strdup(interp);
  return NULL;
}

/* argv0_override lets a $NIBI_BIN symlink keep its user-visible name. */
static void run_script(const char *script, char *const argv[], const char *argv0_override) {
  char line[512];
  if (!read_shebang(script, line, sizeof(line))) {
    fprintf(stderr,
            "nibi-run: 无法执行 %s：既不是 ELF，也没有 shebang。\n"
            "请用 `bash <script>` 或补上 #! 行。\n",
            script);
    exit(126);
  }
  char *p = line + 2;
  while (*p == ' ') p++;
  char *interp = p;
  char *arg = NULL;
  char *sp = strchr(p, ' ');
  if (sp) {
    *sp = '\0';
    arg = sp + 1;
    while (*arg == ' ') arg++;
    if (!*arg) arg = NULL;
  }
  /* 容忍 CRLF shebang（Android 上从桌面同步来的脚本常见）。 */
  size_t ilen = strlen(interp);
  if (ilen > 0 && interp[ilen - 1] == '\r') interp[ilen - 1] = '\0';
  if (arg) {
    size_t alen = strlen(arg);
    if (alen > 0 && arg[alen - 1] == '\r') arg[alen - 1] = '\0';
  }
  prepend_git_scripts_to_path();
  char *mapped = NULL;
  if (strcmp(interp, "/usr/bin/env") == 0 || strcmp(interp, "/bin/env") == 0) {
    if (!arg) {
      fprintf(stderr, "nibi-run: %s 的 shebang 是 env 但没有程序名。\n", script);
      exit(126);
    }
    char *prog = arg;
    char *prog_arg = NULL;
    char *sp2 = strchr(prog, ' ');
    if (sp2) {
      *sp2 = '\0';
      prog_arg = sp2 + 1;
    }
    mapped = search_path(prog);
    if (!mapped) {
      fprintf(stderr,
              "nibi-run: %s 需要 `%s`，但 $NIBI_BIN 与 PATH 里都没有。\n"
              "Node/Python 运行时到 Phase 3 才随包；脚本工具请改用 bash。\n",
              script, prog);
      exit(127);
    }
    if (prog_arg) arg = prog_arg;
    else arg = NULL;
  } else {
    mapped = map_interp(interp);
    if (!mapped) {
      fprintf(stderr,
              "nibi-run: %s 的解释器 `%s` 不可用（$NIBI_BIN 未安装该运行时）。\n",
              script, interp);
      exit(127);
    }
  }

  int extra = (arg ? 1 : 0);
  int argc = 0;
  while (argv[argc]) argc++;
  char **next = calloc((size_t)argc + extra + 2, sizeof(char *));
  if (!next) {
    perror("calloc");
    exit(126);
  }
  int out = 0;
  next[out++] = mapped;
  if (arg) next[out++] = arg;
  next[out++] = (char *)script;
  for (int i = 1; i < argc; i++) next[out++] = argv[i];
  next[out] = NULL;
  (void)argv0_override;
  trace("shebang %s -> %s", script, mapped);
  execve(mapped, next, environ);
  fprintf(stderr, "nibi-run: 执行 %s 失败：%s\n", mapped, strerror(errno));
  exit(126);
}

static void run_elf(const char *path, char *const argv[]) {
  char *real = real_or_null(path);
  if (!real) {
    fprintf(stderr, "nibi-run: 无法解析 %s：%s\n", path, strerror(errno));
    exit(126);
  }
  char self[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", self, sizeof(self) - 1);
  if (n > 0) {
    self[n] = '\0';
    if (strcmp(real, self) == 0) {
      fprintf(stderr,
              "nibi-run: 拒绝递归执行自身（%s）。这是运行时配置错误，请检查 git-core 的链接与脚本类型。\n",
              real);
      exit(126);
    }
  }
  const char *native = native_dir();
  if (!under_dir(real, native) && !under_dir(real, "/system/")) {
    die_app_data_elf(real);
  }
  trace("elf %s", real, NULL);
  execve(real, argv, environ);
  fprintf(stderr, "nibi-run: 执行 %s 失败：%s\n", real, strerror(errno));
  exit(126);
}

static void run_python_module(const char *module, char *const argv[], int start) {
  const char *bin = bin_dir();
  if (!bin || !*bin) {
    fprintf(stderr, "nibi-run: $NIBI_BIN 未设置，无法启动 python。\n");
    exit(127);
  }
  char *python = join2(bin, "python3");
  if (!python || !executable(python)) {
    fprintf(stderr, "nibi-run: 找不到 %s；Python 运行时未安装。\n", python ? python : "$NIBI_BIN/python3");
    exit(127);
  }
  int argc = start;
  while (argv[argc]) argc++;
  char **next = calloc((size_t)(argc - start) + 4, sizeof(char *));
  if (!next) {
    perror("calloc");
    exit(126);
  }
  int out = 0;
  next[out++] = python;
  next[out++] = "-m";
  next[out++] = (char *)module;
  for (int i = start; i < argc; i++) next[out++] = argv[i];
  next[out] = NULL;
  execve(python, next, environ);
  fprintf(stderr, "nibi-run: 执行 %s -m %s 失败：%s\n", python, module, strerror(errno));
  exit(126);
}

int main(int argc, char **argv) {
  if (argc < 1) return 127;

  const char *self = strrchr(argv[0], '/');
  self = self ? self + 1 : argv[0];
  int direct = strcmp(self, "nibi-run") == 0 || strcmp(self, "libnibi_run.so") == 0;
  int start = 1;
  const char *cmd = NULL;

  if (!direct) {
    /* Invoked through a $NIBI_BIN symlink: argv[0] is the command name. */
    cmd = self;
    start = 1;
  } else if (argc >= 2) {
    cmd = argv[start];
    start++;
  }

  if (!cmd) {
    fprintf(stderr,
            "用法: nibi-run <命令|脚本> [参数...]\n"
            "  $NIBI_BIN 里的命令可直接运行；脚本按 shebang 交给 bash/node/python。\n");
    return 2;
  }

  if (!direct) {
    char *shim = search_bin_shim(argv[0], cmd);
    if (shim) run_script(shim, argv + start - 1, cmd);
    free(shim);
  }

  const char *rt = getenv("NIBI_RUNTIME_DIR");
  if (rt && *rt) {
    if (strcmp(cmd, "npm") == 0 || strcmp(cmd, "npx") == 0) {
      const char *wrapper = strcmp(cmd, "npm") == 0 ? "npm/nibi-npm.js" : "npm/nibi-npx.js";
      const char *cli = strcmp(cmd, "npm") == 0 ? "npm/bin/npm-cli.js" : "npm/bin/npx-cli.js";
      char *script = join2(rt, wrapper);
      if (!script || !file_exists(script)) {
        free(script);
        script = join2(rt, cli);
      }
      if (script && file_exists(script)) {
        run_script(script, argv + start - 1, cmd);
      }
      free(script);
    } else if (strcmp(cmd, "pip") == 0 || strcmp(cmd, "pip3") == 0) {
      run_python_module("pip", argv, start);
    }
  }

  char *path = NULL;
  if (strchr(cmd, '/')) {
    path = strdup(cmd);
  } else {
    /* 顺序很重要：git 会把 exec-path 前置进 PATH，而 git-core 里的
     * git-<script> 是指向本程序的 dispatcher；先查 $NIBI_BIN 与 git-scripts，
     * 再查 PATH（search_path 也会跳过自身）。 */
    path = search_bin(cmd);
    if (!path) path = search_git_scripts(cmd);
    if (!path) path = search_packages(cmd);
    if (!path) path = search_path(cmd);
  }
  if (!path || !file_exists(path)) {
    fprintf(stderr,
            "nibi-run: 找不到命令 `%s`（查找范围：$NIBI_BIN、git-scripts、$NIBI_PACKAGES、PATH）。\n",
            cmd);
    return 127;
  }
  trace("cmd %s -> %s", cmd, path);

  struct stat st;
  if (stat(path, &st) != 0) {
    fprintf(stderr, "nibi-run: 无法读取 %s：%s\n", path, strerror(errno));
    return 126;
  }
  if (!S_ISREG(st.st_mode)) {
    fprintf(stderr, "nibi-run: %s 不是普通文件。\n", path);
    return 126;
  }

  /* Keep argv[0] as the user-visible name when possible. */
  if (start > 1) {
    argv[start - 1] = (char *)cmd;
  }

  if (is_elf(path)) {
    run_elf(path, argv + start - 1);
  }
  run_script(path, argv + start - 1, cmd);
  return 126;
}
