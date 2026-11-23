package expo.modules.nibiphone.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

/**
 * 随包内置的 Shizuku 官方安装包：一键离线安装（无需用户自己去 GitHub 找 APK）。
 *
 * 合规口径（AGENTS.md 规则 18）：固定版本 + sha256 + 来源/许可证记录。
 * - 上游：RikkaApps/Shizuku v13.6.0（Apache-2.0）
 * - 资产：shizuku-v13.6.0.r1086.2650830c-release.apk（2571773 字节）
 * - sha256：6e273ab0e991c4e79bc8b1bbb9b9dd739cca1a8712a541a214078886b7b790f
 *
 * 安装走 PackageInstaller 会话（Android 8+），不依赖 FileProvider：
 * 用户需要允许本应用「安装未知应用」；未授权时返回 permission_required，
 * App 直接打开该项系统设置，用户回来后重新点安装。
 */
object ShizukuInstaller {
  const val MANAGER_PACKAGE = "moe.shizuku.privileged.api"
  private const val ASSET_PATH = "shizuku/shizuku-v13.6.0.r1086.2650830c-release.apk"
  private const val EXPECTED_SHA256 =
    "6e273ab0e991c4e79bc8b1bbb9b9dd739ccac1a8712a541a214078886b7b790f"
  private const val SESSION_NAME = "nibi-shizuku"
  /** App 侧据此提示「安装器已打开」；具体结果由系统安装界面反馈。 */
  const val ACTION_INSTALL_RESULT = "expo.modules.nibiphone.SHIZUKU_INSTALL_RESULT"

  data class InstallResult(val status: String, val message: String? = null)

  fun install(context: Context): InstallResult {
    val bytes = try {
      context.assets.open(ASSET_PATH).use { it.readBytes() }
    } catch (_: Throwable) {
      return InstallResult("unavailable", "随包安装包缺失")
    }
    val digest = try {
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { byte ->
        "%02x".format(byte.toInt() and 0xff)
      }
    } catch (_: Throwable) {
      return InstallResult("unavailable", "无法校验安装包")
    }
    if (digest != EXPECTED_SHA256) {
      android.util.Log.w(
        "NibiShizuku",
        "bundled APK digest mismatch: size=${bytes.size} digest=${digest.length}:$digest",
      )
      return InstallResult("corrupt", "安装包校验失败，已拒绝安装")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      !context.packageManager.canRequestPackageInstalls()
    ) {
      return InstallResult("permission_required")
    }
    return try {
      val installer = context.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      val sessionId = installer.createSession(params)
      installer.openSession(sessionId).use { session ->
        session.openWrite(SESSION_NAME, 0, bytes.size.toLong()).use { output ->
          output.write(bytes)
          session.fsync(output)
        }
        // PackageInstaller 会把 EXTRA_STATUS 写回这个 PendingIntent，Android 12+
        // 要求它必须是 mutable（IMMUTABLE 会在 commit 时抛 IllegalArgumentException）。
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
        } else {
          android.app.PendingIntent.FLAG_UPDATE_CURRENT
        }
        val callback = android.app.PendingIntent.getBroadcast(
          context,
          0,
          Intent(context, ShizukuInstallReceiver::class.java).setAction(ACTION_INSTALL_RESULT),
          flags,
        )
        session.commit(callback.intentSender)
      }
      InstallResult("started")
    } catch (error: Throwable) {
      InstallResult("failed", error.javaClass.simpleName)
    }
  }

  /** 引导到「安装未知应用」授权页（Android 8+）。 */
  fun openInstallPermissionSettings(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }
}

/**
 * PackageInstaller 的回调：STATUS_PENDING_USER_ACTION 时必须替系统打开确认界面。
 * 其它状态不在这里弹 UI；App 回到前台会重新读 `installed` 状态。
 */
class ShizukuInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) return
    val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_INTENT)
    }
    if (confirm == null) return
    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(confirm) }
  }
}
