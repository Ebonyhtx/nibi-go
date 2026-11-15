/*
 * nibi-hook — git hook dispatcher for Android.
 *
 * jniLibs cannot contain files named `pre-commit`, and app-data files cannot be
 * execve()'d. So core.hooksPath points at filesDir/runtime/hooks, where every
 * hook name is a symlink to libnibi_hook.so; git runs this dispatcher, which
 * finds the repository's real .git/hooks/<name> and hands it to nibi-run.
 *
 * The real hook stays in the repository (never copied into the blame path), so
 * `git commit` in a checked-out project keeps working with its own hooks.
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

static const char *base_name(const char *path) {
  const char *slash = strrchr(path, '/');
  return slash ? slash + 1 : path;
}

static int is_dir(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISDIR(st.st_mode);
}

static int is_file(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISREG(st.st_mode);
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

static char *dir_name(const char *path) {
  char *copy = strdup(path);
  if (!copy) return NULL;
  char *slash = strrchr(copy, '/');
  if (!slash) {
    strcpy(copy, ".");
  } else if (slash == copy) {
    slash[1] = '\0';
  } else {
    *slash = '\0';
  }
  return copy;
}

/* Resolve the repository git dir, including worktrees (.git is a file). */
static char *find_git_dir(void) {
  const char *env = getenv("GIT_DIR");
  if (env && *env) return strdup(env);

  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof(cwd))) return NULL;
  char *dir = strdup(cwd);
  if (!dir) return NULL;

  for (;;) {
    char *dot = join2(dir, ".git");
    if (dot && is_dir(dot)) {
      free(dir);
      return dot;
    }
    if (dot && is_file(dot)) {
      FILE *f = fopen(dot, "r");
      if (f) {
        char line[PATH_MAX];
        if (fgets(line, sizeof(line), f)) {
          fclose(f);
          char *p = line;
          if (strncmp(p, "gitdir:", 7) == 0) p += 7;
          while (*p == ' ' || *p == '\t') p++;
          char *nl = strchr(p, '\n');
          if (nl) *nl = '\0';
          char *nl2 = strchr(p, '\r');
          if (nl2) *nl2 = '\0';
          if (*p) {
            char *out;
            if (p[0] == '/') {
              out = strdup(p);
            } else {
              char *parent = dir_name(dot);
              out = join2(parent, p);
              free(parent);
            }
            free(dot);
            free(dir);
            return out;
          }
        } else {
          fclose(f);
        }
      }
    }
    free(dot);

    char *parent = dir_name(dir);
    if (!parent || strcmp(parent, dir) == 0) {
      free(parent);
      free(dir);
      return NULL;
    }
    free(dir);
    dir = parent;
  }
}

int main(int argc, char **argv) {
  if (argc < 1) return 0;
  const char *name = base_name(argv[0]);
  int arg_start = 1;

  /* Also allow `nibi-hook <name> [args...]`. */
  if (strcmp(name, "nibi-hook") == 0 || strcmp(name, "libnibi_hook.so") == 0) {
    if (argc < 2) {
      fprintf(stderr, "用法: nibi-hook <pre-commit|commit-msg|...> [参数...]\n");
      return 2;
    }
    name = argv[1];
    arg_start = 2;
  }

  char *git_dir = find_git_dir();
  if (!git_dir) {
    /* Not inside a repository: behave like git (a hook outside a repo is a no-op). */
    return 0;
  }

  char *hooks = join2(git_dir, "hooks");
  char *hook = hooks ? join2(hooks, name) : NULL;
  free(hooks);
  free(git_dir);

  if (!hook || !is_file(hook)) {
    free(hook);
    return 0;
  }
  if (access(hook, X_OK) != 0) {
    /* Git itself skips non-executable hooks; do the same. */
    free(hook);
    return 0;
  }

  const char *bin = getenv("NIBI_BIN");
  char *runner = NULL;
  if (bin && *bin) runner = join2(bin, "nibi-run");
  if (!runner || access(runner, X_OK) != 0) {
    free(runner);
    runner = NULL;
    if (bin && *bin) {
      runner = join2(bin, "bash");
      if (runner && access(runner, X_OK) != 0) {
        free(runner);
        runner = NULL;
      }
    }
  }
  if (!runner) {
    fprintf(stderr,
            "nibi-hook: 找不到 nibi-run/bash（$NIBI_BIN=%s）。\n"
            "请通过 NIBI-GO 的 shell 运行 git，或设置 NIBI_BIN。\n",
            bin ? bin : "(未设置)");
    free(hook);
    return 1;
  }

  int argc2 = 0;
  char **next = calloc((size_t)(argc - arg_start) + 3, sizeof(char *));
  if (!next) {
    perror("calloc");
    free(hook);
    free(runner);
    return 1;
  }
  next[argc2++] = runner;
  next[argc2++] = hook;
  for (int i = arg_start; i < argc; i++) next[argc2++] = argv[i];
  next[argc2] = NULL;

  char *env_name = malloc(strlen(name) + 16);
  if (env_name) {
    sprintf(env_name, "NIBI_GIT_HOOK=%s", name);
    putenv(env_name); /* leaked on purpose: exec follows immediately */
  }

  execve(runner, next, environ);
  fprintf(stderr, "nibi-hook: 执行 %s 失败：%s\n", runner, strerror(errno));
  free(hook);
  free(runner);
  return 1;
}
