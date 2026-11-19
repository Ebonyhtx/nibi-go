# JNI 回调面：libnibi_kernel_jni.so 用 GetMethodID 按名字找 Sink.onLine/onError。
# R8 改名后内核线程会抛 NoSuchMethodError 并 abort（release 构建必现，debug 不受影响）。
# 同时保住 AIDL/Service 与 JNI 的 Kotlin 入口，避免后续再加的反射面被裁剪。
-keep class expo.modules.nibikernelhost.** { *; }
