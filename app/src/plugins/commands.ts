// 插件 `command` 效果的宿主命令白名单。
//
// 插件只能在下面这张表里点名：表外的命令（包括 permission/mode 这类设置项）一律拒绝。
// 命令不接受路径或参数——v1 的 `args` 只为契约形状保留，插件无法借它影响导航目标。

/** 宿主命令上下文：导航与提示必填，会话动作由具体页面按能力提供。 */
export interface HostCommandContext {
  /** 应用内导航（调用方的 router.push）。 */
  navigate: (path: string) => void;
  /** 用户可见的轻提示；失败/不可用都要如实说出来。 */
  toast: (text: string) => void;
  /** 新建会话；只有首页提供。 */
  newSession?: () => void | Promise<void>;
  /** 压缩上下文；只有首页提供，返回错误文案（成功为 null）。 */
  compact?: () => Promise<string | null>;
}

/** v1 允许的宿主命令。新增命令必须同时补上下面的执行分支。 */
export const HOST_COMMANDS = [
  "newSession",
  "openPlugins",
  "openProvider",
  "openComposerSettings",
  "openConversationSettings",
  "openSessions",
  "compact",
] as const;

type HostCommandName = (typeof HOST_COMMANDS)[number];

function isHostCommand(name: string): name is HostCommandName {
  return (HOST_COMMANDS as readonly string[]).includes(name);
}

/** 执行一个宿主命令；未知或当前页面不支持时用 toast 如实反馈。 */
export function runHostCommand(
  name: string,
  args: unknown,
  context: HostCommandContext,
): void {
  // v1 不接受插件参数：保留形参只为契约兼容。
  void args;
  if (!isHostCommand(name)) {
    context.toast(`插件命令不可用：${name}`);
    return;
  }
  switch (name) {
    case "newSession": {
      const newSession = context.newSession;
      if (!newSession) {
        context.toast(`这个位置不支持该命令：${name}`);
        return;
      }
      try {
        void Promise.resolve(newSession()).catch((error: unknown) => {
          context.toast(
            `新建会话失败：${error instanceof Error ? error.message : String(error)}`,
          );
        });
      } catch (error) {
        context.toast(
          `新建会话失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      context.navigate("/");
      return;
    }
    case "openPlugins":
      context.navigate("/plugins");
      return;
    case "openProvider":
      context.navigate("/settings/provider");
      return;
    case "openComposerSettings":
      context.navigate("/settings/composer");
      return;
    case "openConversationSettings":
      context.navigate("/settings/conversation");
      return;
    case "openSessions":
      context.navigate("/sessions");
      return;
    case "compact": {
      const compact = context.compact;
      if (!compact) {
        context.toast(`这个位置不支持该命令：${name}`);
        return;
      }
      void (async () => {
        try {
          const error = await compact();
          if (error) context.toast(error);
        } catch (error) {
          context.toast(
            `压缩失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
      return;
    }
    default: {
      // 白名单与分支必须同步：漏实现时在编译期报错，而不是运行时静默。
      const unreachable: never = name;
      context.toast(`插件命令不可用：${String(unreachable)}`);
    }
  }
}