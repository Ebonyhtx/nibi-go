package expo.modules.nibiphone.a11y

/**
 * 出国前的文本打码：只处理校验通过的身份证号与银行卡号，其他字符原样保留。
 *
 * - 18 位身份证：必须通过 GB 11643（ISO 7064 MOD 11-2）校验，保留末 4 位；
 * - 15–19 位银行卡：必须通过 Luhn 校验，且前 8 个字符内没有订单/物流类语境；
 * - 一次扫描同时处理两类号码，替换结果不会被再次扫描（避免把打码后的数字再打码）。
 *
 * 纯 Kotlin，可在 JVM 单测。
 */
object ScreenMask {
  /** 这些词后面紧跟的数字更可能是订单号/流水号，不能当银行卡。 */
  private val ORDER_CONTEXT: List<String> = listOf(
    "订单", "单号", "物流", "快递", "编号", "流水", "交易号", "条码", "序列号",
  )

  private const val ID_BODY =
    "[1-9][0-9]{5}(?:19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]"
  private const val CARD_BODY = "[0-9](?:[ -]?[0-9]){14,18}"

  /** 身份证分支在前：同一串数字先按身份证校验，失败再按银行卡尝试。 */
  private val NUMBER: Regex = Regex(
    "(?<![0-9A-Za-z])($ID_BODY)(?![0-9A-Za-z])" +
      "|" +
      "(?<![0-9A-Za-z])($CARD_BODY)(?![0-9A-Za-z])",
  )

  private val ID_WEIGHTS = intArrayOf(7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
  private const val ID_CHECK = "10X98765432"

  fun mask(text: String): String {
    // 两类号码都至少 15 个数字，先用廉价条件跳过绝大多数文本。
    if (text.length < 15 || text.count { it.isDigit() } < 15) return text
    return NUMBER.replace(text) { match ->
      val id = match.groups[1]?.value
      if (id != null) {
        if (idChecksumOk(id)) {
          "«身份证 ****${id.takeLast(4).uppercase()}»"
        } else {
          cardMask(id, match.range.first, text) ?: match.value
        }
      } else {
        cardMask(match.groups[2]!!.value, match.range.first, text) ?: match.value
      }
    }
  }

  /** 通过 Luhn 且不在订单语境里时返回打码文本；否则返回 null（保留原文）。 */
  private fun cardMask(candidate: String, start: Int, source: String): String? {
    // 银行卡只能是数字与分隔符；身份证校验失败但末位是 X 的串不按银行卡处理。
    if (candidate.any { !it.isDigit() && it != ' ' && it != '-' }) return null
    val digits = candidate.filter { it.isDigit() }
    if (digits.length !in 15..19 || !luhnOk(digits)) return null
    val before = source.substring(maxOf(0, start - 8), start)
    if (ORDER_CONTEXT.any { before.contains(it) }) return null
    return "«银行卡 ****${digits.takeLast(4)}»"
  }

  private fun luhnOk(digits: String): Boolean {
    var sum = 0
    var doubled = false
    for (index in digits.indices.reversed()) {
      var value = digits[index] - '0'
      if (doubled) {
        value *= 2
        if (value > 9) value -= 9
      }
      sum += value
      doubled = !doubled
    }
    return sum % 10 == 0
  }

  /** GB 11643 的 MOD 11-2 校验位。 */
  private fun idChecksumOk(id: String): Boolean {
    if (id.length != 18) return false
    var sum = 0
    for (index in 0 until 17) {
      val digit = id[index] - '0'
      if (digit !in 0..9) return false
      sum += digit * ID_WEIGHTS[index]
    }
    return id[17].uppercaseChar() == ID_CHECK[sum % 11]
  }
}