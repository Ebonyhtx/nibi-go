import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// A0 占位：双形态切换入口（D2：App 内切换按钮）。
// NIBI-WORK = Phase A 远控投影（复用 PWA 形式原生重画，D4）；
// NIBI-GO = Phase C 挂起（D12），仅占位、不提供任何 GO 功能入口。
export default function ModeSwitchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NIBI-GO</Text>

      <Link href="/work" asChild>
        <Pressable style={styles.card}>
          <Text style={styles.cardTitle}>NIBI-WORK</Text>
          <Text style={styles.cardSub}>远控投影 · Phase A 进行中</Text>
        </Pressable>
      </Link>

      <Link href="/go" asChild>
        {/* expo-router Slot 要求 asChild 子组件用单一 style 对象（数组会抛错，SDK 58） */}
        <Pressable style={styles.cardGo}>
          <Text style={styles.cardTitle}>NIBI-GO</Text>
          <Text style={styles.cardSub}>本机 AGENT · Phase C 挂起（占位）</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#fff',
  },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 24 },
  card: {
    width: 260,
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#e8f0fe',
    alignItems: 'center',
  },
  cardGo: {
    width: 260,
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  cardSub: { fontSize: 12, color: '#666', marginTop: 4 },
});
