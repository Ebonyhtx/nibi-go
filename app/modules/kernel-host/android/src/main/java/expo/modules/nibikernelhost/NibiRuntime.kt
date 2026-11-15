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
  private const val STAMP = "stamp.txt"
  private const val GITCONFIG_MARKER = "# managed by NIBI-GO runtime installer"

  data class Installed(
    val ready: Boolean,
    val shell: String,
    val version: String?,
    val error: String?,
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
      writeGitConfig(context, root)

      val bash = File(root, "bin/bash")
      if (!bash.isFile || !bash.canExecute()) {
        return fallback(context, "$bash 不可执行")
      }
      Installed(true, bash.absolutePath, version, null)
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
    setEnv("NIBI_GIT_HOOKS", hooks.absolutePath)
    setEnv("SSL_CERT_DIR", "/system/etc/security/cacerts")
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
    ZipInputStream(BufferedInputStream(context.assets.open(ASSET_ZIP))).use { zip ->
      while (true) {
        val entry = zip.nextEntry ?: break
        val name = entry.name
        if (name.startsWith("/") || name.split('/').contains("..")) {
          throw IllegalStateException("assets/$ASSET_ZIP 含非法路径：$name")
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
    val manifest = File(root, "etc/bash_env.sh")
    if (!manifest.isFile) {
      throw IllegalStateException("assets/$ASSET_ZIP 缺少 etc/bash_env.sh")
    }
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
   * HOME 是 filesDir；全局 git config 只写一次。仓库级 core.hooksPath（如 husky）优先级更高，
   * 不会被这里覆盖。
   */
  private fun writeGitConfig(context: Context, root: File) {
    val config = File(context.filesDir, ".gitconfig")
    if (config.isFile) {
      val text = config.readText()
      if (!text.startsWith(GITCONFIG_MARKER)) return
    }
    val hooks = File(root, "hooks").absolutePath
    config.writeText(
      buildString {
        appendLine(GITCONFIG_MARKER)
        appendLine("# git 的 hook 统一经过 nibi-hook；仓库自己的 .git/hooks 仍由 dispatcher 执行。")
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
