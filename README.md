# dsh-preset-plus

DSH 自定义模式增强插件：仿照SillyTavern 的预设功能, 实现的一个简单的**预设编辑器**（system / user / assistant 条目）。内置jailbreak预设。

## 它解决什么

- 破限场景下，伪造模型的服从输出从而提升破限效果。
- 可以很方便的调整自定义模式系统提示词, 并且能够支持导入导出分享提示词

## 工作方式

### 作用域门禁（核心安全约束）
仅当**当前会话挂载的 preset id ∈ `scopedPresets`**（插件配置，默认 `["jailbreak"]`）时，才向请求注入预设上下文。

其他模式**一律不注入任何虚假上下文**，避免污染非破限场景。

### 注入顺序
```
[system 主提示词] → [user 触发] → [assistant 伪装输出] → [真实 user 输入] → [真实模型输出]
```
其中 system/user/assistant 来自你编辑的预设条目；真实输入与输出是会话本就有的。

>注意: 伪造输入无法记录到"轨迹"中, 可以通过查看控制台打印判断是否注入成功

### AB 双模式
- **自动（auto，可关）**：第一条真实消息到来时自动注入，每会话仅注入一次（防叠加）。
- **手动（/preset-plus prefill）**：用户显式触发，注入标记生效于下一条消息。

## 预设设置界面

![preset-settings.png](docs/assets/preset-settings.png)


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
