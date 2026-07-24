#!/usr/bin/env node
// Generated from settings/cli.mjs. Do not edit.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { label, loadLocale, normalizeLocale } from "../locales/index.mjs";
import {
  THEMES,
  readSettings,
  resetSettings,
  resolveSettings,
  updateSettings,
} from "./index.mjs";

function usage() {
  return [
    "Manage global Hope settings.",
    "",
    "Usage:",
    "  hope settings show",
    "  hope settings set locale <ko-KR|en-US>",
    "  hope settings set theme <system|light|dark>",
    "  hope settings reset",
  ].join("\n");
}

export function parseSettingsArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }
  const [command, key, value, ...extra] = argv;
  if (extra.length > 0) throw new TypeError(usage());
  if (command === "show" && key === undefined) return { command };
  if (command === "reset" && key === undefined) return { command };
  if (command === "set" && key === "locale" && normalizeLocale(value)) {
    return { command, key, value: normalizeLocale(value) };
  }
  if (command === "set" && key === "theme" && THEMES.includes(value)) {
    return { command, key, value };
  }
  throw new TypeError(usage());
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseSettingsArguments(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  const io = dependencies.io ?? {};
  if (options.command === "help") {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (options.command === "reset") {
    const result = await resetSettings(io);
    const resolved = await resolveSettings(io);
    const dictionary = await loadLocale(resolved.locale, ["common"]);
    stdout.write(`${label(dictionary, "settings.reset")}\n${result.path}\n`);
    return result;
  }
  if (options.command === "set") {
    const result = await updateSettings({ [options.key]: options.value }, io);
    const resolved = await resolveSettings(io);
    const dictionary = await loadLocale(resolved.locale, ["common"]);
    stdout.write(`${label(dictionary, "settings.saved")}\n${result.path}\n`);
    return result;
  }

  const resolved = await resolveSettings(io);
  const saved = await readSettings(io);
  const dictionary = await loadLocale(resolved.locale, ["common"]);
  stdout.write([
    label(dictionary, "settings.current"),
    `${label(dictionary, "settings.locale")}: ${resolved.locale}`,
    `${label(dictionary, "settings.localeSource")}: ${label(dictionary, `source.${resolved.localeSource}`)}`,
    `${label(dictionary, "settings.theme")}: ${label(dictionary, `theme.${resolved.theme}`)}`,
    `${label(dictionary, "settings.themeSource")}: ${label(dictionary, `source.${resolved.themeSource}`)}`,
    saved.path,
    "",
  ].join("\n"));
  return resolved;
}

const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`hope settings: ${error.message}\n`);
    process.exitCode = 1;
  });
}
