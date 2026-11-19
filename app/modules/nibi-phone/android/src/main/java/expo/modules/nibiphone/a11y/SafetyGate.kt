package expo.modules.nibiphone.a11y

enum class PhoneAction { TAP, TYPE, SCROLL, KEY, SCREENSHOT, OPEN }

/**
 * 审批之外的第二层硬拒绝：本应用、支付/银行、系统页面、密码/验证码字段与安全页面。
 * 返回 null 表示放行，否则返回给模型的可操作错误文本。
 *
 * 包名判断只看当前前台应用（快照的 packageName），不依赖模型参数，提示词无法绕过。
 */
object SafetyGate {
  /**
   * 支付/银行/券商的固定包名清单（只读：拒绝 TAP/TYPE/SCROLL，保留 KEY 作为退路）。
   * 新增应用时加在这里；包名来自 Android 应用清单，大小写敏感。
   */
  private val PAYMENT_OR_BANK_PACKAGES: Set<String> = setOf(
    // 支付/钱包
    "com.eg.android.AlipayGphone",
    "com.unionpay",
    "com.chinatelecom.bestpayclient",
    "com.jd.jrapp",
    "cn.gov.pbc.dcep",
    "com.paypal.android.p2pmobile",
    "com.mybank.android.phone",
    "com.webank.wemoney",
    // 银行
    "com.icbc",
    "com.chinamworld.main",
    "com.android.bankabc",
    "com.chinamworld.bocmbci",
    "com.bankcomm.Bankcomm",
    "cmb.pb",
    "com.cmbchina.ccd.pluto.cmbActivity",
    "com.yitong.mbank.psbc",
    "cn.com.spdb.mobilebank.per",
    "cn.com.cmbc.newmbank",
    "com.ecitic.bank.mobile",
    "com.cebbank.mobile.cemb",
    "com.pingan.paces.ccms",
    "com.cgbchina.xpt",
    "com.bankofbeijing.mobilebanking",
    // 券商/股票交易
    "com.hexin.plat.android",
    "com.eastmoney.android.berlin",
    "com.lphtsccft",
    "com.xueqiu.android",
    "cn.futu.trader",
    "com.tigerbrokers.stock",
  )

  /**
   * 系统页面：android 框架、设置、SystemUI、权限控制器、安装器、应用商店。
   * 只读（拒绝 TAP/TYPE/SCROLL），back/home 仍可用。
   */
  private val SYSTEM_PACKAGES: Set<String> = setOf(
    "android",
    "com.android.settings",
    "com.android.settings.intelligence",
    "com.android.systemui",
    "com.android.permissioncontroller",
    "com.google.android.permissioncontroller",
    "com.android.packageinstaller",
    "com.google.android.packageinstaller",
    "com.android.vending",
  )

  private val WRITE_ACTIONS = setOf(PhoneAction.TAP, PhoneAction.TYPE, PhoneAction.SCROLL)

  fun denyAction(
    ownPackage: String,
    snapshot: ScreenSnapshot,
    node: ScreenNode?,
    action: PhoneAction,
  ): String? {
    val packageName = snapshot.packageName
    // 节点可能来自另一个窗口（状态栏、权限弹窗）：按节点自己的包名判，不能只看快照包名。
    val targetPackage = node?.packageName?.takeIf { it.isNotBlank() } ?: packageName
    val app = when {
      targetPackage == packageName ->
        snapshot.appLabel.takeIf { it.isNotBlank() } ?: packageName.ifBlank { "当前应用" }
      else -> targetPackage
    }

    // KEY 是退路：安全页/支付页也允许 back/home 离开，只有本应用自己不允许（防自我循环）。
    if (action == PhoneAction.KEY) {
      return if (ownPackage.isNotBlank() && targetPackage == ownPackage) {
        "这是 NIBI-GO 自己的界面，不执行按键（防止自我循环）。请让用户手动操作。"
      } else {
        null
      }
    }

    // 截屏交给系统判定：FLAG_SECURE 会由 takeScreenshot 返回明确错误；
    // 这里不因“节点为空”误伤图片/自绘页面。其余动作在安全页一律拒绝。
    if (snapshot.secure && action != PhoneAction.SCREENSHOT && action != PhoneAction.OPEN) {
      return "安全页面不可操作：系统没有提供可读内容或禁止读取。请让用户自己完成。"
    }

    // 本应用：点按/输入/滚动都可能造成自我循环，全部拒绝。
    if (ownPackage.isNotBlank() && targetPackage == ownPackage) {
      if (action == PhoneAction.TAP || action == PhoneAction.TYPE ||
        action == PhoneAction.SCROLL
      ) {
        return "这是 NIBI-GO 自己的界面，不执行点按/输入/滚动（防止自我循环）。请让用户手动操作，或切换到其他应用。"
      }
    }

    if (targetPackage in PAYMENT_OR_BANK_PACKAGES && action in WRITE_ACTIONS) {
      return "「$app」属于支付/银行类应用，只读：不能点按、输入或滚动。请让用户自己操作。"
    }

    if (targetPackage in SYSTEM_PACKAGES && action in WRITE_ACTIONS) {
      return "「$app」是系统设置/权限/安装页面，只读：不能点按、输入或滚动；可以用 key back/home 返回，或让用户自己完成。"
    }

    if (action == PhoneAction.TYPE && node != null) {
      val secret = node.password || node.sensitive || SensitiveWords.isSecretField(node.label, node.password)
      if (secret) {
        return "这是密码/验证码/支付类字段，不能代填。请让用户自己输入。"
      }
    }

    return null
  }
}