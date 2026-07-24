import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readSettings,
  resetSettings,
  resolveSettings,
  settingsPath,
  updateSettings,
} from "../settings/index.mjs";
import { main as runSettings } from "../settings/cli.mjs";

test("settings resolve explicit, saved, host, and fallback values in order", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-test-"));
  const io = { env: { HOPE_CONFIG_HOME: root } };
  context.after(async () => await resetSettings(io));

  const host = await resolveSettings({ ...io, hostLocale: "ko" });
  assert.equal(host.locale, "ko-KR");
  assert.equal(host.localeSource, "host");

  await updateSettings({ locale: "en-US", theme: "dark" }, io);
  const saved = await resolveSettings({ ...io, hostLocale: "ko-KR" });
  assert.equal(saved.locale, "en-US");
  assert.equal(saved.localeSource, "saved");
  assert.equal(saved.theme, "dark");

  const override = await resolveSettings({
    ...io,
    locale: "ko-KR",
    theme: "light",
  });
  assert.equal(override.locale, "ko-KR");
  assert.equal(override.localeSource, "override");
  assert.equal(override.theme, "light");
});

test("settings writes a private regular file and rejects a symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-link-"));
  const io = { env: { HOPE_CONFIG_HOME: root } };
  const path = settingsPath(io);
  context.after(async () => await resetSettings(io).catch(() => {}));

  await updateSettings({ locale: "ko-KR", theme: "system" }, io);
  const info = await lstat(path);
  assert.equal(info.isFile(), true);
  if (process.platform !== "win32") assert.equal(info.mode & 0o077, 0);

  await resetSettings(io);
  const target = join(root, "other.json");
  await writeFile(target, "{}\n", { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(readSettings(io), /regular file/u);
});

test("changing only the theme does not freeze the current system language", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-theme-"));
  const io = { env: { HOPE_CONFIG_HOME: root } };
  context.after(async () => await resetSettings(io));

  await updateSettings({ theme: "dark" }, io);
  const stored = await readSettings(io);
  assert.equal(stored.settings.locale, undefined);
  assert.equal(stored.settings.theme, "dark");

  const resolved = await resolveSettings({ ...io, hostLocale: "ko-KR" });
  assert.equal(resolved.locale, "ko-KR");
  assert.equal(resolved.localeSource, "host");
  assert.equal(resolved.theme, "dark");
});

test("the settings command can save a theme before a locale is chosen", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-theme-cli-"));
  const io = {
    env: { HOPE_CONFIG_HOME: root },
    hostLocale: "en-US",
  };
  context.after(async () => await resetSettings(io));
  let output = "";

  await runSettings(["set", "theme", "dark"], {
    io,
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  const stored = await readSettings(io);
  assert.equal(stored.settings.locale, undefined);
  assert.equal(stored.settings.theme, "dark");
  assert.match(output, /Saved Hope settings/u);
});

test("settings rejects malformed, unknown, and overly open files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-invalid-"));
  const io = { env: { HOPE_CONFIG_HOME: root } };
  const path = settingsPath(io);
  await writeFile(path, '{"schemaVersion":1,"locale":"en-US","theme":"system","extra":1}\n', {
    mode: 0o600,
  });
  await assert.rejects(readSettings(io), /unknown Hope setting/iu);
  if (process.platform !== "win32") {
    await writeFile(path, '{"schemaVersion":1,"locale":"en-US","theme":"system"}\n');
    await chmod(path, 0o644);
    await assert.rejects(readSettings(io), /permissions are too open/u);
  }
});

test("the settings command can reset a malformed file", async () => {
  const root = await mkdtemp(join(tmpdir(), "hope-settings-reset-"));
  const io = { env: { HOPE_CONFIG_HOME: root } };
  const path = settingsPath(io);
  await writeFile(path, "{broken", { mode: 0o600 });
  let output = "";

  const result = await runSettings(["reset"], {
    io,
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(result.removed, true);
  assert.match(output, /Hope settings|Hope 설정/u);
  await assert.rejects(lstat(path), /ENOENT/u);
});
