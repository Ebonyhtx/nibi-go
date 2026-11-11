// Expo config plugin：固定 Android 原生构建的 CMake 版本 + 构建目录。
// 背景：Windows 上 RN codegen 的 autolinked_build 路径（.cxx/.../CMakeFiles/<target>.dir/
// D_/NIBI-GO/node_modules/react-native-gesture-handler/...）约 280 字符，超过 ninja 的
// MAX_PATH 处理上限（实测：SDK 默认 cmake 3.22.1 与 3.31.4 的 ninja 均失败；
// LongPathsEnabled=1 无效）。修复 = 把 .cxx 构建目录迁到短路径（buildStagingDirectory），
// 路径降到 ~240 字符后构建成功（2026-11-11 实测 BUILD SUCCESSFUL）。
// 2026-11-11 二次修正：release 变体（RelWithDebInfo 比 Debug 长 9 字符、arm64-v8a 比
// x86_64 长 3 字符）又压线失败（ninja: mkdir ... No such file or directory）。
// 实测旧 debug 构建：最长目录 254 字符、最长文件 297 字符——文件能走长路径，**目录创建**
// 才是 260 上限的瓶颈。故把 staging 根目录缩到 C:/nb（前缀 38），release 最深目录约 256。
// 注：AGP 9 已移除 CMake 的 `arguments` DSL（只剩 path/buildStagingDirectory），
// 无法注入 -DCMAKE_OBJECT_PATH_MAX，只能靠缩短路径。
// 本插件让 prebuild 每次生成 android/ 时自动注入（CNG 纪律：不手改生成目录）。
const { withAppBuildGradle } = require("expo/config-plugins");

const CMAKE_VERSION = process.env.NIBIGO_CMAKE_VERSION || "3.31.4";
// 短路径构建目录（可用 NIBIGO_CXX_STAGING 覆盖）；必须尽量短——每一层目录都算进 MAX_PATH
const CXX_STAGING_DIR = process.env.NIBIGO_CXX_STAGING || "C:/nb";

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
