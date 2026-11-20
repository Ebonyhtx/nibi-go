import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { PillButton } from "../components/ui/PillButton";
import { useSession } from "../relay/useSession";
import { radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

// 扫码屏（D7：QR 只含 sid/mid/name/app_version 路由提示，无秘密）。
// 扫到 → session.startFromQr（解析+落凭据+建连）→ 回 work 屏看连接状态。
// 2.0：只换主题 token 与按钮；相机/扫码回调/取消逻辑不变（此屏无标题栏，取消钮即出口）。
export default function ScanScreen() {
  const th = useNibiTheme();
  const styles = useMemo(() => makeStyles(th), [th]);
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>需要相机权限来扫描桌面端二维码。</Text>
        <PillButton
          label="授权相机"
          buttonSize="lg"
          onPress={() => void requestPermission()}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                setScanned(true);
                void session
                  .startFromQr(data)
                  .finally(() => router.back());
              }
        }
      />
      <PillButton label="取消" variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

const makeStyles = (th: NibiTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: space(4),
      padding: space(6),
      backgroundColor: th.bg,
    },
    camera: {
      width: "100%",
      flex: 1,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    text: { ...text("body"), color: th.inkSub, textAlign: "center" },
  });
