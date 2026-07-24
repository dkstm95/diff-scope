import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import wasm from "shiki/wasm";

import githubDark from "@shikijs/themes/github-dark-default";
import githubLight from "@shikijs/themes/github-light-default";

import bash from "@shikijs/langs/bash";
import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import dockerfile from "@shikijs/langs/dockerfile";
import go from "@shikijs/langs/go";
import htmlLanguage from "@shikijs/langs/html";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import markdown from "@shikijs/langs/markdown";
import mdx from "@shikijs/langs/mdx";
import php from "@shikijs/langs/php";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import scss from "@shikijs/langs/scss";
import sql from "@shikijs/langs/sql";
import swift from "@shikijs/langs/swift";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import vue from "@shikijs/langs/vue";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";

import { sha256 } from "./hash.mjs";
import { exposeBidiControls } from "./text.mjs";

const themes = Object.freeze({
  dark: "github-dark-default",
  light: "github-light-default",
});

const languages = Object.freeze([
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  htmlLanguage,
  java,
  javascript,
  json,
  jsonc,
  jsx,
  kotlin,
  markdown,
  mdx,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  tsx,
  typescript,
  vue,
  xml,
  yaml,
]);

const extensionLanguages = new Map(Object.entries({
  ".bash": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".csh": "bash",
  ".css": "css",
  ".cts": "typescript",
  ".cxx": "cpp",
  ".go": "go",
  ".h": "c",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".htm": "html",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mdx": "mdx",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "bash",
  ".sql": "sql",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "bash",
}));

const exactLanguages = new Map([
  [".bashrc", "bash"],
  [".zshrc", "bash"],
  ["dockerfile", "dockerfile"],
  ["gemfile", "ruby"],
]);

const warmLanguages = Object.freeze([
  ...new Set([
    ...extensionLanguages.values(),
    ...exactLanguages.values(),
    "diff",
  ]),
].sort());

let highlighterPromise;

function escapeHtml(value) {
  return exposeBidiControls(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function color(value) {
  return /^#[0-9a-f]{3,8}$/iu.test(value ?? "") ? value : undefined;
}

function declarations(variant) {
  const values = [];
  const foreground = color(variant?.color);
  if (foreground) values.push(`color:${foreground}`);
  const style = variant?.fontStyle ?? 0;
  if ((style & 1) !== 0) values.push("font-style:italic");
  if ((style & 2) !== 0) values.push("font-weight:700");
  if ((style & 4) !== 0) values.push("text-decoration:underline");
  return values.join(";");
}

function important(declarationList) {
  return declarationList
    .split(";")
    .filter(Boolean)
    .map((declaration) => `${declaration}!important`)
    .join(";");
}

function languageFromPath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").toLowerCase();
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const exact = exactLanguages.get(name);
  if (exact) return exact;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : extensionLanguages.get(name.slice(dot));
}

function evidenceLanguage(evidence) {
  if (evidence.sourceKind === "patch") return languageFromPath(evidence.path);
  if (!["after-file", "before-file"].includes(evidence.sourceKind)) return undefined;
  return languageFromPath(evidence.path);
}

function diffLineKind(content) {
  if (content.startsWith("+") && !content.startsWith("+++")) return "added";
  if (content.startsWith("-") && !content.startsWith("---")) return "removed";
  if (content.startsWith("@@")) return "hunk";
  if (content.startsWith(" ")) return "context";
  return "meta";
}

function diffCoordinates(lines) {
  let oldLine;
  let newLine;
  return lines.map((content) => {
    const hunk = content.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return Object.freeze({ content, kind: "hunk" });
    }

    const kind = diffLineKind(content);
    if (oldLine === undefined || newLine === undefined) {
      return Object.freeze({ content, kind });
    }

    if (kind === "added") {
      const result = Object.freeze({ content, kind, newLine });
      newLine += 1;
      return result;
    }
    if (kind === "removed") {
      const result = Object.freeze({ content, kind, oldLine });
      oldLine += 1;
      return result;
    }
    if (kind === "context") {
      const result = Object.freeze({ content, kind, newLine, oldLine });
      newLine += 1;
      oldLine += 1;
      return result;
    }
    return Object.freeze({ content, kind });
  });
}

async function getHighlighter() {
  highlighterPromise ??= (async () => {
    const highlighter = await createHighlighterCore({
      engine: createOnigurumaEngine(wasm),
      langs: languages,
      themes: [githubLight, githubDark],
    });
    for (const language of warmLanguages) {
      highlighter.codeToTokensWithThemes("hope", {
        lang: language,
        themes,
      });
    }
    return highlighter;
  })();
  return highlighterPromise;
}

export async function createCodeHighlighter() {
  const highlighter = await getHighlighter();
  const tokenRules = new Map();

  function tokenClass(variants) {
    const light = declarations(variants.light);
    const dark = declarations(variants.dark);
    const key = `${light}\n${dark}`;
    if (!tokenRules.has(key)) {
      tokenRules.set(key, Object.freeze({
        className: `syntax-token-${sha256(key).slice(0, 16)}`,
        dark,
        light,
      }));
    }
    return tokenRules.get(key).className;
  }

  function render(evidence) {
    const language = evidenceLanguage(evidence);
    if (evidence.sourceKind === "patch") {
      const lines = diffCoordinates(String(evidence.excerpt ?? "").split("\n"));
      return lines.map((line) => {
        const codeLine = ["added", "removed", "context"].includes(line.kind);
        const prefix = codeLine ? line.content.slice(0, 1) : "";
        const content = codeLine ? line.content.slice(1) : line.content;
        let tokens = escapeHtml(content);
        if (language && codeLine) {
          try {
            const highlighted = highlighter.codeToTokensWithThemes(content, {
              lang: language,
              themes,
            });
            tokens = highlighted.flat().map((token) => (
              `<span class="${tokenClass(token.variants)}">${escapeHtml(token.content)}</span>`
            )).join("");
          } catch {
            tokens = escapeHtml(content);
          }
        } else if (line.kind === "hunk") {
          try {
            const highlighted = highlighter.codeToTokensWithThemes(content, {
              lang: "diff",
              themes,
            });
            tokens = highlighted.flat().map((token) => (
              `<span class="${tokenClass(token.variants)}">${escapeHtml(token.content)}</span>`
            )).join("");
          } catch {
            tokens = escapeHtml(content);
          }
        }
        const coordinates = line.oldLine === undefined && line.newLine === undefined
          ? ""
          : ` data-old-line="${line.oldLine ?? ""}" data-new-line="${line.newLine ?? ""}"`;
        const coordinateClass = coordinates ? "" : " syntax-line-unlocated";
        const prefixHtml = prefix
          ? `<span class="syntax-prefix">${escapeHtml(prefix)}</span>`
          : "";
        return `<span class="syntax-line syntax-line-patch syntax-line-${line.kind}${coordinateClass}"${coordinates}>`
          + `<span class="syntax-content">${prefixHtml}${tokens}</span></span>`;
      }).join("");
    }
    if (!language) return escapeHtml(evidence.excerpt);
    try {
      const lines = highlighter.codeToTokensWithThemes(evidence.excerpt, {
        lang: language,
        themes,
      });
      return lines.map((line) => {
        const tokens = line.map((token) => (
          `<span class="${tokenClass(token.variants)}">${escapeHtml(token.content)}</span>`
        )).join("");
        return `<span class="syntax-line"><span class="syntax-content">${tokens}</span></span>`;
      }).join("");
    } catch {
      return escapeHtml(evidence.excerpt);
    }
  }

  function styleSheet() {
    const light = [];
    const print = [];
    const systemDark = [];
    const selectedDark = [];
    const rules = [...tokenRules.values()].sort((left, right) => (
      left.className.localeCompare(right.className, "en")
    ));
    for (const rule of rules) {
      if (rule.light) {
        light.push(`.${rule.className}{${rule.light}}`);
        print.push(`.${rule.className}{${important(rule.light)}}`);
      }
      if (rule.dark) {
        systemDark.push(
          `:root:not([data-theme="light"]) .${rule.className}{${rule.dark}}`,
        );
        selectedDark.push(`:root[data-theme="dark"] .${rule.className}{${rule.dark}}`);
      }
    }
    if (systemDark.length === 0) return light.join("\n");
    return `${light.join("\n")}
@media (prefers-color-scheme: dark) {
  ${systemDark.join("\n  ")}
}
${selectedDark.join("\n")}
@media print {
  ${print.join("\n  ")}
}`;
  }

  return Object.freeze({ render, styleSheet });
}

export { languageFromPath };
