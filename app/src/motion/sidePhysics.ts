// 左右侧栏共用的物理参数（index / GoDrawer / WorkspacePanel / SideBackdrop 共享同一份节奏）：
// 临界阻尼弹簧（ζ ≈ 0.89），松手保留手指甩动速度，不生硬回弹、也不丢惯性。

/** 侧栏超拉时藏在屏幕边缘外的余量（dp），保证橡皮筋阻尼绝不露白边。 */
export const SIDE_BLEED = 24;

export const SIDE_SPRING_CONFIG = {
  damping: 32,
  stiffness: 320,
  mass: 1,
  overshootClamping: true,
  restDisplacementThreshold: 0.001,
  restSpeedThreshold: 0.001,
} as const;

/** 过界橡皮筋阻尼（worklet）：超拉 `over > 0` 最多再延展约 4.5%（~15dp），手感柔和不撞墙。 */
export function rubberBandProgress(over: number): number {
  "worklet";
  if (over <= 0) return 0;
  // tanh 在 worklet 里用纯指数实现，避免跨引擎兼容性差异。
  const e2 = Math.exp(-6 * over);
  const tanh = (1 - e2) / (1 + e2);
  return 0.045 * tanh;
}
