// 来源: nibi-client@ff1c5f4f packages/shared/src/nibi-protocol/index.ts 行 1159-1210（局部抽取：仅 usage-stats.ts 需要的两个 type）
// 说明：上游 usage-stats.ts 以 `import type` 引用这两个类型（编译期擦除，无运行时 schema 依赖）；
// 为避免拖入 legacy 全量桶（4221 行），本包按需抽取定义。升级时对照上游 diff 复核。
export type ZCodeAccountAccess =
  | { type: "zhipu-account"; family: "zai" | "bigmodel"; planKind: "start-plan" }
  | { type: "zhipu-account"; family: "zai" | "bigmodel"; planKind: "individual-coding-plan" }
  | {
      type: "zhipu-account";
      family: "zai" | "bigmodel";
      planKind: "team-coding-plan";
      productId: string;
      organizationId: string;
      projectId: string;
    };

/** Active Model 固定的账号访问类别；当前商品和 Team scope 由账号服务在请求期解析。 */
export interface ZCodeProviderAccountAccess {
  type: "zhipu-account";
  accountType: "zai" | "bigmodel";
  mode: "start-plan" | "individual-coding-plan" | "team-coding-plan";
  entitled: boolean;
}
