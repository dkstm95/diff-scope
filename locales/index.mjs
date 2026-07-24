import { readFile } from "node:fs/promises";

export const SUPPORTED_LOCALES = Object.freeze(["en-US", "ko-KR"]);

const localeRoot = new URL("./", import.meta.url);

function assertPlainDictionary(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  for (const [key, text] of Object.entries(value)) {
    if (!/^[a-z][a-zA-Z]*(?:-[a-zA-Z]+)*(?:\.[a-z][a-zA-Z]*(?:-[a-zA-Z]+)*)+$/u.test(key)) {
      throw new TypeError(`${name} has an invalid key: ${key}`);
    }
    if (typeof text !== "string" || text.length === 0) {
      throw new TypeError(`${name}.${key} must be a non-empty string`);
    }
  }
  return value;
}

async function readDictionary(locale, file) {
  const url = new URL(`./${locale}/${file}.json`, localeRoot);
  return assertPlainDictionary(
    JSON.parse(await readFile(url, "utf8")),
    `${locale}/${file}`,
  );
}

export function normalizeLocale(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko-KR";
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  return undefined;
}

export async function loadLocale(locale, files = ["common", "diff"]) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new RangeError(`Unsupported Hope locale: ${locale}`);
  }
  const dictionaries = await Promise.all(files.map(
    async (file) => await readDictionary(locale, file),
  ));
  return Object.freeze(Object.assign({}, ...dictionaries));
}

export async function checkLocaleParity(files = ["common", "diff"]) {
  const byLocale = new Map();
  for (const locale of SUPPORTED_LOCALES) {
    const dictionary = await loadLocale(locale, files);
    byLocale.set(locale, Object.keys(dictionary).sort());
  }
  const reference = byLocale.get(SUPPORTED_LOCALES[0]);
  for (const locale of SUPPORTED_LOCALES.slice(1)) {
    const keys = byLocale.get(locale);
    if (JSON.stringify(keys) !== JSON.stringify(reference)) {
      throw new Error(`Locale keys do not match for ${locale}`);
    }
  }
  return reference;
}

export function label(dictionary, key) {
  const value = dictionary[key];
  if (typeof value !== "string") throw new Error(`Missing locale key: ${key}`);
  return value;
}
