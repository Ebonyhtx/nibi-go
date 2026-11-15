// Expo config plugin：把 jniLibs 里的可执行文件按 legacy packaging 解压安装。
//
// D25 Phase 2 的 bash/busybox/git/nibi-run 都在 jniLibs（只能叫 lib*.so），
// 运行时通过 filesDir/runtime/bin 的 symlink 指向 nativeLibraryDir 执行。
// targetSdk 36 的 App 数据 noexec 限制只放过 nativeLibraryDir，所以 APK 必须
// 把这些库解压出来（extractNativeLibs=true），而不是留在 APK 里按页对齐映射。
//
// CNG 纪律：app/android 由 prebuild 生成；这里改 gradle.properties，不手改生成物。
const { withGradleProperties } = require("expo/config-plugins");

const KEY = "expo.useLegacyPackaging";

module.exports = function withAndroidLegacyPackaging(config) {
  return withGradleProperties(config, (cfg) => {
    const list = cfg.modResults;
    const existing = list.find((item) => item.type === "property" && item.key === KEY);
    if (existing) {
      existing.value = "true";
    } else {
      list.push({ type: "property", key: KEY, value: "true" });
    }
    return cfg;
  });
};
