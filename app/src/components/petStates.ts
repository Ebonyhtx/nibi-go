// App 事件 → 桌宠状态映射（素材语义与场景见 nibi-pixel-pet 仓 README）。
// PetView 只认 PetStateId；业务侧用这张表接线，不要散落字符串。
import type { PetStateId } from "./PetView";

export const PET_STATE = {
  /** 会话开着、AGENT 空闲（呼吸 + 绿植） */
  idle: "idle",
  /** 工具执行 / 流式输出中（敲代码） */
  working: "working",
  /** 长推理段（思考云） */
  thinking: "thinking",
  /** 回合完成 / 任务完成通知（对勾 + 彩纸） */
  done: "done",
  /** 审批卡待操作——「…」气泡 + 台钟，对应审批验收 D 组 */
  waiting: "waiting",
  /** 工具失败 / 连接错误（红 ! 气泡） */
  error: "error",
  /** 文件交付（抱纸箱） */
  carrying: "carrying",
  /** 页面切换 / 深链启动 / 重连——短时态，无进场过渡 */
  flying: "flying",
  /** 无连接 / 内核挂起 / 后台（闭眼 + 月亮 + Zzz） */
  sleeping: "sleeping",
} as const satisfies Record<string, PetStateId>;
