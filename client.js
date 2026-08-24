// dsh-preset-plus client bundle: a "预设增强" settings section with a 酒馆式 preset editor.
// Hand-written __ModuleLoader__ factory (no build step), mirroring dsh-purge/client.js.
window.__ModuleLoader__.load({ id: "dsh-preset-plus", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	let react = require("react");
	const h = react.createElement;
	const { useState, useEffect, useCallback } = react;

	const name = "dsh-preset-plus";
	const inject = ["slots"];

	const PACKET_STYLE = { maxWidth: "820px", display: "flex", flexDirection: "column", gap: "12px" };
	const ROW_STYLE = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
	const BTN = (bg) => ({
		padding: "5px 14px", borderRadius: "6px", border: "none",
		cursor: "pointer", fontSize: "13px", background: bg, color: "#fff",
	});
	const BTN_GHOST = {
		padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.4)",
		cursor: "pointer", fontSize: "12px", background: "transparent", color: "inherit",
	};
	const INPUT_STYLE = {
		flex: "1", padding: "6px 8px", fontSize: "13px", boxSizing: "border-box",
		background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.35)", borderRadius: "6px",
	};
	const TEXTAREA_STYLE = {
		width: "100%", minHeight: "90px", boxSizing: "border-box",
		fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
		fontSize: "12px", lineHeight: 1.5, padding: "8px", resize: "vertical",
		background: "transparent", color: "inherit",
		border: "1px solid rgba(128,128,128,0.35)", borderRadius: "6px",
	};
	const CARD_STYLE = {
		border: "1px solid rgba(128,128,128,0.3)", borderRadius: "8px",
		padding: "10px", display: "flex", flexDirection: "column", gap: "6px",
	};
	const SELECT_STYLE = { padding: "5px 8px", fontSize: "13px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit" };

	const ROLES = ["system", "user", "assistant"];
	const VALID_ROLE_MAP = { system: "system", user: "user", assistant: "assistant" };

	function PresetEditor() {
		const [preset, setPreset] = useState(null);
		const [meta, setMeta] = useState(null);
		const [notice, setNotice] = useState({ kind: "idle", text: "" });
		const [busy, setBusy] = useState(false);

		const loadState = useCallback(() => {
			fetch("/dsh-preset-plus/state", { cache: "no-store" })
				.then((r) => r.json())
				.then((d) => {
					if (d.ok) { setPreset(d.preset); setMeta(d); }
					else setNotice({ kind: "error", text: "读取失败: " + (d.error || "") });
				})
				.catch((e) => setNotice({ kind: "error", text: "读取失败: " + e.message }));
		}, []);
		useEffect(() => { loadState(); }, [loadState]);

		const save = useCallback((next) => {
			setBusy(true);
			setNotice({ kind: "idle", text: "" });
			fetch("/dsh-preset-plus/save", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ preset: next }),
			})
				.then((r) => r.json())
				.then((d) => {
					if (d.ok) { setPreset(d.preset); setNotice({ kind: "ok", text: "已保存。新会话生效。" }); }
					else setNotice({ kind: "error", text: "保存失败: " + (d.error || "") });
				})
				.catch((e) => setNotice({ kind: "error", text: "保存失败: " + e.message }))
				.finally(() => setBusy(false));
		}, []);

		const exportPreset = useCallback(() => {
			if (!preset) return;
			const raw = JSON.stringify(preset, null, 2);
			try {
				// 浏览器下载
				const blob = new Blob([raw], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "preset-plus-" + (preset.name || "preset") + ".json";
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				setNotice({ kind: "ok", text: "已导出为 JSON 文件。" });
			} catch (e) {
				setNotice({ kind: "error", text: "导出失败: " + (e.message || String(e)) });
			}
		}, [preset]);

		const importPreset = useCallback(() => {
			const text = window.prompt("粘贴要导入的 JSON 预设文本：", "");
			if (text === null) return;
			if (text.trim() === "") { setNotice({ kind: "error", text: "导入内容为空。" }); return; }
			setBusy(true);
			setNotice({ kind: "idle", text: "" });
			fetch("/dsh-preset-plus/import", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ raw: text }),
			})
				.then((r) => r.json())
				.then((d) => {
					if (d.ok) { setPreset(d.preset); setNotice({ kind: "ok", text: "已导入并保存。" }); }
					else setNotice({ kind: "error", text: "导入失败: " + (d.error || "") });
				})
				.catch((e) => setNotice({ kind: "error", text: "导入失败: " + e.message }))
				.finally(() => setBusy(false));
		}, []);

		const updateEntry = useCallback((idx, patch) => {
			setPreset((p) => {
				const entries = p.entries.map((e, i) => i === idx ? { ...e, ...patch } : e);
				return { ...p, entries };
			});
		}, []);

		const addEntry = useCallback(() => {
			setPreset((p) => {
				const role = p.entries.length === 0 ? "system" : "assistant";
				return { ...p, entries: [...p.entries, { role, text: "" }] };
			});
		}, []);

		const removeEntry = useCallback((idx) => {
			setPreset((p) => ({ ...p, entries: p.entries.filter((_, i) => i !== idx) }));
		}, []);

		const moveEntry = useCallback((idx, dir) => {
			setPreset((p) => {
				const j = idx + dir;
				if (j < 0 || j >= p.entries.length) return p;
				const entries = [...p.entries];
				const t = entries[idx]; entries[idx] = entries[j]; entries[j] = t;
				return { ...p, entries };
			});
		}, []);

		const firstRoleIsSystem = preset && preset.entries[0]?.role === "system";

		return h("div", { style: PACKET_STYLE },
			h("p", { style: { marginTop: 0, opacity: 0.75, fontSize: "13px" } },
				"dsh-preset-plus · 破限预设编辑器。第一条必须是 system（主提示词）；后续条目作为 user / assistant 破限增强与伪装输出。仅在命中作用域的 preset 下生效。"),
			!preset ? h("p", { style: { opacity: 0.6 } }, "加载中…")
				: h("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } },

					// 全局：预设名 + 自动注入开关
					h("div", { style: ROW_STYLE },
						h("span", { style: { fontSize: "13px", opacity: 0.8 } }, "预设名:"),
						h("input", { style: Object.assign({ maxWidth: "160px" }, INPUT_STYLE), value: preset.name, onChange: (e) => setPreset({ ...preset, name: e.target.value }) }),
						h("label", { style: { fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" } },
							h("input", { type: "checkbox", checked: preset.autoMode, onChange: (e) => setPreset({ ...preset, autoMode: e.target.checked }) }),
							"自动注入"),
						h("span", { style: { fontSize: "12px", opacity: 0.7 } },
							"作用域: " + ((meta && meta.scopedPresets) || []).join(", ") || "(空=关闭)"),
					),

					// 第一条必须是 system 的提示
					firstRoleIsSystem ? null
						: h("div", { style: { fontSize: "12px", color: "#e5a50a" } },
							"⚠ 第一条必须是 system（主提示词）。请调整或点击下方重置。"),

					// 条目列表
					preset.entries.map((entry, i) => h("div", { key: i, style: CARD_STYLE },
						h("div", { style: ROW_STYLE },
							h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "#" + (i + 1)),
							h("select", { style: SELECT_STYLE, value: entry.role, onChange: (e) => updateEntry(i, { role: e.target.value }) },
								ROLES.map((r) => h("option", { key: r, value: r }, r === "system" ? "system（主提示词）" : r))),
							h("button", { style: BTN_GHOST, onClick: () => moveEntry(i, -1), title: "上移" }, "↑"),
							h("button", { style: BTN_GHOST, onClick: () => moveEntry(i, 1), title: "下移" }, "↓"),
							h("button", { style: Object.assign({}, BTN_GHOST, { borderColor: "rgba(229,72,77,0.5)", color: "#e5484d" }), onClick: () => removeEntry(i) }, "删除"),
						),
						h("textarea", {
							style: TEXTAREA_STYLE, value: entry.text,
							onChange: (e) => updateEntry(i, { text: e.target.value }),
							spellCheck: false,
							placeholder: entry.role === "system" ? "主提示词（例如 JailbreakPrompt）" : entry.role === "user" ? "破限增强/触发（以 user 注入）" : "伪装模型输出（assistant 预填充种子）",
						}),
					)),

					// 底部操作
					h("div", { style: ROW_STYLE },
						h("button", { style: BTN("var(--accent, #2f81f7)"), onClick: addEntry }, "+ 新增条目"),
						h("button", { style: Object.assign({ opacity: busy || !preset ? 0.6 : 1 }, BTN("var(--accent, #2f81f7)")), disabled: busy || !preset, onClick: () => save(preset) }, "保存"),
						h("button", { style: BTN_GHOST, onClick: exportPreset }, "导出"),
						h("button", { style: BTN_GHOST, onClick: importPreset }, "导入"),
						h("button", { style: BTN_GHOST, onClick: loadState }, "重置"),
						notice.kind === "ok" ? h("span", { style: { fontSize: "13px", opacity: 0.85 } }, notice.text)
							: notice.kind === "error" ? h("span", { style: { fontSize: "13px", color: "#e5484d" } }, notice.text)
							: null,
					),
				),
		);
	}

	function apply(ctx) {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "dsh-preset-plus",
			order: 42,
			label: () => "预设增强",
		}, () => h(PresetEditor, null)));
	}

	exports.name = name;
	exports.inject = inject;
	exports.apply = apply;
	return module.exports;
}
});
