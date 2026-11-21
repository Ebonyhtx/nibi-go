//! 上下文组装的配置（docs/specs/rust-cli/context.md §2）。
//!
//! 由入口 crate 按进程形态与设置构造，经 runtime 传给 [`crate::PromptAssembler`]；不读进程环境。

/// 前端形态：`-p`（非交互）与 TUI 的提示词有差别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    /// `-p` / stream-json。
    Print,
    /// 终端界面。
    Interactive,
}

/// 输出风格（设置 `outputStyle`）。设置了输出风格时，身份后的第一句换成按风格回答的说法。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputStyle {
    pub name: String,
    pub keep_coding_instructions: bool,
}

/// commit 与 PR 的署名行（attribution 设置）。为空的一行不提。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attribution {
    pub commit: Option<String>,
    pub pr: Option<String>,
}

impl Default for Attribution {
    /// NIBI 的署名（用户决定，见 context.md §4.6）。
    fn default() -> Self {
        Self {
            commit: Some(nibi_kernel_prompts::texts::attribution_commit_value().to_owned()),
            pr: Some(nibi_kernel_prompts::texts::attribution_pr_value().to_owned()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ContextConfig {
    pub surface: Surface,
    /// 自动记忆的 CLI 存储根：按**请求的 workspace** 解析
    /// `<root>/memories/projects/<slug>-<hash>/memory`（与 Node `resolveProjectMemoryRoot`
    /// 同口径）。None 表示自动记忆关闭。
    /// 之前这里存的是启动时按单一 workspace 算死的目录——多会话宿主（NIBI-GO 的
    /// app-server，每会话一个 workspace）会让所有会话共享同一份记忆（运营者 2026-11-21
    /// 报告「记忆不是分项目的」）。目录的存在性由使用方按需 create_dir_all。
    pub memory_cli_root: Option<std::path::PathBuf>,
    pub output_style: Option<OutputStyle>,
    pub attribution: Attribution,
    /// `--system-prompt`（docs/specs/rust-cli/cli-args.md §4）：替换缺省的 system prompt 段落；这时也不发 git 状态
    /// （systemContext 为空），规则文件与日期照常。
    pub custom_system_prompt: Option<String>,
    /// `--append-system-prompt`：接在 system prompt 最后一段之后（空行连接）。
    pub append_system_prompt: Option<String>,
}

impl ContextConfig {
    pub fn new(surface: Surface) -> Self {
        Self {
            surface,
            memory_cli_root: None,
            output_style: None,
            attribution: Attribution::default(),
            custom_system_prompt: None,
            append_system_prompt: None,
        }
    }
}
