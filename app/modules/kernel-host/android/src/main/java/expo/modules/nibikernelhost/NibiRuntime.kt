package expo.modules.nibikernelhost

import android.content.Context
import android.system.Os
import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.util.zip.ZipInputStream

/**
 * D25 Phase 2：把随包的三件套（bash/busybox/git）安装到 filesDir/runtime。
 *
 * jniLibs 里只能放扁平的 `lib*.so`，用户可见名字（bash/git/grep/pre-commit…）全部是
 * filesDir 里的 symlink，指向 nativeLibraryDir；Android 16 允许执行 symlink 的目标。
 * 资源（git 脚本/templates、BASH_ENV、applet 名单）在 assets/nibi-runtime.zip。
 *
 * 任何一步失败都只降级到 /system/bin/sh，不阻塞内核启动；错误写日志并在返回值里说明。
 */
internal object NibiRuntime {
  private const val TAG = "NibiRuntime"
  private const val ASSET_ZIP = "nibi-runtime.zip"
  private const val ASSET_MANIFEST = "nibi-runtime.json"
  private const val LANGS_ZIP = "nibi-langs.zip"
  private const val LANGS_MANIFEST = "nibi-langs.json"
  private const val STAMP = "stamp.txt"
  private const val LANGS_STAMP = "langs.txt"
  private const val GITCONFIG_MARKER = "# managed by NIBI-GO runtime installer"

  data class Installed(
    val ready: Boolean,
    val shell: String,
    val version: String?,
    val error: String?,
    val langsVersion: String? = null,
  )

  fun install(context: Context): Installed {
    val root = File(context.filesDir, "runtime")
    return try {
      val manifestText = readAsset(context, ASSET_MANIFEST)
        ?: return fallback(context, "缺少 assets/$ASSET_MANIFEST（先跑 scripts/android-runtime/build.mjs）")
      val manifest = JSONObject(manifestText)
      val version = manifest.optString("version", "")
      if (version.isBlank() || !version.startsWith("runtime-1:")) {
        return fallback(context, "nibi-runtime.json 版本字段无效")
      }

      val stamp = File(root, STAMP)
      val upToDate = stamp.isFile && stamp.readText().trim() == version
      if (!upToDate) {
        Log.i(TAG, "安装运行时 $version")
        root.deleteRecursively()
        root.mkdirs()
        extractZip(context, root)
        stamp.writeText(version)
      }

      createSymlinks(context, root, manifest)
      writeManagedGitConfig(root)
      val langsVersion = try {
        installLanguages(context, root)
      } catch (t: Throwable) {
        Log.w(TAG, "语言运行时安装失败；shell/git 继续可用", t)
        null
      }

      val bash = File(root, "bin/bash")
      if (!bash.isFile || !bash.canExecute()) {
        return fallback(context, "$bash 不可执行")
      }
      Installed(true, bash.absolutePath, version, null, langsVersion)
    } catch (t: Throwable) {
      Log.w(TAG, "运行时安装失败，回退 /system/bin/sh", t)
      fallback(context, t.message ?: t.javaClass.simpleName)
    }
  }

  /** 与 NibiKernelHostModule/KernelService 共用的一口径环境变量。 */
  fun applyEnvironment(context: Context, installed: Installed) {
    val root = File(context.filesDir, "runtime")
    val bin = File(root, "bin")
    val nativeDir = context.applicationInfo.nativeLibraryDir
    setEnv("NIBI_BIN", bin.absolutePath)
    setEnv("NIBI_RUNTIME_DIR", root.absolutePath)
    setEnv("NIBI_NATIVE_LIB_DIR", nativeDir)
    setEnv("NIBI_PACKAGES", File(context.filesDir, "packages").absolutePath)
    setEnv("SHELL", installed.shell)
    setEnv("NIBI_SHELL", installed.shell)
    setEnv("PATH", "${bin.absolutePath}:/system/bin:/system/xbin")
    if (!installed.ready) return

    val etc = File(root, "etc")
    val gitCore = File(root, "git-core")
    val templates = File(root, "share/git-core/templates")
    val hooks = File(root, "hooks")
    val terminfo = File(root, "terminfo")
    setEnv("BASH_ENV", File(etc, "bash_env.sh").absolutePath)
    setEnv("ENV", File(etc, "bash_env.sh").absolutePath)
    setEnv("GIT_EXEC_PATH", gitCore.absolutePath)
    setEnv("GIT_TEMPLATE_DIR", templates.absolutePath)
    setEnv("GIT_CONFIG_NOSYSTEM", "1")
    val managedConfig = File(etc, "gitconfig")
    if (managedConfig.isFile) {
      // 受管全局配置：默认身份（Android app uid 没有 passwd 条目）+ include 用户 ~/.gitconfig
      // + hooksPath。仓库级 core.hooksPath（husky 等）仍然优先。
      setEnv("GIT_CONFIG_GLOBAL", managedConfig.absolutePath)
    }
    setEnv("NIBI_GIT_HOOKS", hooks.absolutePath)
    val caBundle = File(etc, "cacert.pem")
    if (caBundle.isFile) {
      // OpenSSL 3.5 在 Android 上不认 /system/etc/security/cacerts 的 hash-dir 命名，
      // 用随包 Mozilla 根（固定、跨设备一致）；企业 CA 可覆盖 GIT_SSL_CAINFO。
      setEnv("GIT_SSL_CAINFO", caBundle.absolutePath)
      setEnv("CURL_CA_BUNDLE", caBundle.absolutePath)
      setEnv("SSL_CERT_FILE", caBundle.absolutePath)
    }
    setEnv("SSL_CERT_DIR", "/system/etc/security/cacerts")
    if (installed.langsVersion != null) {
      // Node/Python 自建运行时：libpython 与 node 依赖 nativeLibraryDir，
      // 而 execve 不会自动搜该目录，只能靠 LD_LIBRARY_PATH（目录里都是本 App 的库）。
      val previous = System.getenv("LD_LIBRARY_PATH")
      setEnv(
        "LD_LIBRARY_PATH",
        if (previous.isNullOrBlank()) nativeDir else "$nativeDir:$previous",
      )
      val pythonHome = File(root, "python")
      if (pythonHome.isDirectory) setEnv("PYTHONHOME", pythonHome.absolutePath)
      setEnv("PYTHONUSERBASE", File(context.filesDir, "packages/pip").absolutePath)
      setEnv("PIP_DISABLE_PIP_VERSION_CHECK", "1")
      if (caBundle.isFile) setEnv("PIP_CERT", caBundle.absolutePath)
      setEnv("NPM_CONFIG_PREFIX", File(context.filesDir, "packages/npm").absolutePath)
      setEnv("NPM_CONFIG_CACHE", File(context.filesDir, "cache/npm").absolutePath)
      setEnv("NODE_PATH", File(context.filesDir, "packages/npm/node_modules").absolutePath)
      val npmCli = File(root, "npm/bin/npm-cli.js")
      if (npmCli.isFile) setEnv("NIBI_NODE_CLI", npmCli.absolutePath)
      val npxCli = File(root, "npm/bin/npx-cli.js")
      if (npxCli.isFile) setEnv("NIBI_NPX_CLI", npxCli.absolutePath)
      Log.i(TAG, "语言运行时就绪：${installed.langsVersion}")
    }
    if (terminfo.isDirectory) {
      setEnv("TERMINFO", terminfo.absolutePath)
    }
    Log.i(TAG, "运行时就绪：shell=${installed.shell} version=${installed.version}")
  }

  fun logFailure(installed: Installed) {
    if (!installed.ready) {
      Log.w(TAG, "使用 /system/bin/sh 回退（${installed.error}）")
    }
  }

  private fun fallback(context: Context, reason: String): Installed {
    Log.w(TAG, "运行时不可用：$reason")
    return Installed(false, "/system/bin/sh", null, reason)
  }

  private fun readAsset(context: Context, name: String): String? =
    try {
      context.assets.open(name).bufferedReader().use { it.readText() }
    } catch (_: Throwable) {
      null
    }

  private fun extractZip(context: Context, root: File) {
    unzipAsset(context, ASSET_ZIP, root)
    val manifest = File(root, "etc/bash_env.sh")
    if (!manifest.isFile) {
      throw IllegalStateException("assets/$ASSET_ZIP 缺少 etc/bash_env.sh")
    }
  }

  private fun unzipAsset(context: Context, asset: String, root: File) {
    ZipInputStream(BufferedInputStream(context.assets.open(asset))).use { zip ->
      while (true) {
        val entry = zip.nextEntry ?: break
        val name = entry.name
        if (name.startsWith("/") || name.split('/').contains("..")) {
          throw IllegalStateException("assets/$asset 含非法路径：$name")
        }
        val target = File(root, name)
        if (entry.isDirectory) {
          target.mkdirs()
        } else {
          target.parentFile?.mkdirs()
          FileOutputStream(target).use { out -> zip.copyTo(out) }
        }
        zip.closeEntry()
      }
    }
  }

  /**
   * Node/Python 是可选的第二层运行时（自建，非 Termux）。缺失或损坏时只记日志，
   * 不影响 bash/git；`nibi-langs.json` 由 scripts/android-runtimes 生成。
   */
  private fun installLanguages(context: Context, root: File): String? {
    val manifestText = readAsset(context, LANGS_MANIFEST) ?: return null
    val manifest = JSONObject(manifestText)
    val version = manifest.optString("version", "")
    if (!version.startsWith("langs-1:")) {
      Log.w(TAG, "nibi-langs.json 版本字段无效")
      return null
    }
    val stamp = File(root, LANGS_STAMP)
    if (!(stamp.isFile && stamp.readText().trim() == version)) {
      Log.i(TAG, "安装语言运行时 $version")
      File(root, "python").deleteRecursively()
      File(root, "npm").deleteRecursively()
      unzipAsset(context, LANGS_ZIP, root)
      stamp.writeText(version)
    }
    // CPython 的 getpath 按可执行文件位置推导 prefix：bin/python3 是指向
    // nativeLibraryDir/libpython_bin.so 的 symlink，而 stdlib 在 runtime/python/lib。
    // 给 runtime/lib 建一座指向 python/lib 的桥后，`python3 -I`（忽略 PYTHONHOME）
    // 和 venv 的 `_call_new_python`（会清掉 PYTHONHOME）都能自己找到 stdlib。
    linkDirectory(File(root, "lib"), File(root, "python/lib"))
    val nativeDir = context.applicationInfo.nativeLibraryDir
    val bin = File(root, "bin").apply { mkdirs() }
    val binMap = manifest.optJSONObject("bin")
    if (binMap != null) {
      for (name in binMap.keys()) {
        link(File(bin, name), File(nativeDir, binMap.getString(name)))
      }
    }
    val shims = manifest.optJSONArray("shims")
    if (shims != null) {
      val runner = File(bin, "nibi-run")
      for (i in 0 until shims.length()) {
        val name = shims.optString(i)
        if (name.isNotBlank()) link(File(bin, name), runner)
      }
    }
    return version
  }

  private fun createSymlinks(context: Context, root: File, manifest: JSONObject) {
    val nativeDir = context.applicationInfo.nativeLibraryDir
    val bin = File(root, "bin").apply { mkdirs() }
    val gitCore = File(root, "git-core").apply { mkdirs() }
    val hooks = File(root, "hooks").apply { mkdirs() }

    val binMap = manifest.getJSONObject("bin")
    for (name in binMap.keys()) {
      link(File(bin, name), File(nativeDir, binMap.getString(name)))
    }
    val applets = manifest.optJSONArray("applets")
    if (applets != null) {
      for (i in 0 until applets.length()) {
        val name = applets.optString(i)
        if (name.isNotBlank() && name != "busybox") {
          link(File(bin, name), File(nativeDir, "libbusybox.so"))
        }
      }
    }
    val coreMap = manifest.getJSONObject("gitCore")
    for (name in coreMap.keys()) {
      link(File(gitCore, name), File(nativeDir, coreMap.getString(name)))
    }
    // git 的脚本型命令（submodule/filter-branch/...）在 app 数据里不能 exec：
    // exec-path 里放指向 nibi-run 的 symlink，真实脚本在 git-scripts/（nibi-run 负责 source 路径）。
    val scriptList = manifest.optJSONArray("gitScripts")
    if (scriptList != null) {
      for (i in 0 until scriptList.length()) {
        val name = scriptList.optString(i)
        if (name.isNotBlank()) link(File(gitCore, name), File(nativeDir, "libnibi_run.so"))
      }
    }
    val hookList = manifest.optJSONArray("hooks")
    if (hookList != null) {
      for (i in 0 until hookList.length()) {
        val name = hookList.optString(i)
        if (name.isNotBlank()) link(File(hooks, name), File(nativeDir, "libnibi_hook.so"))
      }
    }
  }

  /**
   * 目录级 symlink（目前只有 runtime/lib → python/lib）。目标不存在时跳过；
   * 目标是真实目录（未来打包形态变化）时不覆盖，避免误删。
   */
  private fun linkDirectory(link: File, target: File) {
    if (!target.isDirectory) return
    try {
      if (Files.isSymbolicLink(link.toPath())) {
        val current = try {
          Os.readlink(link.absolutePath)
        } catch (_: Throwable) {
          null
        }
        if (current == target.absolutePath) return
        link.delete()
      } else if (link.exists()) {
        Log.w(TAG, "runtime/lib 已是真实目录，跳过 symlink：${link.absolutePath}")
        return
      }
      link.parentFile?.mkdirs()
      Os.symlink(target.absolutePath, link.absolutePath)
    } catch (t: Throwable) {
      Log.w(TAG, "创建目录 symlink 失败：${link.absolutePath} -> ${target.absolutePath}", t)
    }
  }

  private fun link(link: File, target: File) {
    if (!target.isFile) {
      Log.w(TAG, "跳过缺失的目标：${target.absolutePath}")
      return
    }
    try {
      if (Files.isSymbolicLink(link.toPath())) {
        val current = try {
          Os.readlink(link.absolutePath)
        } catch (_: Throwable) {
          null
        }
        if (current == target.absolutePath) return
        link.delete()
      } else if (link.exists()) {
        link.delete()
      }
      link.parentFile?.mkdirs()
      Os.symlink(target.absolutePath, link.absolutePath)
    } catch (t: Throwable) {
      Log.w(TAG, "创建 symlink 失败：${link.absolutePath} -> ${target.absolutePath}", t)
    }
  }

  /**
   * 受管全局 git 配置写在 runtime/etc/gitconfig，通过 GIT_CONFIG_GLOBAL 生效，
   * 不碰用户的 ~/.gitconfig。默认身份是 Android 必需的（app uid 没有 passwd 条目，
   * git 无法自动推导）；用户 ~/.gitconfig 在 include 之后，可覆盖 name/email。
   */
  private fun writeManagedGitConfig(root: File) {
    val config = File(root, "etc/gitconfig")
    config.parentFile?.mkdirs()
    val hooks = File(root, "hooks").absolutePath
    config.writeText(
      buildString {
        appendLine(GITCONFIG_MARKER)
        appendLine("# git 的 hook 统一经过 nibi-hook；仓库自己的 .git/hooks 仍由 dispatcher 执行。")
        appendLine("[user]")
        appendLine("\tname = NIBI-GO")
        appendLine("\temail = nibi-go@localhost")
        appendLine("[include]")
        appendLine("\tpath = ~/.gitconfig")
        appendLine("[core]")
        appendLine("\thooksPath = $hooks")
      },
    )
  }

  private fun setEnv(name: String, value: String) {
    try {
      Os.setenv(name, value, true)
    } catch (t: Throwable) {
      Log.w(TAG, "设置 $name 失败", t)
    }
  }
}
