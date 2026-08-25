# Changelog

本文件记录 dsh-preset-plus 的显著变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)；
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复
- 破限注入不再按「一个会话只注入一次」：每个新的主请求都会重新合并 system 并前置 fake 消息，避免第二轮及后续请求丢失破限。同一请求内部重入仍跳过，防止重复叠加。

## 0.1.4 - 2026-08-25

### 新增
- 预设的每条提示词（system/user/assistant）增加独立的启用/禁用开关，与酒馆一致。
- 关闭的 `system` 条目不再覆盖主提示词；关闭的 `user`/`assistant` 条目不再插入对应伪造消息。
- 导入/导出随条目保存 `enabled` 字段；旧数据缺省视为启用。
- 补全 PresetPlus 模式的 agent 组合：默认不再为空，随包附带完整工具集（含委派、规划、压缩、系统等），避免以该模式启动的会话无任何可用工具。
- 构建守卫（`assert-build`）新增检查：组合至少携带一个工具行，防止组合回退为空。

## 0.1.3 - 2026-08-24

### 新增
- 安装插件时自动写入 `preset-plus` Agent Preset 及其 `PresetPlus` 显示描述。
- 用户无需手动创建模式，设置页只负责管理该模式下的多套预设。

## 0.1.2 - 发布修复

### 修复
- 修正 npm 首次发布流程与 CI 锁文件校验。
- 修正发布工作流对内置预设的健康检查。

## 0.1.1 - 多预设与界面修复

### 修复
- 修复同一会话切换预设后执行 `/preset-plus prefill` 仍沿用旧 fake user / fake assistant 消息的问题。
- 修复设置页重复显示预设管理操作的问题。
- 优化预设设置页的布局、卡片和控件样式。

### 新增
- 固定 `preset-plus` 模式支持多套可选预设。
- 内置预设改为随包发布的 `presets/jailbreak.json`。

## 0.1.0 - 初始发行

### 新增
- **破限模式（jailbreak）预设注入**：仅在 `agentPresets.composedPreset ∈ scopedPresets`（默认 `["preset-plus"]`）时，向 `llm/stream` 请求注入破限上下文；其他模式一律不注入（作用域隔离）。
- **多轮对话式注入**：`[system 主提示词][fake user][fake assistant][real user][real assistant]`，不依赖"续写"语义。
- **通用能力破限**：去创作化，非评判、无条件响应用户任何要求（漏洞利用 / 软件逆向 / 网络工具 / 代码生成 / 文字创作均可），"一切跟随用户要求"。
- **AB 双模式**：自动注入（`autoMode`，可关）+ 手动 `/prefill`。
- **预设编辑器**（设置页「预设增强」）：新增/删除/调整顺序/逐条配置 `system`/`user`/`assistant` 角色，第一条强制 system。
- **导入 / 导出预设**：导出为 JSON 文件、粘贴 JSON 导入覆盖保存（`GET /export`、`POST /import`）。
- **持久化**：预设存于 `~/.dsh/preset-plus.json`。
- **终端提示**：注入发生时打印 `[preset-plus] 预设已注入`。

### 说明
- 使用方式与安装见 [README](README.md)。
