package expo.modules.nibikeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * KeepAlive 前台服务（A4）。
 *
 * 设计依据（Spike 2 实测）：Android 切后台 ~1s 内 WebSocket 被 abort、JS 定时器暂停——
 * 没有前台服务时远程连接无法在后台存活。本服务以 dataSync 类型常驻，START_STICKY 自恢复。
 * 通知为 IMPORTANCE_LOW（不打扰），文案由 JS 侧传入。
 */
class KeepAliveService : Service() {
  companion object {
    const val CHANNEL_ID = "nibi_keepalive"
    const val NOTIFICATION_ID = 41001
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running: Boolean = false
      private set
  }

  override fun onCreate() {
    super.onCreate()
    running = true
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "NIBI-GO 已连接"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "保持与桌面的远程连接"
    val notification: Notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // 被系统回收后重建（不重投递 Intent）
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(CHANNEL_ID, "远程连接", NotificationManager.IMPORTANCE_LOW)
    channel.description = "保持与桌面的远程连接"
    manager.createNotificationChannel(channel)
  }
}
