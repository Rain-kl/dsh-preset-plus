# dsh-preset-plus

DSH 通用图例增强插件：一个可编辑的**预设编辑器**（system / user / assistant 条目 + 伪装模型输出预填充），**仅在指定 preset（如破限模式）下生效**。内置破限（jailbreak）预设。

> 纯插件实现，**不修改 DSH 源码**。宿主端通过 `llm/stream` waterfall 注入；客户端通过 `settings.section` 设置页编辑。

## 它解决什么

在酒馆（SillyTavern）里，破限之所以更强，是因为它用了 **预填充（assistant_prefill / 伪装模型输出）**：
把"模型已经写出的一小段配合内容"预置进请求，让真实模型从**已经配合的位置**续写，而不是从零推理再拒绝。

DSH 原生**没有 prefill**（源码中被 prune）。本插件在纯插件空间里复刻这一行为：
在 `llm/stream` 瀑布里，向请求的 `messages` 前端插入 **system 主提示词 → user 触发 → assistant 伪装输出** 这一段"已经开始的输出"，真实模型便从该位置续写。

## 工作方式

### 作用域门禁（核心安全约束）
仅当**当前会话挂载的 preset id ∈ `scopedPresets`**（插件配置，默认 `["jailbreak"]`）时，才向请求注入预设上下文。其他模式**一律不注入任何虚假上下文**，避免污染非破限场景。判据来自 `agentPresets.composedPreset(agent.ctx)`。

### 注入顺序
```
[system 主提示词] → [user 触发] → [assistant 伪装输出] → [真实 user 输入] → [真实模型输出]
```
其中 system/user/assistant 来自你编辑的预设条目；真实输入与输出是会话本就有的。

### AB 双模式
- **自动（auto，可关）**：第一条真实消息到来时自动注入，每会话仅注入一次（防叠加）。
- **手动（/prefill）**：用户显式触发，注入标记生效于下一条消息。

## 预设模型（酒馆式）

一个预设 = 一组有序条目（entries），每条含 `role` 与 `text`：

| role | 作用 |
|---|---|
| `system` | **主提示词**（覆盖请求的 system），**第一条必须是它** |
| `user` | 破限增强，以 user 角色注入到上下文 |
| `assistant` | **伪装模型输出**（预填充种子），在 system 与真实输出之间 |

用户可在设置页 **新增/删除/调整顺序/修改角色/编辑文本**，实时保存到 `~/.dsh/preset-plus.json`。

## 安装

1. 将本目录 link 进 web profile（参照 `dsh-purge`）：
   - `~/.dsh/profiles/web/package.json` 的 `dependencies` 加 `"dsh-preset-plus": "link:/Users/ryan/Documents/DSH/dsh-preset-plus"`
   - `dsh.profile.bundles` 数组加 `"dsh-preset-plus"`
   - 重新 `pnpm install`（在该 profile 下）
2. 重启 dsh Web。

> 客户端 bundle 通过插件 `package.json` 的 `dsh.client` 配置 + `client.js` 注入。

## 命令 / 工具

- `/preset-plus status | prefill | on | off | save`
- 模型工具：`preset_plus_status`

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: dsh-preset-plus
      name: 'dsh-preset-plus'
      config:
        enabled: true
        scopedPresets: ["jailbreak"]
        autoMode: true
        verbose: false
```

## 许可
MIT
