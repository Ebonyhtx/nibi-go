package expo.modules.nibiphone.apps

import android.content.Context
import android.content.Intent
import android.net.Uri

data class AppEntry(val label: String, val packageName: String)

/** 应用的枚举、解析与启动；只走桌面启动器与 http/https 链接。 */
object AppCatalog {
  const val MAX_APPS = 100

  /** 桌面可启动应用，按名称排序并去重；query 同时匹配名称与包名。 */
  fun list(context: Context, query: String?): List<AppEntry> {
    val catalog = launcherApps(context)
    val needle = query?.trim()?.takeIf { it.isNotEmpty() }
    val filtered = if (needle == null) {
      catalog
    } else {
      catalog.filter { entry ->
        entry.label.contains(needle, ignoreCase = true) ||
          entry.packageName.contains(needle, ignoreCase = true)
      }
    }
    return filtered
      .sortedWith { left, right ->
        val byLabel = left.label.compareTo(right.label, ignoreCase = true)
        if (byLabel != 0) byLabel else left.packageName.compareTo(right.packageName)
      }
      .take(MAX_APPS)
  }

  /**
   * 包名精确匹配（必须可启动）优先，其次应用名精确匹配，最后名称/包名包含匹配。
   * 找不到时返回 null。
   */
  @Suppress("DEPRECATION")
  fun resolve(context: Context, query: String): String? {
    val needle = query.trim()
    if (needle.isEmpty()) return null
    val manager = context.packageManager
    try {
      if (manager.getLaunchIntentForPackage(needle) != null) return needle
    } catch (_: Throwable) {
      // 包名不存在或系统拒绝查询，继续按名称匹配。
    }
    val catalog = launcherApps(context)
    catalog.firstOrNull { it.label.equals(needle, ignoreCase = true) }?.let {
      return it.packageName
    }
    return catalog.firstOrNull { entry ->
      entry.label.contains(needle, ignoreCase = true) ||
        entry.packageName.contains(needle, ignoreCase = true)
    }?.packageName
  }

  fun launchApp(context: Context, packageName: String): Boolean = try {
    val intent = context.packageManager.getLaunchIntentForPackage(packageName)
      ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    true
  } catch (_: Throwable) {
    false
  }

  /** 只接受 http/https；没有任何应用能处理时返回 false。 */
  @Suppress("DEPRECATION")
  fun launchUrl(context: Context, url: String): Boolean = try {
    val uri = Uri.parse(url.trim())
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
      false
    } else {
      val intent = Intent(Intent.ACTION_VIEW, uri)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (context.packageManager.resolveActivity(intent, 0) == null) {
        false
      } else {
        context.startActivity(intent)
        true
      }
    }
  } catch (_: Throwable) {
    false
  }

  /** 查询桌面入口并按包名去重；读不到时返回空表。 */
  @Suppress("DEPRECATION")
  private fun launcherApps(context: Context): List<AppEntry> {
    val manager = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = try {
      manager.queryIntentActivities(intent, 0) ?: emptyList()
    } catch (_: SecurityException) {
      return emptyList()
    } catch (_: Throwable) {
      return emptyList()
    }
    val entries = LinkedHashMap<String, AppEntry>()
    resolved.forEach { info ->
      val packageName = info.activityInfo?.packageName ?: return@forEach
      if (entries.containsKey(packageName)) return@forEach
      val label = info.loadLabel(manager)?.toString()?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: packageName
      entries[packageName] = AppEntry(label, packageName)
    }
    return entries.values.toList()
  }
}