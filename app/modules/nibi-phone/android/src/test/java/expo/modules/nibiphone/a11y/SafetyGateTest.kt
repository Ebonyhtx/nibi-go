package expo.modules.nibiphone.a11y

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SafetyGateTest {
  private val own = "com.example.nibigo"

  @Test
  fun refusesOwnAppWrites() {
    val snapshot = snapshot(packageName = own)
    for (action in listOf(PhoneAction.TAP, PhoneAction.TYPE, PhoneAction.SCROLL, PhoneAction.KEY)) {
      val error = SafetyGate.denyAction(own, snapshot, node(), action)
      assertNotNull("本应用应拒绝 $action", error)
      assertTrue(error!!.isNotBlank())
    }
  }

  @Test
  fun allowsOwnAppScreenshotAndOpen() {
    val snapshot = snapshot(packageName = own)
    assertNull(SafetyGate.denyAction(own, snapshot, null, PhoneAction.SCREENSHOT))
    assertNull(SafetyGate.denyAction(own, snapshot, null, PhoneAction.OPEN))
  }

  @Test
  fun refusesPaymentWritesButAllowsKey() {
    val snapshot = snapshot(packageName = "com.eg.android.AlipayGphone", appLabel = "支付宝")
    for (action in listOf(PhoneAction.TAP, PhoneAction.TYPE, PhoneAction.SCROLL)) {
      val error = SafetyGate.denyAction(own, snapshot, node(), action)
      assertNotNull("支付类应用应拒绝 $action", error)
      assertTrue(error!!.contains("只读"))
    }
    assertNull(SafetyGate.denyAction(own, snapshot, null, PhoneAction.KEY))
  }

  @Test
  fun refusesSystemPackageWritesButAllowsKey() {
    val snapshot = snapshot(packageName = "com.android.settings", appLabel = "设置")
    for (action in listOf(PhoneAction.TAP, PhoneAction.TYPE, PhoneAction.SCROLL)) {
      assertNotNull(
        "系统页面应拒绝 $action",
        SafetyGate.denyAction(own, snapshot, node(), action),
      )
    }
    assertNull(SafetyGate.denyAction(own, snapshot, null, PhoneAction.KEY))
  }

  @Test
  fun refusesTypeOnPasswordField() {
    val snapshot = snapshot(packageName = "com.example.app")
    val secret = node(label = "登录密码", password = true, sensitive = true)
    assertNotNull(SafetyGate.denyAction(own, snapshot, secret, PhoneAction.TYPE))
  }

  @Test
  fun allowsTapOnSecretField() {
    val snapshot = snapshot(packageName = "com.example.app")
    val secret = node(label = "登录密码", password = true, sensitive = true)
    // 密码字段只拒绝代填；点按仍由审批链处理。
    assertNull(SafetyGate.denyAction(own, snapshot, secret, PhoneAction.TAP))
  }

  @Test
  fun refusesTypeOnSensitiveField() {
    val snapshot = snapshot(packageName = "com.example.app")
    val secret = node(label = "验证码", sensitive = true)
    assertNotNull(SafetyGate.denyAction(own, snapshot, secret, PhoneAction.TYPE))
  }

  @Test
  fun allowsTypeOnOrdinaryField() {
    val snapshot = snapshot(packageName = "com.example.app")
    val ordinary = node(label = "搜索")
    assertNull(SafetyGate.denyAction(own, snapshot, ordinary, PhoneAction.TYPE))
  }

  @Test
  fun refusesWritesOnSecureSnapshotButLeavesKeyAndScreenshot() {
    val snapshot = snapshot(packageName = "com.example.app", secure = true)
    val denied = setOf(PhoneAction.TAP, PhoneAction.TYPE, PhoneAction.SCROLL)
    for (action in PhoneAction.values()) {
      if (action in denied) {
        assertNotNull("安全页面应拒绝 $action", SafetyGate.denyAction(own, snapshot, node(), action))
      } else {
        // KEY 是退路；SCREENSHOT 交给系统判定（FLAG_SECURE 会返回错误）。
        assertNull("安全页面不应在本地拒绝 $action", SafetyGate.denyAction(own, snapshot, node(), action))
      }
    }
  }

  @Test
  fun refusesKeyOnlyInOwnApp() {
    val ownSnapshot = snapshot(packageName = own)
    assertNotNull(SafetyGate.denyAction(own, ownSnapshot, null, PhoneAction.KEY))
    val other = snapshot(packageName = "com.example.app")
    assertNull(SafetyGate.denyAction(own, other, null, PhoneAction.KEY))
  }

  @Test
  fun allowsOrdinaryApp() {
    val snapshot = snapshot(packageName = "com.example.app")
    for (action in PhoneAction.values()) {
      assertNull("普通应用应放行 $action", SafetyGate.denyAction(own, snapshot, node(), action))
    }
  }

  @Test
  fun refusesActionsOnNodesFromAnotherPackage() {
    val snapshot = snapshot(packageName = "com.example.app")
    val systemNode = node(label = "通知", packageName = "com.android.systemui")
    assertNotNull(SafetyGate.denyAction(own, snapshot, systemNode, PhoneAction.TAP))
  }

  private fun node(
    label: String = "确定",
    password: Boolean = false,
    sensitive: Boolean = false,
    packageName: String = "",
  ): ScreenNode = ScreenNode(
    index = 1,
    packageName = packageName,
    role = "输入框",
    label = label,
    value = null,
    clickable = true,
    longClickable = false,
    scrollable = false,
    editable = true,
    checkable = false,
    checked = false,
    enabled = true,
    focused = false,
    password = password,
    sensitive = sensitive,
    bounds = ScreenBounds(0, 0, 100, 50),
  )

  private fun snapshot(
    packageName: String,
    appLabel: String = "示例应用",
    secure: Boolean = false,
  ): ScreenSnapshot = ScreenSnapshot(
    id = 1,
    packageName = packageName,
    appLabel = appLabel,
    orientation = "竖屏",
    keyboardOpen = false,
    nodes = emptyList(),
    capturedAt = 1_760_000_000_000L,
    truncated = false,
    secure = secure,
  )
}