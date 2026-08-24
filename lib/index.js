// dsh-preset-plus 宿主端插件入口
//
// 功能（纯插件空间，不修改 DSH 源码）：
//   1. 多预设编辑器后端：读取/保存多套预设（system/user/assistant 条目），持久化
//      到 <dshHome>/preset-plus.json（{ version, activePresetId, presets }）。
//   2. 模式固定、预设动态：模式（agentPreset id）= "preset-plus"，作用域门禁用
//      scopedPresets（默认 ["preset-plus"]）。会话挂在该模式下，就用"当前激活预设
//      （activePresetId）"的 entries 注入。
//   3. 破限注入引擎（llm/stream waterfall）：
//        - system 条目 → 覆盖 options.system（主提示词）
//        - 随后的 user / assistant 条目 → 按顺序插入 messages 前端，
//          构造「伪装模型输出」预填充上下文，让真实模型在已配合的语境下输出。
//   4. AB 双模式：auto（自动，可关）+ /prefill（手动强制，即使 autoMode 关闭）。
//   5. /preset-plus 命令 + 模型工具 + HTTP API（设置页）。
//
// 注入定位：llm/stream 瀑布是唯一能改 options.messages 且不发散到来源代码的口子；
// 不能用 agent/request（其文档明确"cannot mutate messages"）。
// 用 ctx.agents.get(options.sessionId) 找回 Agent，再 agentPresets.composedPreset(agent.ctx)
// 做作用域判断。

import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import * as core from "./core.js";

export const name = "dsh-preset-plus";

export const inject = ["systemPrompt", "tools", "llm", "agents"];

const DEFAULTS = {
  enabled: true,
  // 模式 id 固定为 preset-plus。
  scopedPresets: ["preset-plus"],
  verbose: false,
};

// ═══════════════════════════════════════════════════════════════════
//  注入引擎
// ═══════════════════════════════════════════════════════════════════

function enabledForAgent(agentPresets, agents, sessionId, cfg) {
  if (!cfg.enabled) return false;
  const scopes = Array.isArray(cfg.scopedPresets) ? cfg.scopedPresets : [];
  if (scopes.length === 0) return false;
  const agent = agents.get(sessionId);
  if (agent === undefined) return false;
  const current = agentPresets.composedPreset(agent.ctx);
  return scopes.includes(current);
}

/** 把预设条目的 entries 合成为 [system, (fake user/assistant)...] 注入内容。 */
function buildInjection(entries, makeUserMessage, makeAssistantMessage, provider, model) {
  const systemEntries = entries.filter((e) => e.role === "system");
  const inject = [];
  for (const e of entries) {
    if (e.role === "system") continue;
    if (e.role === "user") inject.push(makeUserMessage({ text: e.text }));
    else if (e.role === "assistant") inject.push(makeAssistantMessage({ text: e.text, provider, model }));
  }
  const system = systemEntries.length > 0 ? systemEntries[0].text : undefined;
  return { system, inject };
}

function installInjector(ctx, cfg) {
  const injected = new Set();
  const force = new Set();
  // 记录本插件上一轮注入的临时消息；同会话手动切换预设时先移除旧副本。
  const injectedMessageIds = new Map();

  ctx.on("llm/stream", (options, next) => {
    const sessionId = options.sessionId;
    const agentPresets = ctx.get("agentPresets");

    const isMain = options.purpose === undefined;
    const preset = core.loadActiveEntries();
    const autoModeOn = (() => {
      try { return core.loadActivePreset()?.autoMode !== false; } catch { return true; }
    })();
    const wantsForce = force.has(sessionId);

    const shouldInject = (
      isMain
      && enabledForAgent(agentPresets, ctx.agents, sessionId, cfg)
      && (autoModeOn || wantsForce)
      // 手动 prefill 是显式重注入：允许同一会话切换预设后再次注入。
      && (wantsForce || !injected.has(sessionId))
    );
    if (!shouldInject) return next();

    const entries = preset;
    if (entries.length === 0) return next();

    const { system, inject } = buildInjection(
      entries,
      (t) => makeUser(ctx, t.text),
      (t) => makeAssistant(ctx, t.text, t.provider, t.model),
      options.provider,
      options.model,
    );

    // 自动注入保持“一次/会话”；手动 prefill 每次都代表一次新的显式注入。
    if (!wantsForce) injected.add(sessionId);
    force.delete(sessionId);

    console.log("[preset-plus] 预设已注入 → session=" + sessionId +
      ", inject=" + inject.length + ", system=" + (system ? "覆盖" : "未覆盖"));

    const oldIds = injectedMessageIds.get(sessionId) || new Set();
    const sourceMessages = (options.messages || []).filter((message) => !oldIds.has(message?.id));
    injectedMessageIds.set(sessionId, new Set(inject.map((message) => message.id)));
    const mutableOptions = {
      ...options,
      ...(inject.length > 0 ? { messages: [...inject, ...sourceMessages] } : { messages: sourceMessages }),
      ...(system !== undefined ? { system } : {}),
    };
    return ctx.llm.stream(mutableOptions);
  });

  return {
    prefill(sessionId) {
      if (!enabledForAgent(ctx.get("agentPresets"), ctx.agents, sessionId, cfg)) {
        return { ok: false, reason: "not-in-scope" };
      }
      force.add(sessionId);
      return { ok: true, sessionId };
    },
    isInjected(sessionId) { return injected.has(sessionId); },
    reset(sessionId) {
      injected.delete(sessionId);
      force.delete(sessionId);
      injectedMessageIds.delete(sessionId);
    },
  };
}

/** 创建 user 消息（fake user）。 */
function makeUser(ctx, text) {
  return messageFactory().createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: name },
  });
}

/** 创建 assistant 消息（source 指向真实模型，pi-ai 以 foreignAssistant 序列化）。 */
function makeAssistant(ctx, text, provider, model) {
  return messageFactory().createAssistantMessage({
    content: [{ type: "text", text }],
    source: { kind: "model", provider: provider || "dsh-foreign", model: model || "dsh-foreign" },
  });
}

function messageFactory() {
  const freeze = (o) => Object.freeze(structuredClone(o));
  return {
    createUserMessage(input) {
      return freeze({ ...input, id: randomUUID(), role: "user" });
    },
    createAssistantMessage(input) {
      return freeze({ id: randomUUID(), role: "assistant", content: input.content, source: { kind: "model", ...input.source } });
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  HTTP API（设置页）
// ═══════════════════════════════════════════════════════════════════

function installWebServer(ctx, cfg, injector) {
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      const json = (res, status, payload) => {
        res.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
      };
      const readBody = async (req) => {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > 512 * 1024) throw new Error("body too large");
          chunks.push(buf);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      };

      // GET: 多预设 doc + 作用域状态
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/state",
        handler: async (req, res) => {
          if (req.method !== "GET") { res.writeHead(405, { allow: "GET" }); res.end(); return; }
          try {
            const doc = core.loadMultiPreset();
            json(res, 200, { ok: true, doc, scopedPresets: cfg.scopedPresets, dshHome: core.findDshHome() });
          } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
        },
      }, "dsh-preset-plus: state");

      // POST: 保存整份多预设 doc（设置页用它持久化当前编辑态）
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/save",
        handler: async (req, res) => {
          if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
          try {
            const body = await readBody(req);
            const doc = body?.doc && typeof body.doc === "object" ? body.doc : {};
            const saved = await core.saveMultiPreset(doc);
            json(res, 200, { ok: true, doc: saved });
          } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
        },
      }, "dsh-preset-plus: save");

      // GET: 导出单个预设 / 导出全部（?all=1 导出全部）
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/export",
        handler: async (req, res) => {
          if (req.method !== "GET") { res.writeHead(405, { allow: "GET" }); res.end(); return; }
          try {
            const doc = core.loadMultiPreset();
            const url = req.url || "";
            const params = new URL(url, "http://x").searchParams;
            const isAll = params.get("all") === "1";
            if (isAll) {
              const raw = JSON.stringify(core.exportMultiPreset(doc), null, 2);
              res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="preset-plus-all.json"` });
              res.end(raw);
              return;
            }
            const id = params.get("id") || doc.activePresetId;
            const single = core.exportSinglePreset(doc, id);
            if (!single) { json(res, 404, { ok: false, error: "预设不存在: " + id }); return; }
            const raw = JSON.stringify(single, null, 2);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="preset-plus-${encodeURIComponent(single.name || id)}.json"` });
            res.end(raw);
          } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
        },
      }, "dsh-preset-plus: export");

      // POST: 导入（单条结构 或 多条结构，自动判断）
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/import",
        handler: async (req, res) => {
          if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
          try {
            const body = await readBody(req);
            let parsed;
            if (typeof body?.raw === "string") parsed = JSON.parse(body.raw);
            else if (body?.preset && typeof body.preset === "object") parsed = body.preset;
            else { json(res, 400, { ok: false, error: "需要 raw(JSON 文本) 或 preset(对象)" }); return; }
            const doc = core.loadMultiPreset();
            const updated = core.importPresetJson(doc, parsed);
            const saved = await core.saveMultiPreset(updated);
            json(res, 200, { ok: true, doc: saved });
          } catch (e) { json(res, 500, { ok: false, error: "导入失败: " + String(e) }); }
        },
      }, "dsh-preset-plus: import");

      // POST: 手动 /prefill
      host.webServer.register({
        kind: "exact",
        path: "/dsh-preset-plus/prefill",
        handler: async (req, res) => {
          if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
          try {
            const body = await readBody(req);
            const sessionId = body?.sessionId;
            if (typeof sessionId !== "string" || sessionId === "") { json(res, 400, { ok: false, error: "sessionId required" }); return; }
            const r = injector.prefill(sessionId);
            json(res, r.ok ? 200 : 409, r);
          } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
        },
      }, "dsh-preset-plus: prefill");
    }, "dsh-preset-plus: http routes");
  });
}

// ═══════════════════════════════════════════════════════════════════
//  命令 + 模型工具
// ═══════════════════════════════════════════════════════════════════

function renderPresetText(preset) {
  if (!preset) return "(无激活预设)";
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

  const commands = ctx.get?.("commands");
  if (commands) {
    commands.register({
      name: "preset-plus",
      description: "预设增强（status/prefill/on/off/save/list/activate）",
      input: { hint: "status | prefill | on | off | save | list | activate <id>" },
      handler: async (invocation) => {
        const args = (invocation.rawInput ?? "").trim().split(/\s+/).filter(Boolean);
        const sub = (args[0] || "status").toLowerCase();
        const sessionId = invocation.agent?.id;
        switch (sub) {
          case "status":
          case "s": {
            const active = core.loadActivePreset();
            const doc = core.loadMultiPreset();
            return {
              kind: "success",
              text: renderPresetText(active) + `\n\n激活预设: ${doc.activePresetId}\n可预设: ${Object.keys(doc.presets).join(", ") || "(无)"}\n作用域: ${(cfg.scopedPresets || []).join(", ") || "(空=关闭)"}\n本会话是否已注入: ${injector.isInjected(sessionId) ? "是" : "否"}`,
            };
          }
          case "prefill":
          case "p": {
            const r = injector.prefill(sessionId);
            return r.ok
              ? { kind: "success", text: "已标记本会话待注入破限伪装上下文（下一条消息生效）。" }
              : { kind: "error", text: "无法预填充: " + r.reason + "（当前会话未命中作用域）" };
          }
          case "on": {
            const doc = core.loadMultiPreset();
            const preset = doc.presets[doc.activePresetId];
            if (preset) { preset.autoMode = true; await core.saveMultiPreset({ ...doc, presets: { ...doc.presets, [preset.id]: { ...preset, autoMode: true } } }); return { kind: "success", text: "已开启自动注入。" }; }
            return { kind: "error", text: "无激活预设。" };
          }
          case "off": {
            const doc = core.loadMultiPreset();
            const preset = doc.presets[doc.activePresetId];
            if (preset) { await core.saveMultiPreset({ ...doc, presets: { ...doc.presets, [preset.id]: { ...preset, autoMode: false } } }); return { kind: "success", text: "已关闭自动注入（手动 /prefill 仍可用）。" }; }
            return { kind: "error", text: "无激活预设。" };
          }
          case "save": {
            const active = core.loadActivePreset();
            return { kind: "success", text: "当前预设:\n" + renderPresetText(active) };
          }
          case "list":
          case "l": {
            const doc = core.loadMultiPreset();
            const lines = Object.entries(doc.presets).map(([id, p]) => `  ${id === doc.activePresetId ? "●" : "○"} ${id} — ${p.name}`);
            return { kind: "success", text: "预设列表:\n" + lines.join("\n") + "\n激活: " + doc.activePresetId + "\n用法: /preset-plus activate <id>" };
          }
          case "activate":
          case "a": {
            const id = args[1];
            if (!id) return { kind: "error", text: "用法: /preset-plus activate <id>" };
            const doc = core.loadMultiPreset();
            if (!doc.presets[id]) return { kind: "error", text: "预设不存在: " + id };
            await core.saveMultiPreset(core.activatePreset(doc, id));
            injector.reset(sessionId);
            return { kind: "success", text: "已激活预设: " + id + "（下一条消息生效）" };
          }
          default:
            return { kind: "success", text: "dsh-preset-plus 命令: status | prefill | on | off | save | list | activate <id>" };
        }
      },
    });
  }

  if (ctx.tools) {
    ctx.tools.register({
      name: "preset_plus_status",
      description: "查看 dsh-preset-plus 预设列表、激活预设、作用域与注入状态。",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      output: { schema: { type: "object", additionalProperties: false, properties: { text: { type: "string" } } }, render: (_a, v) => [{ type: "text", text: String(v?.text ?? "") }] },
      async execute() {
        const doc = core.loadMultiPreset();
        const active = core.loadActivePreset();
        const list = Object.entries(doc.presets).map(([id, p]) => `  ${id === doc.activePresetId ? "●" : "○"} ${id} — ${p.name}`).join("\n");
        return { text: `激活预设: ${doc.activePresetId}\n预设列表:\n${list}\n作用域: ${(cfg.scopedPresets || []).join(", ") || "(空)"}` };
      },
    });
  }
}
