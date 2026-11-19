package expo.modules.nibiphone.a11y

/**
 * 敏感词单一词表：同一个判断供读屏打码、字段拒绝与 ⚠ 标记使用，避免两处漂移。
 *
 * 中文词按包含匹配；英文词按整词匹配（避免 pay 命中 payload、pin 命中 spinner 之类的误报）。词表同时覆盖：
 * 密码、口令、验证码、支付、付款、金额、余额、银行卡/卡号、身份证、安全码、密码提示。
 */
object SensitiveWords {
  /** 超过这个长度的文本按说明段落处理，不当作字段标签（避免整段隐私说明被标 ⚠）。 */
  private const val MAX_LABEL_CHARS = 40

  /** 唯一的敏感词表；新增词只改这里。 */
  private val KEYWORDS: List<String> = listOf(
    // 中文
    "密码", "口令", "验证码", "支付", "付款", "金额", "余额",
    "银行卡", "卡号", "身份证", "安全码", "密码提示",
    // English
    "password", "passcode", "passwd", "passphrase", "pwd", "otp", "cvv", "cvc", "pin",
    "verification code", "verify code", "sms code", "auth code",
    "security code", "one-time code", "one-time password",
    "bank card", "card number", "id card", "identity card",
    "payment", "pay", "amount", "balance",
  )

  /** 英文词用整词边界，中文词仍走 contains。 */
  private val ASCII_PATTERNS: Map<String, Regex> = KEYWORDS
    .filter { word -> word.all { it.code < 128 } }
    .associateWith { word ->
      val body = word.split(' ').joinToString("\\s+") { Regex.escape(it) }
      Regex("(?<![a-z0-9])$body(?![a-z0-9])")
    }

  fun isSensitive(label: String): Boolean {
    val text = label.trim().lowercase()
    if (text.isEmpty() || text.length > MAX_LABEL_CHARS) return false
    return KEYWORDS.any { word ->
      if (word in ASCII_PATTERNS) {
        ASCII_PATTERNS.getValue(word).containsMatchIn(text)
      } else {
        text.contains(word)
      }
    }
  }

  fun isSecretField(label: String, password: Boolean): Boolean =
    password || isSensitive(label)
}
