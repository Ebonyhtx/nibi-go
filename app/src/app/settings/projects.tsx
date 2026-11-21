// 项目管理：持久工作区（多个会话共享一个目录；记忆/文件/项目级 agents 按项目聚合）。
// 删除项目只删映射不删磁盘目录——里面可能有用户文件；删除后其下会话在抽屉归入「独立会话」。
// 新建对话默认进「当前项目」（抽屉的项目筛选也用它）；没有项目时沿用独立会话目录。
// Android 没有 Alert.prompt：新建/重命名用页内输入行。
import { router } from "expo-router";
import { useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Row } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { PillButton } from "../../components/ui/PillButton";
import { AppearIn, staggerDelay } from "../../motion/appear";
import {
  createProject,
  deleteProject,
  renameProject,
  setActiveProject,
  useProjects,
  type ProjectEntry,
} from "../../kernel/projects";
import { projectWorkspacePath } from "../../kernel/workspace";
import { radius, space, text, useNibiTheme } from "../../theme";

export default function ProjectsScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { projects, activeProjectId } = useProjects();
  const [busy, setBusy] = useState(false);
  // 编辑态：null=没有输入行；creating=新建；{ id, name }=重命名既有项目。
  const [editing, setEditing] = useState<
    { kind: "create"; name: string } | { kind: "rename"; id: string; name: string } | null
  >(null);

  function run(action: () => Promise<void>): void {
    if (busy) return;
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        Alert.alert("操作失败", error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  }

  function submitName(): void {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    run(async () => {
      if (editing.kind === "create") await createProject(name);
      else await renameProject(editing.id, name);
      setEditing(null);
    });
  }

  function confirmDelete(project: ProjectEntry): void {
    Alert.alert(
      `删除项目「${project.name}」？`,
      "只删除项目本身；项目目录里的文件与会话都保留，之后在抽屉里归入「独立会话」。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => run(() => deleteProject(project.id)),
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="项目" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            项目是共享的工作区：同项目的会话共用文件，记忆也按项目分开。
          </Text>
        </AppearIn>

        {projects.map((project, index) => {
          const active = activeProjectId === project.id;
          const renaming = editing?.kind === "rename" && editing.id === project.id;
          return (
            <AppearIn key={project.id} delay={staggerDelay(index + 1, 32, 240)}>
              <SectionCard>
                {renaming ? (
                  <View style={styles.nameForm}>
                    <TextInput
                      value={editing.name}
                      onChangeText={(name) =>
                        setEditing(editing.kind === "rename" ? { ...editing, name } : editing)
                      }
                      autoFocus
                      style={[
                        styles.nameInput,
                        { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft },
                      ]}
                    />
                    <View style={styles.actions}>
                      <PillButton
                        label="取消"
                        variant="secondary"
                        onPress={() => setEditing(null)}
                      />
                      <PillButton
                        label={busy ? "保存中…" : "保存"}
                        variant="primary"
                        disabled={busy || !editing.name.trim()}
                        onPress={submitName}
                      />
                    </View>
                  </View>
                ) : (
                  <>
                    <Row
                      icon="doc"
                      tone={active ? "brand" : "plain"}
                      title={project.name}
                      detail={projectWorkspacePath("<filesDir>", project.id).replace(
                        "<filesDir>",
                        "…/files",
                      )}
                      right={
                        active ? (
                          <Text style={[styles.activeBadge, { color: th.brand }]}>当前</Text>
                        ) : undefined
                      }
                    />
                    <Divider />
                    <View style={styles.actions}>
                      <PillButton
                        label={active ? "取消当前" : "设为当前"}
                        variant="secondary"
                        disabled={busy}
                        onPress={() => run(() => setActiveProject(active ? null : project.id))}
                      />
                      <PillButton
                        label="重命名"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => setEditing({ kind: "rename", id: project.id, name: project.name })}
                      />
                      <PillButton
                        label="删除"
                        variant="danger"
                        disabled={busy}
                        onPress={() => confirmDelete(project)}
                      />
                    </View>
                  </>
                )}
              </SectionCard>
            </AppearIn>
          );
        })}

        {editing?.kind === "create" ? (
          <AppearIn>
            <SectionCard>
              <View style={styles.nameForm}>
                <TextInput
                  value={editing.name}
                  onChangeText={(name) =>
                    setEditing(editing.kind === "create" ? { ...editing, name } : editing)
                  }
                  placeholder="项目名称"
                  placeholderTextColor={th.inkFaint}
                  autoFocus
                  style={[
                    styles.nameInput,
                    { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft },
                  ]}
                />
                <View style={styles.actions}>
                  <PillButton label="取消" variant="secondary" onPress={() => setEditing(null)} />
                  <PillButton
                    label={busy ? "创建中…" : "创建"}
                    variant="primary"
                    disabled={busy || !editing.name.trim()}
                    onPress={submitName}
                  />
                </View>
              </View>
            </SectionCard>
          </AppearIn>
        ) : (
          <AppearIn delay={staggerDelay(projects.length + 1, 32, 240)}>
            <Row
              icon="plus"
              title="新建项目"
              detail="给一组会话一个共享的工作区"
              onPress={() => setEditing({ kind: "create", name: "" })}
            />
          </AppearIn>
        )}

        {projects.length === 0 && editing === null ? (
          <AppearIn delay={staggerDelay(projects.length + 2, 32, 240)}>
            <Text style={[styles.empty, { color: th.inkFaint }]}>
              还没有项目；新建对话默认用独立目录。
            </Text>
          </AppearIn>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  intro: { ...text("small") },
  nameForm: { paddingHorizontal: space(3.5), paddingVertical: space(2.5), gap: space(2) },
  nameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...text("body"),
  },
  activeBadge: { ...text("micro"), fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  empty: { ...text("small") },
});
