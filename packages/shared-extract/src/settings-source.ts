// 来源: nibi-client@ff1c5f4f packages/shared/src/settings-source.ts（未改写语义；仅 import 路径按本包布局调整）
export type SettingsDirectorySource = "nibi" | "agents" | "claude";

export type SettingsDirectoryScope = "user" | "project";

export interface SettingsDirectoryLocation {
  source: SettingsDirectorySource;
  scope: SettingsDirectoryScope;
  directoryPath: string;
  projectPath?: string;
}
