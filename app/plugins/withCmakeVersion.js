// Expo config plugin：固定 Android 原生构建的 CMake 版本 + 构建目录。
// 背景：Windows 上 RN codegen 的 autolinked_build 路径（.cxx/.../CMakeFiles/<target>.dir/
// D_/NIBI-GO/node_modules/react-native-gesture-handler/...）约 280 字符，超过 ninja 的
// MAX_PATH 处理上限（实测：SDK 默认 cmake 3.22.1 与 3.31.4 的 ninja 均失败；
// LongPathsEnabled=1 无效）。修复 = 把 .cxx 构建目录迁到短路径（buildStagingDirectory），
// 路径降到 ~240 字符后构建成功（2026-11-11 实测 BUILD SUCCESSFUL）。
// 本插件让 prebuild 每次生成 android/ 时自动注入（CNG 纪律：不手改生成目录）。
const { withAppBuildGradle } = require("expo/config-plugins");

const CMAKE_VERSION = process.env.NIBIGO_CMAKE_VERSION || "3.31.4";
// 短路径构建目录（可用 NIBIGO_CXX_STAGING 覆盖）；建议保持在盘符根下一级
const CXX_STAGING_DIR = process.env.NIBIGO_CXX_STAGING || "C:/nibigo-cxx";

module.exports = function withNativeBuildConfig(config) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes("externalNativeBuild")) return cfg;
    cfg.modResults.contents = gradle.replace(
      /(compileSdk rootProject\.ext\.compileSdkVersion\n)/,
      `$1\n    externalNativeBuild {\n        cmake {\n            version "${CMAKE_VERSION}"\n            buildStagingDirectory = file("${CXX_STAGING_DIR}")\n        }\n    }\n`,
    );
    return cfg;
  });
};
