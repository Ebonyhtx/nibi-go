package expo.modules.nibiphone.a11y

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenMaskTest {
  @Test
  fun masksValidResidentId() {
    val masked = ScreenMask.mask("身份证号 11010519491231002X")
    assertEquals("身份证号 «身份证 ****002X»", masked)
  }

  @Test
  fun keepsInvalidResidentId() {
    val text = "身份证号 110105194912310021"
    assertEquals(text, ScreenMask.mask(text))
  }

  @Test
  fun masksValidCardNumber() {
    assertEquals("«银行卡 ****1111»", ScreenMask.mask("4111111111111111"))
  }

  @Test
  fun masksGroupedCardNumber() {
    assertEquals("«银行卡 ****7894»", ScreenMask.mask("6222 0212 3456 7894"))
  }

  @Test
  fun masksFifteenDigitCardNumber() {
    assertEquals("«银行卡 ****1116»", ScreenMask.mask("411111111111116"))
  }

  @Test
  fun masksNineteenDigitCardNumber() {
    assertEquals("«银行卡 ****0128»", ScreenMask.mask("6222 0212 3456 7890 128"))
  }

  @Test
  fun keepsInvalidLuhnNumber() {
    val text = "卡号 4111111111111112"
    assertEquals(text, ScreenMask.mask(text))
  }

  @Test
  fun keepsOrderAndTrackingNumbers() {
    for (prefix in listOf("订单", "单号", "物流", "快递", "编号", "流水", "交易号", "条码", "序列号")) {
      val text = "$prefix 4111111111111111"
      assertEquals(text, ScreenMask.mask(text))
    }
  }

  @Test
  fun masksCardNotPrecededByOrderContext() {
    val text = "订单号 4111111111111111，卡号 4111111111111111"
    val masked = ScreenMask.mask(text)
    assertTrue(masked.startsWith("订单号 4111111111111111"))
    assertTrue(masked.endsWith("«银行卡 ****1111»"))
  }

  @Test
  fun doesNotRemaskReplacementDigits() {
    val masked = ScreenMask.mask("11010519491231002X 4111111111111111")
    assertEquals("«身份证 ****002X» «银行卡 ****1111»", masked)
  }

  @Test
  fun keepsOrdinaryText() {
    val text = "余额 12.30 元，验证码 123456"
    assertEquals(text, ScreenMask.mask(text))
  }

  @Test
  fun luhnCheckMatchesKnownNumbers() {
    // 通过公开的工具方法间接验证：合法卡被替换，非法卡保持原样。
    assertTrue(ScreenMask.mask("4111111111111111").contains("银行卡"))
    assertFalse(ScreenMask.mask("4111111111111112").contains("银行卡"))
  }
}