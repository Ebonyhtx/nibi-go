package expo.modules.nibiphone.a11y

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SensitiveWordsTest {
  @Test
  fun recognizesChineseKeywords() {
    val labels = listOf(
      "密码",
      "支付密码",
      "口令",
      "验证码",
      "支付",
      "付款",
      "金额",
      "余额",
      "银行卡",
      "卡号",
      "身份证",
      "安全码",
      "密码提示",
    )
    for (label in labels) {
      assertTrue("应命中敏感词：$label", SensitiveWords.isSensitive(label))
    }
  }

  @Test
  fun recognizesEnglishKeywords() {
    val labels = listOf(
      "Password",
      "passcode",
      "PWD",
      "OTP",
      "verification code",
      "CVV",
      "security code",
      "Bank Card",
      "card number",
      "ID card",
      "payment",
      "balance",
    )
    for (label in labels) {
      assertTrue("应命中敏感词：$label", SensitiveWords.isSensitive(label))
    }
  }

  @Test
  fun ignoresOrdinaryControls() {
    val labels = listOf("确定", "取消", "搜索", "下一步", "Spinner", "payload", "hotpot")
    for (label in labels) {
      assertFalse("不应命中敏感词：$label", SensitiveWords.isSensitive(label))
    }
  }

  @Test
  fun passwordIsAlwaysSecret() {
    assertTrue(SensitiveWords.isSecretField("任意标签", password = true))
    assertTrue(SensitiveWords.isSecretField("验证码", password = false))
    assertFalse(SensitiveWords.isSecretField("确定", password = false))
  }

  @Test
  fun blankLabelIsNotSensitive() {
    assertFalse(SensitiveWords.isSensitive(""))
    assertFalse(SensitiveWords.isSensitive("   "))
  }

  @Test
  fun longExplanatoryTextIsNotSensitive() {
    assertFalse(
      SensitiveWords.isSensitive(
        "允许 NIBI-GO 读取屏幕文字并模拟点按、输入和返回等操作。密码、验证码、证件与银行卡信息会打码；所有操作仍需在对话里审批。",
      ),
    )
  }
}