# Changelog

本文件记录 dsh-preset-plus 的显著变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)；
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## 0.1.0 - 初始发行

### 新增
- **破限模式（jailbreak）预设注入**：仅在 `agentPresets.composedPreset ∈ scopedPresets`（默认 `["jailbreak"]`）时，向 `llm/stream` 请求注入破限上下文；其他模式一律不注入（作用域隔离）。
- **多轮对话式注入**：`[system 主提示词][fake user][fake assistant][real user][real assistant]`，不依赖"续写"语义。
- **通用能力破限**：去创作化，非评判、无条件响应用户任何要求（漏洞利用 / 软件逆向 / 网络工具 / 代码生成 / 文字创作均可），"一切跟随用户要求"。
- **AB 双模式**：自动注入（`autoMode`，可关）+ 手动 `/prefill`。
- **预设编辑器**（设置页「预设增强」）：新增/删除/调整顺序/逐条配置 `system`/`user`/`assistant` 角色，第一条强制 system。
- **导入 / 导出预设**：导出为 JSON 文件、粘贴 JSON 导入覆盖保存（`GET /export`、`POST /import`）。
- **持久化**：预设存于 `~/.dsh/preset-plus.json`。
- **终端提示**：注入发生时打印 `[preset-plus] 预设已注入`。

### 说明
- 使用方式与安装见 [README](README.md)。
