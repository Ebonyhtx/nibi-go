// Release 构建的 R8 规则回归。
//
// 复发点（2026-11-20 真机 release 复验抓到）：libnibi_kernel_jni.so 用 GetMethodID
// 按名字找 Sink.onLine/onError；R8 改名后内核线程抛 NoSuchMethodError 并 abort，
// debug 构建完全看不出来。规则必须放在被跟踪的模块 consumer rules 里——`app/android`
// 是 prebuild 生成目录（.gitignore），写在那里会在下次 prebuild 时丢掉。
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("release JNI keep 规则", () => {
  it("kernel-host 模块把 JNI 回调面 keep 住并声明为 consumer rules", () => {
    const rules = source("modules/kernel-host/android/consumer-rules.pro");
    expect(rules).toContain("-keep class expo.modules.nibikernelhost.** { *; }");
    const gradle = source("modules/kernel-host/android/build.gradle");
    expect(gradle).toContain('consumerProguardFiles "consumer-rules.pro"');
  });

  it("不把规则写进 prebuild 生成的 app/android 目录", () => {
    // 该目录被 app/.gitignore 忽略，写在那里不会进仓库、下次 prebuild 还会丢。
    const ignore = source(".gitignore");
    expect(ignore).toMatch(/^\/android$/mu);
  });
});