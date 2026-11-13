import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PetView, type PetStateId } from "../components/PetView";
import { PET_STATE } from "../components/petStates";

const STATE_LABEL: Record<PetStateId, string> = {
  idle: "待机",
  working: "敲代码",
  thinking: "思考",
  done: "完成",
  waiting: "等确认",
  error: "出错",
  carrying: "搬东西",
  flying: "飞行",
  sleeping: "睡觉",
};

const ALL_STATES = Object.values(PET_STATE);

// 宠物态验证台（临时）：GO 主体重排（会话即首页）落地时本屏退役，
// 宠物挪进空态舞台与输入栏上方（见 docs/design/go-home-uiux-redesign.html）。
export default function GoScreen() {
  const [state, setState] = useState<PetStateId>(PET_STATE.sleeping);

  return (
    <View style={styles.container}>
      <PetView key={state} state={state} scale={3} />
      <Text style={styles.title}>{STATE_LABEL[state]}</Text>
      <ScrollView contentContainerStyle={styles.chips} showsVerticalScrollIndicator={false}>
        {ALL_STATES.map((id) => (
          <Pressable
            key={id}
            style={[styles.chip, id === state && styles.chipOn]}
            onPress={() => setState(id)}
          >
            <Text style={[styles.chipText, id === state && styles.chipTextOn]}>{STATE_LABEL[id]}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: "#f9f2e4", padding: 16 },
  title: { fontSize: 15, fontWeight: "700", color: "#1c2f4e" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingBottom: 20 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fffdf9", borderWidth: 1, borderColor: "rgba(28,47,78,.12)" },
  chipOn: { backgroundColor: "#e08a3e", borderColor: "#e08a3e" },
  chipText: { fontSize: 12.5, fontWeight: "600", color: "#1c2f4e" },
  chipTextOn: { color: "#fff9ef" },
});
