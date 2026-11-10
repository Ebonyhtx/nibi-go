import { StyleSheet, Text, View } from 'react-native';

// A0 占位：NIBI-WORK 形态屏。
// A1 起替换为配对/连接流（扫码 → 设备注册 → 连接状态，plan.md 里程碑 A1）。
export default function WorkScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NIBI-WORK</Text>
      <Text style={styles.sub}>配对与连接（A1 里程碑）占位屏</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { marginTop: 8, color: '#666' },
});
