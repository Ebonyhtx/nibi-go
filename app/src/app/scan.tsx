import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { useSession } from "../relay/useSession";

// 扫码屏（D7：QR 只含 sid/mid/name/app_version 路由提示，无秘密）。
// 扫到 → session.startFromQr（解析+落凭据+建连）→ 回 work 屏看连接状态。
export default function ScanScreen() {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>需要相机权限来扫描桌面端二维码。</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>授权相机</Text>
        </Pressable>
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
      <Pressable style={styles.cancel} onPress={() => router.back()}>
        <Text style={styles.buttonText}>取消</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  camera: { width: "100%", flex: 1, borderRadius: 12, overflow: "hidden" },
  text: { fontSize: 14, color: "#666", textAlign: "center" },
  button: { padding: 14, borderRadius: 12, backgroundColor: "#e8f0fe" },
  buttonText: { fontSize: 15, fontWeight: "600" },
  cancel: { padding: 12, borderRadius: 12, backgroundColor: "#f0f0f0" },
});
