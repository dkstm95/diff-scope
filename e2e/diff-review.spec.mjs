import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { digestJson } from "../features/diff/hash.mjs";
import { renderReview } from "../features/diff/render.mjs";
import { validateAnalysis } from "../features/diff/validate.mjs";
import { makeAnalysis, makeSnapshot } from "../test-support/diff-fixture.mjs";

const runId = "4".repeat(32);
const viewports = {
  breakpoint: { height: 900, width: 1100 },
  desktop: { height: 900, width: 1440 },
  mobile: { height: 812, width: 375 },
  wide: { height: 1440, width: 2560 },
};

let artifactDirectory;
let artifactUrl;

test.beforeAll(async () => {
  artifactDirectory = await mkdtemp(join(tmpdir(), "hope-browser-review-"));
  const baseSnapshot = makeSnapshot({
    locale: "ko-KR",
    title: "마지막 재시도 오류를 보존하고 아주 긴 경로에서도 화면 너비를 유지합니다",
  });
  const snapshotValue = {
    ...baseSnapshot,
    sources: baseSnapshot.sources.map((source) => (
      source.id === "source-3"
        ? {
          ...source,
          text: "@@ -1 +1,2 @@\n-throw new Error()\n+const last = error\n"
            + `+throw ${"veryLongIdentifier".repeat(120)}`,
        }
        : source
    )),
  };
  delete snapshotValue.digest;
  const snapshot = Object.freeze({
    ...snapshotValue,
    digest: digestJson(snapshotValue),
  });
  const analysis = makeAnalysis(snapshot, runId);
  const review = validateAnalysis(analysis, snapshot, { runId });
  const rendered = await renderReview(review);
  const artifactPath = join(artifactDirectory, "hope-review.html");
  await writeFile(artifactPath, rendered.bytes);
  artifactUrl = pathToFileURL(artifactPath).href;
});

test.afterAll(async () => {
  if (artifactDirectory) {
    await rm(artifactDirectory, { force: true, recursive: true });
  }
});

async function openArtifact(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(artifactUrl);
}

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    rootClient: document.documentElement.clientWidth,
    rootScroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient);
  expect(overflow.rootScroll).toBeLessThanOrEqual(overflow.rootClient);
}

test("desktop and mobile keep wide content inside the document", async ({ page }) => {
  const remoteRequests = [];
  page.on("request", (request) => {
    if (/^https?:/u.test(request.url())) remoteRequests.push(request.url());
  });
  await openArtifact(page, viewports.desktop);
  await expect(page.locator("#synopsis h2")).toHaveText("변경 요약");
  await expectNoPageOverflow(page);

  for (const viewport of [
    viewports.breakpoint,
    viewports.mobile,
    viewports.wide,
  ]) {
    await page.setViewportSize(viewport);
    await expectNoPageOverflow(page);
  }
  expect(remoteRequests).toEqual([]);
});

test("the theme control works from the keyboard and describes its next action", async ({
  page,
}) => {
  await openArtifact(page, viewports.desktop);
  const theme = page.locator("#theme-toggle");

  await expect(theme).toHaveAttribute("aria-label", "다크 모드로 전환");
  await expect(theme).not.toHaveAttribute("aria-pressed", /.+/u);

  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme).toHaveAttribute("aria-label", "라이트 모드로 전환");
  await expect(theme).not.toHaveAttribute("aria-pressed", /.+/u);

  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(theme).toHaveAttribute("aria-label", "다크 모드로 전환");
});

test("mobile evidence controls are distinct and large enough to touch", async ({
  page,
}) => {
  await openArtifact(page, viewports.mobile);
  const summaries = page.locator("details.evidence > summary");
  const count = await summaries.count();
  expect(count).toBeGreaterThan(1);

  const names = await summaries.evaluateAll((items) => (
    items.map((item) => item.getAttribute("aria-label"))
  ));
  expect(names.every(Boolean)).toBe(true);
  expect(new Set(names).size).toBe(names.length);

  for (let index = 0; index < count; index += 1) {
    const box = await summaries.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const otherSummaries = page.locator(
    ".quiz > details > summary, .artifact-details > summary, .toc-mobile > summary",
  );
  const otherCount = await otherSummaries.count();
  expect(otherCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < otherCount; index += 1) {
    const box = await otherSummaries.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const mobileToc = page.locator(".toc-mobile");
  const mobileTocSummary = mobileToc.locator(":scope > summary");
  await mobileTocSummary.click();
  await expect(mobileToc).toHaveAttribute("open", "");
  const openTocBox = await mobileTocSummary.boundingBox();
  expect(openTocBox).not.toBeNull();
  expect(openTocBox.height).toBeGreaterThanOrEqual(44);
});

test("highlighted code preserves source line breaks in the DOM", async ({ page }) => {
  await openArtifact(page, viewports.desktop);
  const code = page.locator(".syntax-code code").filter({ hasText: "+const last" }).first();
  await code.evaluate((element) => {
    const details = element.closest("details");
    if (details) details.open = true;
  });
  await expect(code).toBeVisible();
  const text = (await code.innerText()).replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines.slice(0, 2)).toEqual([
    "-throw new Error()",
    "+const last = error",
  ]);
  expect(lines[2]).toMatch(/^\+throw veryLongIdentifier/u);
});

test("fragment navigation opens details that contain the target", async ({ page }) => {
  await openArtifact(page, viewports.desktop);
  const reference = page.locator('.evidence-reference a[href^="#evidence-"]').first();
  await reference.evaluate((element) => {
    const details = element.closest("details");
    if (details) details.open = true;
  });
  await expect(reference).toBeVisible();
  const targetId = (await reference.getAttribute("href")).slice(1);

  await page.locator(`#${targetId}`).evaluate((target) => {
    const details = target.closest("details");
    if (details) details.open = false;
  });
  await reference.click();

  await expect(page.locator(`#${targetId}`).locator("xpath=ancestor::details[1]")).toHaveAttribute(
    "open",
    "",
  );
});

test("the offline artifact remains readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: viewports.mobile,
  });
  const page = await context.newPage();
  const externalRequests = [];
  page.on("request", (request) => {
    if (/^https?:/u.test(request.url())) externalRequests.push(request.url());
  });
  try {
    await page.goto(artifactUrl);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#synopsis")).toBeVisible();
    await expect(page.locator("#evidence-and-scope")).toContainText("수집한 출처");
    await expect(page.locator("#evidence-and-scope")).toContainText("맥락 확인 상태");
    await expect(page.locator(".syntax-code code").first()).toContainText(
      "throw new Error()",
    );
    await expectNoPageOverflow(page);
    expect(externalRequests).toEqual([]);
  } finally {
    await context.close();
  }
});
