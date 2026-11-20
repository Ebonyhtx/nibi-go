// 动效契约的工具层：把 theme.motion 里的贝塞尔控制点转成 RN core Animated 的 Easing。
// Reanimated 侧用它自带的 Easing.bezier(...theme.motion.easing.standard)——同一组控制点。
import { Easing } from "react-native";

import { motion } from "../theme";

/** standard：默认的入场/数值过渡曲线（cubic-bezier(.22,1,.36,1)）。 */
export const easingStandard = Easing.bezier(...motion.easing.standard);

/** enter：sheet/大件入场（快起缓停，动程大时用）。 */
export const easingEnter = Easing.bezier(...motion.easing.enter);

/** exit：退场（加速离开，不拖泥带水）。 */
export const easingExit = Easing.bezier(...motion.easing.exit);
