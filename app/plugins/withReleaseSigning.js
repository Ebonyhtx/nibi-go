// Expo config plugin：release 签名配置（CNG 纪律：android/ 由 prebuild 生成，不手改）。
//
// 为什么需要：RN 模板的 release buildType 默认复用 debug.keystore（公开私钥，密码是
// "android"）。用它发布 = 任何人可签同签名包覆盖安装，且首个公开版一旦用 debug 签名，
// 后续所有用户都被钉死在该证书上（Android 升级强制同签名）。
//
// 本插件让 prebuild 每次生成 android/ 时自动注入：
//   - signingConfigs.release：密钥库路径来自 NIBI_KEYSTORE_FILE（默认 ~/.nibi/keystore/
//     nibi-go-release.p12），口令只从环境变量读，绝不落盘；
//   - buildTypes.release 改用该配置；
//   - release 构建缺密钥库/口令时**直接失败**，不静默回落到 debug。
//
// 生成/备份/恢复密钥库：node scripts/keystore.mjs（见 docs/checklists/发布检查单.md）。
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "NIBI_SIGNING_CONFIG";

const RELEASE_SIGNING_CONFIG = `
        // ${MARKER}：release 签名从环境变量读取；缺密钥库/口令时失败，不回落 debug。
        release {
            def nibiKeystorePath = System.getenv("NIBI_KEYSTORE_FILE") ?: new File(System.getProperty("user.home"), ".nibi/keystore/nibi-go-release.p12").absolutePath
            def nibiKeystoreFile = file(nibiKeystorePath)
            def nibiReleaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains("release") }
            if (nibiReleaseRequested) {
                if (!nibiKeystoreFile.exists()) {
                    throw new GradleException("release 构建缺少签名密钥库：" + nibiKeystoreFile + "（先运行 node scripts/keystore.mjs restore）")
                }
                if (!System.getenv("NIBI_KEYSTORE_PASS")) {
                    throw new GradleException("release 构建缺少环境变量 NIBI_KEYSTORE_PASS（口令不落盘）")
                }
            }
            storeFile nibiKeystoreFile
            storeType "pkcs12"
            storePassword System.getenv("NIBI_KEYSTORE_PASS")
            keyAlias System.getenv("NIBI_KEY_ALIAS") ?: "nibi-go"
            keyPassword System.getenv("NIBI_KEY_PASS") ?: System.getenv("NIBI_KEYSTORE_PASS")
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    // 1) 在 signingConfigs 块开头注入 release 配置
    const signingConfigsAt = gradle.indexOf("signingConfigs {");
    if (signingConfigsAt === -1) {
      throw new Error("withReleaseSigning：未找到 signingConfigs 块（RN 模板结构变化？）");
    }
    const insertAt = signingConfigsAt + "signingConfigs {".length;
    gradle = gradle.slice(0, insertAt) + RELEASE_SIGNING_CONFIG + gradle.slice(insertAt);

    // 2) 把 buildTypes.release 的 signingConfig 从 debug 换成 release
    const buildTypesAt = gradle.indexOf("buildTypes {");
    if (buildTypesAt === -1) {
      throw new Error("withReleaseSigning：未找到 buildTypes 块（RN 模板结构变化？）");
    }
    const releaseAt = gradle.indexOf("release {", buildTypesAt);
    if (releaseAt === -1) {
      throw new Error("withReleaseSigning：未找到 release buildType（RN 模板结构变化？）");
    }
    const before = gradle.slice(0, releaseAt);
    const after = gradle.slice(releaseAt);
    if (!after.includes("signingConfig signingConfigs.debug")) {
      throw new Error("withReleaseSigning：release buildType 未找到 signingConfig signingConfigs.debug");
    }
    cfg.modResults.contents =
      before + after.replace("signingConfig signingConfigs.debug", "signingConfig signingConfigs.release");
    return cfg;
  });
};
