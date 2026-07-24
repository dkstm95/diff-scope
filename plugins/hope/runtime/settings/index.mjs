// Generated from settings/index.mjs. Do not edit.
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { normalizeLocale } from "../locales/index.mjs";

export const SETTINGS_SCHEMA_VERSION = 1;
export const THEMES = Object.freeze(["system", "light", "dark"]);

const DEFAULTS = Object.freeze({
  locale: undefined,
  theme: "system",
});

function settingsDirectory({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (env.HOPE_CONFIG_HOME) return resolve(env.HOPE_CONFIG_HOME);
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Hope");
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "Hope");
  }
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "hope");
}

export function settingsPath(options) {
  return join(settingsDirectory(options), "config.json");
}

function assertSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hope settings must be an object");
  }
  const allowed = new Set(["schemaVersion", "locale", "theme"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown Hope setting: ${key}`);
  }
  if (value.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new RangeError(
      `Unsupported Hope settings schema: ${String(value.schemaVersion)}`,
    );
  }
  if (normalizeLocale(value.locale) !== value.locale) {
    throw new RangeError(`Unsupported Hope locale: ${String(value.locale)}`);
  }
  if (!THEMES.includes(value.theme)) {
    throw new RangeError(`Unsupported Hope theme: ${String(value.theme)}`);
  }
  return Object.freeze({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    locale: value.locale,
    theme: value.theme,
  });
}

async function readRegularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Hope settings are not a regular file: ${path}`);
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(`Hope settings permissions are too open: ${path}`);
  }
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== info.dev
      || opened.ino !== info.ino
      || opened.size !== info.size
    ) {
      throw new Error(`Hope settings changed while being opened: ${path}`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function readSettings(options = {}) {
  const path = settingsPath(options);
  try {
    return {
      path,
      settings: assertSettings(JSON.parse(await readRegularFile(path))),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, settings: undefined };
    if (error instanceof SyntaxError) {
      throw new Error(`Hope settings are not valid JSON: ${path}`, { cause: error });
    }
    throw error;
  }
}

function systemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export async function resolveSettings({
  hostLocale,
  locale,
  theme,
  ...pathOptions
} = {}) {
  const saved = await readSettings(pathOptions);
  const explicitLocale = locale === undefined ? undefined : normalizeLocale(locale);
  if (locale !== undefined && !explicitLocale) {
    throw new RangeError(`Unsupported Hope locale: ${String(locale)}`);
  }
  if (theme !== undefined && !THEMES.includes(theme)) {
    throw new RangeError(`Unsupported Hope theme: ${String(theme)}`);
  }

  const host = normalizeLocale(hostLocale);
  const operatingSystem = normalizeLocale(systemLocale());
  const resolvedLocale = explicitLocale
    ?? saved.settings?.locale
    ?? host
    ?? operatingSystem
    ?? "en-US";
  const localeSource = explicitLocale
    ? "override"
    : saved.settings?.locale
      ? "saved"
      : host
        ? "host"
        : operatingSystem
          ? "system"
          : "default";
  const resolvedTheme = theme ?? saved.settings?.theme ?? DEFAULTS.theme;
  const themeSource = theme
    ? "override"
    : saved.settings?.theme
      ? "saved"
      : "default";

  return Object.freeze({
    locale: resolvedLocale,
    localeSource,
    path: saved.path,
    theme: resolvedTheme,
    themeSource,
  });
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Hope settings directory is not a regular directory: ${path}`);
  }
  if (process.platform !== "win32") await chmod(path, 0o700);
}

export async function writeSettings(settings, options = {}) {
  const value = assertSettings({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    ...settings,
  });
  const path = settingsPath(options);
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);

  try {
    const current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error(`Hope settings are not a regular file: ${path}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = join(
    directory,
    `.config.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { path, settings: value };
}

export async function updateSettings(changes, options = {}) {
  const current = await readSettings(options);
  const value = {
    theme: current.settings?.theme ?? "system",
    ...(current.settings?.locale ? { locale: current.settings.locale } : {}),
    ...changes,
  };
  return await writeSettings(value, options);
}

export async function resetSettings(options = {}) {
  const path = settingsPath(options);
  const directory = dirname(path);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Hope settings directory is not a regular directory: ${directory}`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { path, removed: false };
    throw error;
  }
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Hope settings are not a regular file: ${path}`);
    }
    await unlink(path);
    return { path, removed: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, removed: false };
    throw error;
  }
}
