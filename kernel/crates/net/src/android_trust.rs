//! Android 上的平台信任锚状态（NIBI-GO Phase C · 票据 T8）。
//!
//! 桌面与 CLI 直接用系统信任库。Android 进程内 cdylib 没有 JVM / Context 时，
//! `rustls-platform-verifier` 的 Android 后端无法读取系统信任库，reqwest 会把整条 egress
//! 构造当作失败（NIBI-GO 真机实测：`rustls-platform-verifier could not load extra certs`），
//! app-server 随之退出。
//!
//! 两层兜底（T8 S1/S2）：
//! - **S2**：宿主在 `nibi_app_server_start` 之前调用 `nibi_app_server_attach_android`，
//!   把 JNIEnv 与 `android.content.Context` 交进来；这里调用
//!   `rustls_platform_verifier::android::init_with_env` 并置位，之后平台校验器可用。
//! - **S1**：没交（旧宿主 / attach 失败 / 非 JNI 运行）时，Android 只用内置的 Mozilla
//!   根证书（`Anchors::Merge` 的附加锚部分仍照常生效）：公开 HTTPS 正常，用户安装的 CA /
//!   企业代理证书暂不生效。构造不会因此失败。

#[cfg(target_os = "android")]
use std::ffi::c_void;
#[cfg(target_os = "android")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "android")]
static PLATFORM_TRUST: AtomicBool = AtomicBool::new(false);

/// 宿主交接过 JVM / Context 之后置位。
#[cfg(target_os = "android")]
fn mark_platform_trust_ready() {
    PLATFORM_TRUST.store(true, Ordering::Release);
}

/// 是否可以使用平台根证书。
#[cfg(target_os = "android")]
pub(crate) fn platform_trust_available() -> bool {
    PLATFORM_TRUST.load(Ordering::Acquire)
}

/// 非 Android 平台始终走平台校验器（与改动前逐字一致）。
#[cfg(not(target_os = "android"))]
pub(crate) fn platform_trust_available() -> bool {
    true
}

/// 把宿主的 JVM 与 Android `Context` 交给内核（T8 S2）。
///
/// `raw_env` 是 `JNIEnv*`，`raw_context` 是 `android.content.Context` 的 `jobject`
/// （局部或全局引用均可；rustls-platform-verifier 会自己建 global ref）。两个指针只需在
/// 本函数调用期间有效，宿主可以在返回后立刻释放局部引用。
///
/// 成功返回 `Ok(())` 并置位平台信任；失败返回可读原因，调用方应继续走内置根兜底
/// （egress 仍能构造，只是用户安装的 CA 不生效）。重复调用是幂等的。
#[cfg(target_os = "android")]
#[allow(unsafe_code)] // JNI 原始指针只在 FFI 边界解引用；桌面目标不编译本函数。
pub fn attach_android_jvm(raw_env: *mut c_void, raw_context: *mut c_void) -> Result<(), String> {
    if raw_env.is_null() {
        return Err("JNIEnv 为空".to_owned());
    }
    if raw_context.is_null() {
        return Err("Android Context 为空".to_owned());
    }

    // SAFETY: 指针来自宿主的 JNI 调用；调用方保证二者在本函数返回前有效（见函数文档）。
    let mut env = unsafe { jni::EnvUnowned::from_raw(raw_env.cast::<jni::sys::JNIEnv>()) };
    let outcome = env.with_env(|env| {
        // SAFETY: 同一保证；JObject 只借用 local ref，不延长生命周期。
        let context = unsafe {
            jni::objects::JObject::from_raw(env, raw_context.cast::<jni::sys::_jobject>())
        };
        rustls_platform_verifier::android::init_with_env(env, context)
    });

    match outcome.into_outcome() {
        jni::Outcome::Ok(()) => {
            mark_platform_trust_ready();
            Ok(())
        }
        jni::Outcome::Err(error) => Err(format!("rustls-platform-verifier 初始化失败：{error}")),
        jni::Outcome::Panic(_) => {
            Err("rustls-platform-verifier 初始化 panic（已捕获，回退内置根）".to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn host_platforms_keep_using_the_platform_verifier() {
        #[cfg(not(target_os = "android"))]
        assert!(super::platform_trust_available());
    }
}
