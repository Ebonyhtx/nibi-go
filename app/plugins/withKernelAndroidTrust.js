// Expo config plugin：T8 S2 的 Android 平台信任库（rustls-platform-verifier）。
//
// 背景：`app/modules/kernel-host` 依赖 `org.rustls:rustls-platform-verifier:0.2.0`
// （crate README 指定的 GitHub Maven 仓库）。该 AAR 自带 networkSecurityConfig
// （base 禁明文 + HTTP CRL 白名单），会覆盖 debug manifest 的 usesCleartextTraffic，
// 导致 dev-client 连不上 Metro（http://<host>:8081）。
//
// CNG 纪律：`app/android/` 由 prebuild 生成，不手改。本插件在每次 prebuild 时注入：
//   1. android/build.gradle 的 allprojects.repositories 增加 rustls 的 Maven 仓库；
//   2. android/app/proguard-rules.pro 保留 JVM 组件（JNI 反射调用，R8 看不到引用）；
//   3. debug 变体覆盖 networkSecurityConfig（允许 Metro 明文 + 信任用户 CA）；
//   4. 写入 debug 的 res/xml/network_security_config.xml。
//
// 版本一致性：模块 build.gradle 固定的 AAR 版本必须与 kernel/Cargo.lock 的
// rustls-platform-verifier-android 一致；`scripts/android-kernel/build.mjs` 会核对。
const fs = require("fs");
const path = require("path");
const { withProjectBuildGradle, withDangerousMod } = require("expo/config-plugins");

const REPO_MARKER = "NIBI_RUSTLS_VERIFIER_REPO";
const PROGUARD_MARKER = "org.rustls.platformverifier";
const REPO_URL =
  "https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/";

const DEBUG_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <!-- T8 S2：kernel-host 依赖的 rustls-platform-verifier AAR 会挂一份 base 禁明文的
         networkSecurityConfig；这里在 debug 变体覆盖它，否则 dev-client 连不上 Metro。 -->
    <application
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config"
        tools:targetApi="28"
        tools:ignore="GoogleAppIndexingWarning"
        tools:replace="android:usesCleartextTraffic,android:networkSecurityConfig" />
</manifest>
`;

const DEBUG_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!-- 调试专用（T8 S2）：允许 Metro 的明文 HTTP，并信任用户安装的 CA（调试代理/抓包）。
     发布变体保留 rustls-platform-verifier AAR 自带的配置（系统根 + CRL 明文例外）。 -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withRustlsRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(REPO_MARKER)) return cfg;
    const anchor = "maven { url 'https://www.jitpack.io' }";
    if (!gradle.includes(anchor)) {
      throw new Error(`withKernelAndroidTrust：android/build.gradle 里找不到 ${anchor}（模板结构变化？）`);
    }
    gradle = gradle.replace(
      anchor,
      `${anchor}\n    // ${REPO_MARKER}：T8 S2 的 rustls-platform-verifier JVM 组件（版本与 Cargo.lock 核对）。\n    maven { url "${REPO_URL}" }`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
}

function withDebugNetworkConfig(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const debugDir = path.join(androidRoot, "app", "src", "debug");
      const manifestPath = path.join(debugDir, "AndroidManifest.xml");
      const resXmlDir = path.join(debugDir, "res", "xml");
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(resXmlDir, "network_security_config.xml"),
        DEBUG_NETWORK_SECURITY_CONFIG,
      );

      // 没生成过（或模板变了）就写完整文件；否则只在现有 application 元素上补两个属性，
      // 保留模板可能加的其他内容。
      let manifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : null;
      if (!manifest || !manifest.includes("<application")) {
        fs.writeFileSync(manifestPath, DEBUG_MANIFEST);
        return cfg;
      }
      if (!manifest.includes('android:networkSecurityConfig="@xml/network_security_config"')) {
        manifest = manifest.replace(
          /<application\b([^>]*?)\/?>/s,
          (tag) =>
            tag
              .replace(
                /<application\b/,
                '<application\n        android:networkSecurityConfig="@xml/network_security_config"',
              )
              .replace(
                /tools:replace="([^"]*)"/,
                'tools:replace="$1,android:networkSecurityConfig"',
              ),
        );
        fs.writeFileSync(manifestPath, manifest);
      }

      const proguardPath = path.join(androidRoot, "app", "proguard-rules.pro");
      if (fs.existsSync(proguardPath)) {
        const rules = fs.readFileSync(proguardPath, "utf8");
        if (!rules.includes(PROGUARD_MARKER)) {
          fs.appendFileSync(
            proguardPath,
            `\n# T8 S2：rustls-platform-verifier 的 JVM 组件由 JNI 反射调用，R8 看不到引用。\n-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }\n`,
          );
        }
      }
      return cfg;
    },
  ]);
}

module.exports = function withKernelAndroidTrust(config) {
  return withDebugNetworkConfig(withRustlsRepo(config));
};
