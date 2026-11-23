package expo.modules.nibiphone.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import expo.modules.nibiphone.R

/**
 * App 在前台时的 NIBI 提示音。
 *
 * 三声归位（与桌面客户端 D21 同一套自研音效，Apache-2.0）：
 * - complete：任务完成的短促鸟鸣；
 * - approval：等待审批/提问的双音风铃；
 * - error：回合失败的轻羽落。
 *
 * 资源放在本模块 `res/raw`，同一份文件也被 expo-notifications 的 Android
 * 渠道声音引用（后台/锁屏由系统按渠道播放）。前台不走系统通知，因此这里用
 * MediaPlayer 直接播；音量跟随系统「通知」流，静音/勿扰模式下不响。
 */
object NotificationSound {
  private val lock = Any()
  private var current: MediaPlayer? = null

  fun play(context: Context, kind: String): Boolean {
    val resId = when (kind) {
      "approval" -> R.raw.nibi_task_approval
      "error" -> R.raw.nibi_task_error
      else -> R.raw.nibi_task_complete
    }
    synchronized(lock) {
      releaseLocked()
      val player = createPlayer(context, resId)
      if (player == null) {
        android.util.Log.w("NibiSound", "player unavailable kind=$kind")
        return false
      }
      player.setOnCompletionListener { done ->
        synchronized(lock) {
          if (current === done) current = null
        }
        runCatching { done.release() }
      }
      player.setOnErrorListener { failed, _, _ ->
        synchronized(lock) {
          if (current === failed) current = null
        }
        runCatching { failed.release() }
        true
      }
      current = player
      val started = try {
        player.start()
        true
      } catch (_: Throwable) {
        releaseLocked()
        false
      }
      // 真机排障用：settings 试听与回合完成提示都走这里，logcat 可按 NibiSound 过滤。
      android.util.Log.i("NibiSound", "play kind=$kind started=$started")
      return started
    }
  }

  private fun createPlayer(context: Context, resId: Int): MediaPlayer? {
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    // 优先走未压缩的 raw fd：能先设置通知流属性再 prepare。APK 里的 mp3 通常
    // 不会被 aapt 压缩，因此 fd 路径在正式包里一直可用。
    val afd = try {
      context.resources.openRawResourceFd(resId)
    } catch (_: Throwable) {
      null
    }
    if (afd != null) {
      val player = MediaPlayer()
      try {
        player.setAudioAttributes(attributes)
        player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        player.prepare()
        return player
      } catch (_: Throwable) {
        runCatching { player.release() }
      } finally {
        runCatching { afd.close() }
      }
    }
    // 兜底：资源被压缩时 create() 仍能播（走默认媒体流）。
    return try {
      MediaPlayer.create(context.applicationContext, resId)
    } catch (_: Throwable) {
      null
    }
  }

  private fun releaseLocked() {
    runCatching { current?.release() }
    current = null
  }
}
