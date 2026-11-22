// 新建对话归属：底部弹层，FAB 与抽屉「新对话」共用同一份交互。
// 独立会话 / 各项目（当前项目高亮）/ 就地新建项目（名称自动 slug 可改）/ 管理项目入口。
// 之前是 FAB 的锚点小弹窗，而抽屉「新对话」直接静默建会话——两条路两套语义
// （运营者 2026-11-21：抽屉新对话竟然直接新建、新建交互差劲）。统一成一个
// sheet：先选归属再开会话，就地建项目也不必去设置页。
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Icon } from "./Icon";
import { Sheet } from "./ui/Sheet";
import { PillButton } from "./ui/PillButton";
import type { ProjectEntry } from "../kernel/projects";
import { projectWorkspacePath } from "../kernel/workspace";
import { radius, space, text, useNibiTheme } from "../theme";

export function NewChatSheet({
  visible,
  onClose,
  onPick,
  onCreateProject,
  onManage,
  projects,
  activeProjectId,
}: {
  visible: boolean;
  onClose: () => void;
  /** 选定归属（缺省 = 独立会话）；草稿清理与 newSession 由父级做。 */
  onPick: (projectId?: string) => void;
  /** 就地建项目并直接在该项目开会话；抛错由本组件弹 Alert。 */
  onCreateProject: (name: string, folder: string) => Promise<void>;
  /** 管理项目入口（设置 → 项目）。 */
  onManage: () => void;
  projects: readonly ProjectEntry[];
  activeProjectId: string | null;
}) {
  const th = useNibiTheme();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [touchedFolder, setTouchedFolder] = useState(false);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setCreating(false);
    setName("");
    setFolder("");
    setTouchedFolder(false);
  };

  const slugOf = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 40);

  const submitProject = () => {
    const trimmedName = name.trim();
    const trimmedFolder = folder.trim();
    if (!trimmedName || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(trimmedFolder)) return;
    if (busy) return;
    setBusy(true);
    onCreateProject(trimmedName, trimmedFolder)
      .then(resetForm)
      .catch((error: unknown) => {
        Alert.alert("创建失败", error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: th.ink }]}>新建对话</Text>
          <Text style={[styles.subtitle, { color: th.inkFaint }]}>
            选择归属：项目是共享工作区，会话文件与记忆按项目分开
          </Text>
        </View>

        <Pressable
          onPress={() => {
            onClose();
            onPick(undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel="新建独立会话"
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? th.hover : "transparent" },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: th.panel }]}>
            <Icon name="pen" size={15} color={th.inkSub} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: th.ink }]}>独立会话</Text>
            <Text style={[styles.rowDetail, { color: th.inkFaint }]}>
              不归属任何项目，文件放默认目录
            </Text>
          </View>
          <Icon name="chevron-right" size={13} color={th.inkGhost} />
        </Pressable>

        {projects.map((project) => {
          const active = project.id === activeProjectId;
          return (
            <Pressable
              key={project.id}
              onPress={() => {
                onClose();
                onPick(project.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`新建到项目 ${project.name}`}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? th.hover : "transparent" },
              ]}
            >
              <View
                style={[styles.rowIcon, { backgroundColor: active ? th.brandSoft : th.panel }]}
              >
                <Icon name="doc" size={15} color={active ? th.brand : th.inkSub} />
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowLabelRow}>
                  <Text style={[styles.rowLabel, { color: th.ink }]} numberOfLines={1}>
                    {project.name}
                  </Text>
                  {active ? (
                    <View style={[styles.activeBadge, { backgroundColor: th.brandSoft }]}>
                      <Text style={[styles.activeBadgeText, { color: th.brand }]}>当前</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.rowDetail, { color: th.inkFaint }]} numberOfLines={1}>
                  {projectWorkspacePath("<filesDir>", project.id).replace("<filesDir>", "…/files")}
                </Text>
              </View>
              {active ? <Icon name="check" size={13} color={th.brand} /> : null}
            </Pressable>
          );
        })}

        {creating ? (
          <View style={styles.form}>
            <TextInput
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (!touchedFolder) setFolder(slugOf(value));
              }}
              placeholder="项目名称"
              placeholderTextColor={th.inkFaint}
              autoFocus
              style={[styles.input, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
            />
            <TextInput
              value={folder}
              onChangeText={(value) => {
                setFolder(value);
                setTouchedFolder(true);
              }}
              placeholder="文件夹名（a-z、0-9、-）"
              placeholderTextColor={th.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: th.ink, borderColor: th.hairline, backgroundColor: th.surfaceSoft }]}
            />
            <View style={styles.formActions}>
              <PillButton label="取消" variant="secondary" onPress={resetForm} />
              <PillButton
                label={busy ? "创建中…" : "创建并开会话"}
                variant="primary"
                disabled={busy || !name.trim() || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(folder.trim())}
                onPress={submitProject}
              />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            accessibilityLabel="新建项目"
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? th.hover : "transparent" },
            ]}
          >
            <View style={[styles.rowIcon, { backgroundColor: th.brandSoft }]}>
              <Icon name="plus" size={15} color={th.brand} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: th.ink }]}>新建项目…</Text>
              <Text style={[styles.rowDetail, { color: th.inkFaint }]}>
                建完立即在它里面开新会话
              </Text>
            </View>
          </Pressable>
        )}

        <Pressable
          onPress={() => {
            onClose();
            onManage();
          }}
          accessibilityRole="button"
          accessibilityLabel="管理项目"
          style={({ pressed }) => [
            styles.row,
            styles.manageRow,
            { backgroundColor: pressed ? th.hover : "transparent" },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: th.panel }]}>
            <Icon name="folder" size={15} color={th.inkSub} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: th.ink }]}>管理项目…</Text>
          </View>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2), gap: space(1) },
  head: { gap: space(1), paddingBottom: space(2) },
  title: { ...text("title"), fontWeight: "700" },
  subtitle: { ...text("small") },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(2.5),
    borderRadius: radius.control,
  },
  manageRow: { marginTop: space(1), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "transparent" },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowLabelRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  rowLabel: { ...text("body"), fontWeight: "600", flexShrink: 1 },
  rowDetail: { ...text("micro") },
  activeBadge: {
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
  },
  activeBadgeText: { ...text("micro"), fontWeight: "700" },
  form: { gap: space(2), paddingHorizontal: space(2.5), paddingVertical: space(2) },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...text("body"),
  },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2) },
});
