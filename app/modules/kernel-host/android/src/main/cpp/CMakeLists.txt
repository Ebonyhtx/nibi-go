cmake_minimum_required(VERSION 3.22.1)
project(nibikernelhost)

# 预编译内核（由 scripts/android-kernel/fetch.mjs 校验后落盘，不入库）。
set(NIBI_PREBUILT "${CMAKE_CURRENT_SOURCE_DIR}/../../../prebuilt/jniLibs/${ANDROID_ABI}/libnibi.so")

if(NOT EXISTS "${NIBI_PREBUILT}")
  message(FATAL_ERROR
    "缺少 ${NIBI_PREBUILT}。先运行 `node scripts/android-kernel/fetch.mjs`（按 build.json.artifacts 校验 sha256 后落盘）。")
endif()

# 不用 IMPORTED 目标：libnibi.so 没有 SONAME，导入目标会让 DT_NEEDED 记成绝对路径
# （Windows 构建机路径），设备上必然找不到。用 -L + -l 让 DT_NEEDED 只记 "libnibi.so"。
get_filename_component(NIBI_PREBUILT_DIR "${NIBI_PREBUILT}" DIRECTORY)

add_library(nibi_kernel_jni SHARED nibi_kernel_jni.c)
target_link_directories(nibi_kernel_jni PRIVATE "${NIBI_PREBUILT_DIR}")
target_link_libraries(nibi_kernel_jni nibi log)
