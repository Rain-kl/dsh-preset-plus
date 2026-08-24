#!/usr/bin/env node
import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "preset");
const home = process.env.DSH_HOME?.trim() || join(os.homedir(), ".dsh");
const target = join(home, ".agent-presets", "preset-plus");

await mkdir(dirname(target), { recursive: true });
if (!existsSync(join(target, "agent.cordis.yml"))) {
  await cp(source, target, { recursive: true, force: false });
  console.log(`[dsh-preset-plus] PresetPlus mode ready: ${target}`);
} else {
  console.log(`[dsh-preset-plus] PresetPlus mode already exists; keeping user configuration: ${target}`);
}
const metadata = join(target, "preset.yml");
const text = await readFile(metadata, "utf8");
if (!text.includes("name: PresetPlus") || !text.includes("description: PresetPlus模式。可动态应用不同的预设。")) {
  throw new Error("PresetPlus metadata is incomplete");
}
console.log(`[dsh-preset-plus] PresetPlus mode ready: ${target}`);
