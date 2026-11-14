// NIBI-GO Phase C：nibi 内核 C ABI 的 JNI 薄层。
//
// 这里只做四件事，不碰内核实现（内核以 npm 平台包的 libnibi.so 消费，D17/D19）：
//   1. 把 Java 的 Sink 对象转成 C 回调（输出/错误）；
//   2. 把内核线程的输出按 LF 切成完整行（JSON 行内不会出现裸 LF）；
//   3. 每一行立刻复制成 byte[]（ABI 约定 data 只在回调内有效）；
//   4. 句柄生命周期加锁，send/stop/destroy 不互相踩。
//
// 协议与语义见 nibi-client `docs/android-cdylib-abi.md`；ABI 版本用
// nibi_app_server_abi_version() 校验，v1 的符号布局与下面的声明一一对应。

#include <android/log.h>
#include <jni.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define LOG_TAG "NibiKernelHost"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// ---- 内核 C ABI（v1） -------------------------------------------------------
typedef void (*nibi_output_cb)(const uint8_t *data, size_t len, void *user_data);
typedef void (*nibi_error_cb)(const char *message, void *user_data);

extern uint32_t nibi_app_server_abi_version(void);
extern void *nibi_app_server_start(nibi_output_cb output, void *output_user_data,
                                   nibi_error_cb error, void *error_user_data);
extern int32_t nibi_app_server_send(void *handle, const uint8_t *data, size_t len);
extern int32_t nibi_app_server_stop(void *handle);
extern void nibi_app_server_destroy(void *handle);

// 行缓冲上限：正常 JSON 行远小于此；超过视为异常并丢弃，避免无限增长。
#define NIBI_MAX_PENDING_LINE (8u * 1024u * 1024u)

static JavaVM *g_vm = NULL;
static jobject g_sink = NULL;       // 全局引用，destroy 时释放
static jmethodID g_on_line = NULL;  // Sink.onLine(byte[])
static jmethodID g_on_error = NULL; // Sink.onError(byte[])
static void *g_kernel = NULL;       // nibi_app_server_start 返回的句柄
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

// 行缓冲只由内核输出线程写（ABI 保证输出回调在同一线程），因此不需要锁。
static uint8_t *g_pending = NULL;
static size_t g_pending_len = 0;
static size_t g_pending_cap = 0;

// 内核线程需要附着到 JVM 才能回调 Java；线程退出时自动 detach。
static pthread_key_t g_env_key;
static pthread_once_t g_env_once = PTHREAD_ONCE_INIT;

static void detach_current_thread(void *unused) {
  (void)unused;
  if (g_vm != NULL) {
    (*g_vm)->DetachCurrentThread(g_vm);
  }
}

static void create_env_key(void) {
  pthread_key_create(&g_env_key, detach_current_thread);
}

static JNIEnv *current_env(void) {
  if (g_vm == NULL) {
    return NULL;
  }
  JNIEnv *env = NULL;
  jint rc = (*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6);
  if (rc == JNI_OK) {
    return env;
  }
  if (rc != JNI_EDETACHED) {
    return NULL;
  }
  if ((*g_vm)->AttachCurrentThreadAsDaemon(g_vm, &env, NULL) != JNI_OK) {
    return NULL;
  }
  pthread_once(&g_env_once, create_env_key);
  pthread_setspecific(g_env_key, (void *)1);
  return env;
}

static void call_sink(JNIEnv *env, jmethodID method, const uint8_t *data, size_t len) {
  if (method == NULL || g_sink == NULL) {
    return;
  }
  jobject sink = g_sink;
  if (sink == NULL) {
    return;
  }
  jbyteArray payload = (*env)->NewByteArray(env, (jsize)len);
  if (payload == NULL) {
    return;
  }
  if (len > 0) {
    (*env)->SetByteArrayRegion(env, payload, 0, (jsize)len, (const jbyte *)data);
  }
  (*env)->CallVoidMethod(env, sink, method, payload);
  if ((*env)->ExceptionCheck(env)) {
    // JS 侧处理器的异常不应回灌内核线程；清掉继续。
    (*env)->ExceptionClear(env);
  }
  (*env)->DeleteLocalRef(env, payload);
}

static void emit_line(const uint8_t *line, size_t len) {
  if (len > 0 && line[len - 1] == '\r') {
    len--;
  }
  JNIEnv *env = current_env();
  if (env == NULL) {
    return;
  }
  call_sink(env, g_on_line, line, len);
}

static void on_kernel_output(const uint8_t *data, size_t len, void *user_data) {
  (void)user_data;
  if (data == NULL || len == 0) {
    return;
  }
  if (g_pending_len + len > g_pending_cap) {
    size_t want = g_pending_len + len;
    size_t cap = g_pending_cap == 0 ? 64 * 1024 : g_pending_cap;
    while (cap < want) {
      cap *= 2;
    }
    uint8_t *grown = (uint8_t *)realloc(g_pending, cap);
    if (grown == NULL) {
      LOGE("line buffer realloc failed (%zu bytes)", cap);
      return;
    }
    g_pending = grown;
    g_pending_cap = cap;
  }
  memcpy(g_pending + g_pending_len, data, len);
  g_pending_len += len;

  size_t start = 0;
  for (size_t i = 0; i < g_pending_len; i++) {
    if (g_pending[i] == '\n') {
      emit_line(g_pending + start, i - start);
      start = i + 1;
    }
  }
  if (start > 0) {
    memmove(g_pending, g_pending + start, g_pending_len - start);
    g_pending_len -= start;
  }
  if (g_pending_len > NIBI_MAX_PENDING_LINE) {
    LOGE("dropping %zu bytes without a newline", g_pending_len);
    g_pending_len = 0;
  }
}

static void on_kernel_error(const char *message, void *user_data) {
  (void)user_data;
  JNIEnv *env = current_env();
  if (env == NULL) {
    return;
  }
  const char *text = message != NULL ? message : "unknown kernel error";
  call_sink(env, g_on_error, (const uint8_t *)text, strlen(text));
}

static void release_sink(JNIEnv *env) {
  if (g_sink != NULL) {
    (*env)->DeleteGlobalRef(env, g_sink);
    g_sink = NULL;
  }
  g_on_line = NULL;
  g_on_error = NULL;
}

JNIEXPORT jint JNICALL
Java_expo_modules_nibikernelhost_NibiKernelHostNative_nativeAbiVersion(JNIEnv *env, jobject thiz) {
  (void)env;
  (void)thiz;
  return (jint)nibi_app_server_abi_version();
}

JNIEXPORT jboolean JNICALL
Java_expo_modules_nibikernelhost_NibiKernelHostNative_nativeStart(JNIEnv *env, jobject thiz,
                                                                 jobject sink) {
  (void)thiz;
  if (sink == NULL) {
    return JNI_FALSE;
  }
  pthread_mutex_lock(&g_lock);
  if (g_kernel != NULL) {
    pthread_mutex_unlock(&g_lock);
    return JNI_FALSE; // 一个进程只允许一个实例
  }
  if ((*env)->GetJavaVM(env, &g_vm) != JNI_OK) {
    pthread_mutex_unlock(&g_lock);
    return JNI_FALSE;
  }
  g_sink = (*env)->NewGlobalRef(env, sink);
  if (g_sink == NULL) {
    pthread_mutex_unlock(&g_lock);
    return JNI_FALSE;
  }
  jclass cls = (*env)->GetObjectClass(env, g_sink);
  g_on_line = (*env)->GetMethodID(env, cls, "onLine", "([B)V");
  g_on_error = (*env)->GetMethodID(env, cls, "onError", "([B)V");
  if (g_on_line == NULL || g_on_error == NULL) {
    if ((*env)->ExceptionCheck(env)) {
      (*env)->ExceptionClear(env);
    }
    release_sink(env);
    pthread_mutex_unlock(&g_lock);
    return JNI_FALSE;
  }
  g_pending_len = 0;
  void *handle = nibi_app_server_start(on_kernel_output, NULL, on_kernel_error, NULL);
  g_kernel = handle;
  if (handle == NULL) {
    // 启动失败不要把 Sink 的全局引用留着，否则下一次 start 会重复 NewGlobalRef。
    release_sink(env);
  }
  pthread_mutex_unlock(&g_lock);
  return handle != NULL ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_expo_modules_nibikernelhost_NibiKernelHostNative_nativeSend(JNIEnv *env, jobject thiz,
                                                                jbyteArray bytes) {
  (void)thiz;
  if (bytes == NULL) {
    return JNI_FALSE;
  }
  jsize len = (*env)->GetArrayLength(env, bytes);
  if (len <= 0) {
    return JNI_FALSE;
  }
  uint8_t *copy = (uint8_t *)malloc((size_t)len);
  if (copy == NULL) {
    return JNI_FALSE;
  }
  (*env)->GetByteArrayRegion(env, bytes, 0, len, (jbyte *)copy);
  pthread_mutex_lock(&g_lock);
  int32_t rc = g_kernel != NULL ? nibi_app_server_send(g_kernel, copy, (size_t)len) : -2;
  pthread_mutex_unlock(&g_lock);
  free(copy);
  return rc == 0 ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_expo_modules_nibikernelhost_NibiKernelHostNative_nativeStop(JNIEnv *env, jobject thiz) {
  (void)env;
  (void)thiz;
  pthread_mutex_lock(&g_lock);
  int32_t rc = g_kernel != NULL ? nibi_app_server_stop(g_kernel) : -2;
  pthread_mutex_unlock(&g_lock);
  return rc == 0 ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_expo_modules_nibikernelhost_NibiKernelHostNative_nativeDestroy(JNIEnv *env, jobject thiz) {
  (void)thiz;
  pthread_mutex_lock(&g_lock);
  if (g_kernel != NULL) {
    nibi_app_server_destroy(g_kernel);
    g_kernel = NULL;
  }
  release_sink(env);
  g_pending_len = 0;
  free(g_pending);
  g_pending = NULL;
  g_pending_cap = 0;
  pthread_mutex_unlock(&g_lock);
}
