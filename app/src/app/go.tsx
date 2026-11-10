import { StyleSheet, Text, View } from 'react-native';

// A0 占位：NIBI-GO 形态屏。
// Phase C 挂起（D12）：启动信号 = 主线 kernel 对齐批次收尾 + cli-android-arm64 发布。
// 此屏在 C 立项前不承载任何功能（双形态纪律 D2/D13：GO 数据不出机、生态独立）。
export default function GoScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NIBI-GO</Text>
      <Text style={styles.sub}>本机 AGENT · Phase C 挂起（占位）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { marginTop: 8, color: '#666' },
});
