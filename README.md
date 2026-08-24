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

### npm 直装（推荐，无需构建）
```bash
dsh plugin --profile web add @rain-kl/dsh-preset-plus
```

### git 直装
```bash
dsh plugin --profile web add github:Rain-kl/dsh-preset-plus
```

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

## 发布（维护者）

发布流程（照搬 modlens 模式）：`pnpm release <version>` 负责 bump 版本、打 `v*` tag、push；**push 出 tag 后 CI 的 `.github/workflows/release.yml` 是唯一发布点**。

```bash
pnpm release 0.1.1     # 显式版本
pnpm release patch      # 从当前版本 bump
```

`release` 脚本会先做守卫（git 干净、在 main、版本前进、tag 不存在、远端同步、CHANGELOG 有对应段），全部通过才不可逆地提交+打tag+push。发布与建 GitHub Release 由 CI 执行：

- **`.github/workflows/ci.yml`**：push/PR 触发，做发布入口健康检查（`scripts/assert-build.mjs` + 语法检查）。
- **`.github/workflows/release.yml`**：push `v*` tag 触发，用 OIDC 信任发布（`npm publish --provenance`）+ 从 CHANGELOG 提取 notes 建 GitHub Release。

**发布前的唯一前置（无法在仓库内配置）**：在 npmjs.com 打开 `@rain-kl/dsh-preset-plus` 的 package 设置 → **Trusted publishers** → 添加本仓库与本 workflow（`Rain-kl/dsh-preset-plus`，`.github/workflows/release.yml`）。未配置前 `npm publish --provenance` 会以身份错误失败。

## 许可
MIT
