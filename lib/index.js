// dsh-preset-plus 宿主端插件入口
//
// 功能（纯插件空间，不修改 DSH 源码）：
//   1. 预设编辑器后端：读取/保存用户可编辑的预设条目（system/user/assistant），
//      持久化到 <dshHome>/preset-plus.json。
//   2. 作用域门禁：仅当"当前会话挂载的 preset id ∈ scopedPresets"时，才向请求
//      注入预设上下文；其他模式一律不注入任何虚假上下文。
//   3. 破限注入引擎（llm/stream waterfall）：
//        - system 条目 → 覆盖 options.system（主提示词）
//        - 随后的 user / assistant 条目 → 按顺序插入 messages 前端，
//          构造「伪装模型输出」预填充上下文，让真实模型在已配合的语境下输出。
//   4. AB 双模式：
//        - auto（自动）：第一条真实消息到来时，自动注入预设条目（可配置关闭）
//        - /prefill（手动）：用户显式触发注入
//   5. /preset-plus 命令 + 模型工具 + HTTP API（设置页）
//
// 注入定位：llm/stream 瀑布是唯一能改 options.messages 且不发散到来源代码的口子；
// 不能用 agent/request（其文档明确"cannot mutate messages"）。我们用
// ctx.agents.get(options.sessionId) 找回 Agent，再 agentPresets.composedPreset(agent.ctx)
// 做作用域判断。

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import * as core from "./core.js";

export const name = "dsh-preset-plus";

export const inject = ["systemPrompt", "tools", "llm", "agents"];

const DEFAULTS = {
  enabled: true,
  scopedPresets: ["jailbreak"],
  autoMode: true,
  verbose: false,
};

const log = (config, ...args) => {
  if (config?.verbose) console.log("[dsh-preset-plus]", ...args);
};

function findDshHome() {
  return core.findDshHome();
}

// ═══════════════════════════════════════════════════════════════════
//  注入引擎：把预设条目合成为"系统 + 伪装上下文"，修改 GenerateOptions
// ═══════════════════════════════════════════════════════════════════

/**
 * 判断某个 agent 是否命中作用域（当前 preset id ∈ scopedPresets）。
 * scopedPresets 为空数组 = 关闭所有注入。
 */
function enabledForAgent(agentPresets, agents, sessionId, cfg) {
  if (!cfg.enabled) return false;
  const scopes = Array.isArray(cfg.scopedPresets) ? cfg.scopedPresets : [];
  if (scopes.length === 0) return false;
  const agent = agents.get(sessionId);
  if (agent === undefined) return false;
  const current = agentPresets.composedPreset(agent.ctx);
  return scopes.includes(current);
}

/** 构造要注入的消息序列。返回 { system, inject }：
 *  - system: 覆盖 options.system 的文本（若存在 system 条目）
 *  - inject: 要插到 real user 之前的 Message[]（fake user + fake assistant），
 *    按条目原顺序排列，构成"预置破限示范对话"：
 *      [system 主提示词][fake user][fake assistant][real user][real assistant]
 *    real assistant 是模型对 real user 的真实输出，与注入的 fake assistant 无关。
 *    不使用"续写"（最后一条是 assistant）语义——fake assistant 是独立的示范回合。
 */
function buildInjection(entries, makeUserMessage, makeAssistantMessage, provider, model) {
  const systemEntries = entries.filter((e) => e.role === "system");
  const inject = [];
  for (const e of entries) {
    if (e.role === "system") continue;
    if (e.role === "user") {
      inject.push(makeUserMessage({ text: e.text }));
    } else if (e.role === "assistant") {
      inject.push(makeAssistantMessage({ text: e.text, provider, model }));
    }
  }
  // 第一条必须 system：取其作为主提示词（若一个都没有则不覆盖 system）。
  const system = systemEntries.length > 0 ? systemEntries[0].text : undefined;
  return { system, inject };
}

/**
 * 挂到 llm/stream 瀑布。每次模型调用前，若命中作用域且允许注入，
 * 则在 messages 前端插入伪装上下文 + 覆盖 system。
 * 手动 /prefill 会先写入 sessionId→已注入 状态（防重复），auto 则始终启用，
 * 但只在"尚未注入过"的会话里插一次，避免每轮都重复叠加。
 */
function installInjector(ctx, cfg) {
  // 每个 session 是否已注入过（auto 只注入一次；manual 之后不再叠加）
  const injected = new Set();

  const readEntries = () => {
    try {
      return core.loadPreset().entries;
    } catch {
      return [];
    }
  };

  ctx.on("llm/stream", (options, next) => {
    const sessionId = options.sessionId;
    const agentPresets = ctx.get("agentPresets");
    // 循环内置请求是 deepFreeze 的（在 llm/stream 监听器里改写会抛错），
    // 所以不能原地改 options；必须构造一个新的、可变请求并重新进入 llm.stream。
    // 但重新进入会再次触发本监听器——用 injected 集合防死循环：
    // 首次进入时标记，构建新请求；新请求再次进入时 already-injected → 放行 next()。

    // 只在"主对话请求"上注入：session-title / compaction 等辅助调用带
    // options.purpose，主对话请求 purpose === undefined。这样辅助调用
    // 既不会误触发注入，也不会消费掉"每会话只注入一次"的标记。
    const isMain = options.purpose === undefined;

    const shouldInject = (
      isMain
      && enabledForAgent(agentPresets, ctx.agents, sessionId, cfg)
      && !injected.has(sessionId)
    );
    if (!shouldInject) return next();

    const entries = readEntries();
    if (entries.length === 0) return next();

    const { system, inject } = buildInjection(
      entries,
      (t) => makeUser(ctx, t.text),
      (t) => makeAssistant(ctx, t.text, t.provider, t.model),
      options.provider,
      options.model,
    );

    // 标记注入（一次会话仅一次）。手动 /prefill 提前标记，此处跳过。
    injected.add(sessionId);

    // 终端提示：本轮已注入破限预设上下文。
    console.log("[preset-plus] 预设已注入 → session=" + sessionId +
      ", inject=" + inject.length + ", system=" + (system ? "覆盖" : "未覆盖"));

    // 构造新的、可变的请求（浅拷贝 + 注入），保持原 provider/model，
    // 重新进入 llm.stream 把内容递到真实适配器。injected 标记已置位，
    // 因此重入时本监听器直接 next()，不会再次注入，也不会递归。
    // 多轮对话式：把 fake user + fake assistant 按条目顺序插到 real user 之前，
    // 构成 [system 主提示词][fake user][fake assistant][real user][real assistant]。
    const mutableOptions = {
      ...options,
      ...(inject.length > 0 ? { messages: [...inject, ...(options.messages || [])] } : {}),
      ...(system !== undefined ? { system } : {}),
    };
    // 用 ctx.llm.stream 重新进入（provider 未改，路由到真实适配器）。
    return ctx.llm.stream(mutableOptions);
  });

  // 暴露给 /prefill 命令和工具：手动注入并标记，供下次请求生效。
  return {
    prefill(sessionId) {
      const agent = ctx.agents.get(sessionId);
      if (!enabledForAgent(ctx.get("agentPresets"), ctx.agents, sessionId, cfg)) {
        return { ok: false, reason: "not-in-scope" };
      }
      injected.add(sessionId);
      return { ok: true, sessionId };
    },
    isInjected(sessionId) {
      return injected.has(sessionId);
    },
    reset(sessionId) {
      injected.delete(sessionId);
    },
  };
}

/** 创建 user 消息（fake user：预置破限示范对话的 user 回合）。 */
function makeUser(ctx, text) {
  return messageFactory().createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: name },
  });
}

/** 创建 assistant 消息（source 指向真实模型，pi-ai 会以 foreignAssistant 序列化）。 */
function makeAssistant(ctx, text, provider, model) {
  return messageFactory().createAssistantMessage({
    content: [{ type: "text", text }],
    source: { kind: "model", provider: provider || "dsh-foreign", model: model || "dsh-foreign" },
  });
}

// 一个与源码一致的轻量消息工厂（无 dsh-llm peer 依赖）：
// 与 @deepseek-ai/dsh-llm message.ts 的 createUserMessage / createAssistantMessage 一致——deepFreeze + randomUUID。
function messageFactory() {
  const freeze = (o) => Object.freeze(structuredClone(o));
  return {
    createUserMessage(input) {
      return freeze({ ...input, id: randomUUID(), role: "user" });
    },
    createAssistantMessage(input) {
      return freeze({
        id: randomUUID(),
        role: "assistant",
        content: input.content,
        source: { kind: "model", ...input.source },
      });
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  设置页 HTTP API
// ═══════════════════════════════════════════════════════════════════

function installWebServer(ctx, cfg, injector) {
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      const json = (res, status, payload) => {
        res.writeHead(status, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(payload));
      };
      const readBody = async (req) => {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > 512 * 1024) throw new Error("body too large");
          chunks.push(buf);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      };

      // GET: 当前预设 + 作用域状态
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/state",
        handler: async (req, res) => {
          if (req.method !== "GET") {
            res.writeHead(405, { allow: "GET" });
            res.end();
            return;
          }
          try {
            const preset = core.loadPreset();
            json(res, 200, {
              ok: true,
              preset,
              scopedPresets: cfg.scopedPresets,
              autoMode: cfg.autoMode,
              dshHome: findDshHome(),
            });
          } catch (e) {
            json(res, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-preset-plus: state");

      // POST: 保存预设
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/save",
        handler: async (req, res) => {
          if (req.method !== "POST") {
            res.writeHead(405, { allow: "POST" });
            res.end();
            return;
          }
          try {
            const body = await readBody(req);
            const saved = await core.savePreset(body?.preset || {});
            json(res, 200, { ok: true, preset: saved });
          } catch (e) {
            json(res, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-preset-plus: save");

      // POST: 手动 /prefill（标记某会话待注入）
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/prefill",
        handler: async (req, res) => {
          if (req.method !== "POST") {
            res.writeHead(405, { allow: "POST" });
            res.end();
            return;
          }
          try {
            const body = await readBody(req);
            const sessionId = body?.sessionId;
            if (typeof sessionId !== "string" || sessionId === "") {
              json(res, 400, { ok: false, error: "sessionId required" });
              return;
            }
            const r = injector.prefill(sessionId);
            json(res, r.ok ? 200 : 409, r);
          } catch (e) {
            json(res, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-preset-plus: prefill");
    }, "dsh-preset-plus: http routes");
  });
}

// ═══════════════════════════════════════════════════════════════════
//  命令 + 模型工具
// ═══════════════════════════════════════════════════════════════════

function renderPresetText(preset) {
  const lines = []; 
  lines.push(`预设: ${preset.name}  (${preset.entries.length} 条)`);
  lines.push(`自动注入: ${preset.autoMode ? "开" : "关"}`);
  for (const [i, e] of preset.entries.entries()) {
    lines.push(`[${i + 1}] ${e.role.toUpperCase()} · ${e.text.slice(0, 60)}${e.text.length > 60 ? "…" : ""}`);
  }
  return lines.join("\n");
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (!cfg.enabled) return;

  const injector = installInjector(ctx, cfg);
  installWebServer(ctx, cfg, injector);

  // 1. /preset-plus 命令
  const commands = ctx.get?.("commands");
  if (commands) {
    commands.register({
      name: "preset-plus",
      description: "破限预设增强（status/prefill/on/off/save）",
      input: { hint: "status | prefill | on | off | save" },
      handler: async (invocation) => {
        const args = (invocation.rawInput ?? "").trim().split(/\s+/).filter(Boolean);
        const sub = (args[0] || "status").toLowerCase();
        const sessionId = invocation.sessionId;
        switch (sub) {
          case "status":
          case "s": {
            const preset = core.loadPreset();
            return {
              kind: "success",
              text: renderPresetText(preset) + `\n\n当前作用域: ${(cfg.scopedPresets || []).join(", ") || "(空=关闭)"}\n本会话是否已注入: ${injector.isInjected(sessionId) ? "是" : "否"}`,
            };
          }
          case "prefill":
          case "p": {
            const r = injector.prefill(sessionId);
            return r.ok
              ? { kind: "success", text: "已标记本会话待注入破限伪装上下文（下一条消息生效）。" }
              : { kind: "error", text: "无法预填充: " + r.reason + "（当前会话未命中破限作用域）" };
          }
          case "on": {
            await core.savePreset({ ...core.loadPreset(), autoMode: true });
            return { kind: "success", text: "已开启自动注入。" };
          }
          case "off": {
            await core.savePreset({ ...core.loadPreset(), autoMode: false });
            return { kind: "success", text: "已关闭自动注入（手动 /prefill 仍可用）。" };
          }
          case "save": {
            const preset = core.loadPreset();
            return { kind: "success", text: "当前预设:\n" + renderPresetText(preset) };
          }
          default:
            return { kind: "success", text: "dsh-preset-plus 命令: status | prefill | on | off | save" };
        }
      },
    });
  }

  // 2. 模型工具
  if (ctx.tools) {
    ctx.tools.register({
      name: "preset_plus_status",
      description: "查看 dsh-preset-plus 破限预设当前条目、作用域与注入状态。",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      output: { schema: { type: "object", additionalProperties: false, properties: { text: { type: "string" } } }, render: (_a, v) => [{ type: "text", text: String(v?.text ?? "") }] },
      async execute() {
        const preset = core.loadPreset();
        return { text: renderPresetText(preset) + `\n作用域: ${(cfg.scopedPresets || []).join(", ") || "(空)"}` };
      },
    });
  }
}
