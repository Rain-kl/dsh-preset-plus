// dsh-preset-plus client bundle: 多预设编辑器设置页（酒馆式）。
// 预设列表（选择/激活/新增/删除） + 当前预设条目编辑（system/user/assistant）。
// 支持：导出单个预设、导出全部、导入（单条结构自动并入，多条结构合并）。
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

	const PACKET_STYLE = { maxWidth: "860px", display: "flex", flexDirection: "column", gap: "12px" };
	const ROW_STYLE = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
	const BTN = (bg) => ({ padding: "5px 14px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "13px", background: bg, color: "#fff" });
	const BTN_GHOST = { padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.4)", cursor: "pointer", fontSize: "12px", background: "transparent", color: "inherit" };
	const INPUT_STYLE = { flex: "1", padding: "6px 8px", fontSize: "13px", boxSizing: "border-box", background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.35)", borderRadius: "6px" };
	const TEXTAREA_STYLE = { width: "100%", minHeight: "90px", boxSizing: "border-box", fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: "12px", lineHeight: 1.5, padding: "8px", resize: "vertical", background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.35)", borderRadius: "6px" };
	const CARD_STYLE = { border: "1px solid rgba(128,128,128,0.3)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" };
	const SELECT_STYLE = { padding: "5px 8px", fontSize: "13px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit" };
	const LIST_STYLE = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", marginBottom: "4px" };
	const LIST_ITEM = { display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.25)", cursor: "pointer" };

	const ROLES = ["system", "user", "assistant"];

	function PresetEditor() {
		const [doc, setDoc] = useState(null);
		const [meta, setMeta] = useState(null);
		const [selectedId, setSelectedId] = useState(null);
		const [notice, setNotice] = useState({ kind: "idle", text: "" });
		const [busy, setBusy] = useState(false);

		const loadState = useCallback(() => {
			fetch("/dsh-preset-plus/state", { cache: "no-store" }).then((r) => r.json()).then((d) => {
				if (d.ok) {
					setDoc(d.doc);
					setMeta(d);
					setSelectedId(d.doc.presets[selectedId] ? selectedId : d.doc.activePresetId);
				} else {
					setNotice({ kind: "error", text: "读取失败: " + (d.error || "") });
				}
			}).catch((e) => setNotice({ kind: "error", text: "读取失败: " + e.message }));
		}, [selectedId]);

		useEffect(() => { loadState(); }, []);

		const persist = useCallback((nextDoc, okText) => {
			setBusy(true);
			setNotice({ kind: "idle", text: "" });
			fetch("/dsh-preset-plus/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc: nextDoc }) })
				.then((r) => r.json()).then((d) => {
					if (d.ok) { setDoc(d.doc); setNotice({ kind: "ok", text: okText || "已保存。新会话生效。" }); }
					else { setNotice({ kind: "error", text: "保存失败: " + (d.error || "") }); }
				}).catch((e) => setNotice({ kind: "error", text: "保存失败: " + e.message })).finally(() => setBusy(false));
		}, []);

		const current = doc && doc.presets[selectedId];

		const patchPreset = useCallback((patch) => {
			setDoc((d) => {
				const p = d.presets[selectedId];
				if (!p) return d;
				return { ...d, presets: { ...d.presets, [selectedId]: { ...p, ...patch } } };
			});
		}, [selectedId]);

		const patchEntry = useCallback((idx, patch) => {
			setDoc((d) => {
				const p = d.presets[selectedId];
				if (!p) return d;
				const entries = p.entries.map((e, i) => i === idx ? { ...e, ...patch } : e);
				return { ...d, presets: { ...d.presets, [selectedId]: { ...p, entries } } };
			});
		}, [selectedId]);

		const addEntry = useCallback(() => {
			setDoc((d) => {
				const p = d.presets[selectedId];
				if (!p) return d;
				const role = p.entries.length === 0 ? "system" : "assistant";
				return { ...d, presets: { ...d.presets, [selectedId]: { ...p, entries: [...p.entries, { role, text: "" }] } } };
			});
		}, [selectedId]);

		const removeEntry = useCallback((idx) => {
			setDoc((d) => {
				const p = d.presets[selectedId];
				if (!p) return d;
				return { ...d, presets: { ...d.presets, [selectedId]: { ...p, entries: p.entries.filter((x, i) => i !== idx) } } };
			});
		}, [selectedId]);

		const moveEntry = useCallback((idx, dir) => {
			setDoc((d) => {
				const p = d.presets[selectedId];
				if (!p) return d;
				const j = idx + dir;
				if (j < 0 || j >= p.entries.length) return d;
				const entries = [...p.entries];
				const t = entries[idx];
				entries[idx] = entries[j];
				entries[j] = t;
				return { ...d, presets: { ...d.presets, [selectedId]: { ...p, entries } } };
			});
		}, [selectedId]);

		const addPreset = useCallback(() => {
			const id = window.prompt("新预设 id（小写/数字/连字符）：", "preset");
			if (id === null) return;
			const key = id.trim().replace(/\s+/g, "-");
			if (!key) return;
			setDoc((d) => {
				if (d.presets[key]) { setNotice({ kind: "error", text: "预设已存在: " + key }); return d; }
				setSelectedId(key);
				return { ...d, presets: { ...d.presets, [key]: { id: key, name: key, autoMode: true, entries: [{ role: "system", text: "" }, { role: "user", text: "" }, { role: "assistant", text: "" }] } } };
			});
		}, []);

		const activate = useCallback((id) => {
			setDoc((d) => ({ ...d, activePresetId: id }));
			setSelectedId(id);
		}, []);

		const removePreset = useCallback((id) => {
			if (!window.confirm("删除预设 " + id + "？")) return;
			setDoc((d) => {
				const presets = { ...d.presets };
				delete presets[id];
				let active = d.activePresetId;
				if (active === id || !presets[active]) active = Object.keys(presets)[0] || "";
				if (selectedId === id) setSelectedId(active || "");
				return { ...d, activePresetId: active, presets };
			});
		}, [selectedId]);

		const exportSingle = useCallback(() => {
			if (!current) return;
			const raw = JSON.stringify({ id: current.id, name: current.name, autoMode: current.autoMode, entries: current.entries }, null, 2);
			downloadJson(raw, "preset-plus-" + (current.name || current.id) + ".json", setNotice);
		}, [current]);

		const exportAll = useCallback(() => {
			const raw = JSON.stringify({ version: (doc && doc.version) || 1, activePresetId: doc && doc.activePresetId, presets: doc && doc.presets }, null, 2);
			downloadJson(raw, "preset-plus-all.json", setNotice);
		}, [doc]);

		const importPreset = useCallback(() => {
			const text = window.prompt("粘贴要导入的 JSON（单条预设 或 导出全部的多条结构）：", "");
			if (text === null) return;
			if (text.trim() === "") { setNotice({ kind: "error", text: "导入内容为空。" }); return; }
			setBusy(true);
			setNotice({ kind: "idle", text: "" });
			fetch("/dsh-preset-plus/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw: text }) })
				.then((r) => r.json()).then((d) => {
					if (d.ok) { setDoc(d.doc); setSelectedId(d.doc.activePresetId); setNotice({ kind: "ok", text: "已导入并保存。" }); }
					else { setNotice({ kind: "error", text: "导入失败: " + (d.error || "") }); }
				}).catch((e) => setNotice({ kind: "error", text: "导入失败: " + e.message })).finally(() => setBusy(false));
		}, []);

		// render
		const listed = doc ? Object.values(doc.presets) : [];
		const isActive = (id) => id === (doc && doc.activePresetId);

		return h("div", { style: PACKET_STYLE },
			h("p", { style: { marginTop: 0, opacity: 0.75, fontSize: "13px" } },
				"dsh-preset-plus · 多预设编辑器。一个模式（preset-plus）对应多套预设，激活一套即生效。"),
			!doc ? h("p", { style: { opacity: 0.6 } }, "加载中…")
				: h("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } },

					h("div", { style: LIST_STYLE },
						listed.map((p) =>
							h("div", { key: p.id, style: { display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderRadius: "6px", border: "1px solid rgba(128,128,128,0.25)", cursor: "pointer", background: isActive(p.id) ? "rgba(47,129,247,0.15)" : "transparent" }, onClick: () => activate(p.id) },
								h("span", { style: { fontWeight: isActive(p.id) ? 700 : 400 } }, (isActive(p.id) ? "● " : "○ ") + p.id),
								h("span", { style: { opacity: 0.75 } }, p.name),
								h("span", { style: { marginLeft: "auto", fontSize: "11px", opacity: 0.6 } }, p.entries.length + " 条"),
							)),
						h("div", { style: ROW_STYLE },
							h("button", { style: BTN_GHOST, onClick: addPreset }, "+ 新增预设"),
							h("button", { style: BTN_GHOST, onClick: exportAll }, "导出全部"),
							h("button", { style: BTN_GHOST, onClick: importPreset }, "导入"),
							h("button", { style: { padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(229,72,77,0.5)", cursor: "pointer", fontSize: "12px", background: "transparent", color: "#e5484d" }, onClick: () => removePreset(selectedId) }, "删除当前预设"),
							notice.kind === "ok" ? h("span", { style: { fontSize: "13px", opacity: 0.85 } }, notice.text)
								: notice.kind === "error" ? h("span", { style: { fontSize: "13px", color: "#e5484d" } }, notice.text)
								: null,
						),
					),

					!current ? h("p", { style: { opacity: 0.6 } }, "无选中预设")
						: h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
							h("div", { style: ROW_STYLE },
								h("span", { style: { fontSize: "13px", opacity: 0.8 } }, "名称:"),
								h("input", { style: Object.assign({ maxWidth: "160px" }, INPUT_STYLE), value: current.name, onChange: (e) => patchPreset({ name: e.target.value }) }),
								h("label", { style: { fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" } },
									h("input", { type: "checkbox", checked: current.autoMode, onChange: (e) => patchPreset({ autoMode: e.target.checked }) }),
									"自动注入"),
								h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "作用域: " + ((meta && meta.scopedPresets) ? meta.scopedPresets.join(", ") : "(空=关闭)")),
								h("button", { style: Object.assign({ opacity: busy ? 0.6 : 1 }, BTN("var(--accent, #2f81f7)")), disabled: busy, onClick: () => persist(doc, "已保存。新会话生效。") }, "保存"),
								h("button", { style: BTN_GHOST, onClick: exportSingle }, "导出当前"),
							),

							current.entries[0] && current.entries[0].role !== "system"
								? h("div", { style: { fontSize: "12px", color: "#e5a50a" } }, "⚠ 第一条必须是 system（主提示词）。")
								: null,

							current.entries.map((entry, i) =>
								h("div", { key: i, style: CARD_STYLE },
									h("div", { style: ROW_STYLE },
										h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "#" + (i + 1)),
										h("select", { style: SELECT_STYLE, value: entry.role, onChange: (e) => patchEntry(i, { role: e.target.value }) },
											ROLES.map((r) => h("option", { key: r, value: r }, r === "system" ? "system（主提示词）" : r))),
										h("button", { style: BTN_GHOST, onClick: () => moveEntry(i, -1) }, "↑"),
										h("button", { style: BTN_GHOST, onClick: () => moveEntry(i, 1) }, "↓"),
										h("button", { style: { padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(229,72,77,0.5)", cursor: "pointer", fontSize: "12px", background: "transparent", color: "#e5484d" }, onClick: () => removeEntry(i) }, "删除"),
									),
									h("textarea", { style: TEXTAREA_STYLE, value: entry.text, onChange: (e) => patchEntry(i, { text: e.target.value }), spellCheck: false, placeholder: entry.role === "system" ? "主提示词（例如 JailbreakPrompt）" : entry.role === "user" ? "破限增强/触发（以 user 注入）" : "伪装模型输出（assistant 预填充种子）" }),
								)),
							h("button", { style: BTN_GHOST, onClick: addEntry }, "+ 新增条目"),
						),
				),
		);
	}

	function downloadJson(raw, filename, setNotice) {
		try {
			const blob = new Blob([raw], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			setNotice({ kind: "ok", text: "已导出。" });
		} catch (e) {
			setNotice({ kind: "error", text: "导出失败: " + (e.message || String(e)) });
		}
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
