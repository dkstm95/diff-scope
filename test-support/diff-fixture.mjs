import { digestJson } from "../features/diff/hash.mjs";

export function makeSnapshot({
  locale = "en-US",
  theme = "system",
  title = "Keep the last retry error",
} = {}) {
  const value = {
    capturedAt: "2026-07-23T00:00:00.000Z",
    files: [
      {
        additions: 2,
        bodyState: "included",
        deletions: 1,
        id: "file-1",
        path: "src/retry.js",
        providerStatus: "modified",
        sourceIds: ["source-3"],
      },
    ],
    limits: [
      {
        id: "limit-1",
        kind: "unchanged-context",
        reason: "Unchanged callers were not collected",
        subject: "Unchanged callers",
      },
    ],
    pullRequest: {
      author: "octocat",
      number: 142,
      state: "open",
      title,
      url: "https://github.com/example/hope/pull/142",
    },
    repository: {
      name: "hope",
      owner: "example",
      provider: "github",
    },
    schemaVersion: 1,
    settings: {
      locale,
      localeSource: "override",
      theme,
      themeSource: "override",
    },
    snapshot: {
      base: "a".repeat(40),
      head: "b".repeat(40),
      mergeBase: "c".repeat(40),
    },
    sources: [
      {
        id: "source-1",
        kind: "pull-request-title",
        lineCount: 1,
        text: title,
      },
      {
        id: "source-2",
        kind: "pull-request-description",
        lineCount: 1,
        text: "Return the final error after all retries fail.",
      },
      {
        fileId: "file-1",
        id: "source-3",
        kind: "patch",
        lineCount: 4,
        path: "src/retry.js",
        revision: "b".repeat(40),
        text: "@@ -1 +1,2 @@\n-throw new Error()\n+const last = error\n+throw last",
      },
    ],
  };
  return Object.freeze({
    ...value,
    digest: digestJson(value),
  });
}

function reference(sourceId, startLine, endLine = startLine) {
  return { endLine, sourceId, startLine };
}

export function makeAnalysis(snapshot, runId) {
  return {
    codeSteps: [
      {
        basis: "code",
        evidence: [reference("source-3", 2, 4)],
        fileIds: ["file-1"],
        text: "The retry path stores the final error and throws it.",
        title: "Preserve the final error",
      },
    ],
    contextChecks: [
      {
        evidence: [reference("source-3", 1, 4)],
        explanation: "The changed retry branch and its direct result were checked.",
        limitIds: [],
        status: "checked",
        subject: "Changed retry behavior",
      },
      {
        evidence: [],
        explanation: "Unchanged direct callers were not collected.",
        limitIds: ["limit-1"],
        status: "limited",
        subject: "Unchanged direct callers",
      },
      {
        evidence: [],
        explanation: "This change does not modify stored data or a migration.",
        limitIds: [],
        status: "not-applicable",
        subject: "Stored data and migrations",
      },
    ],
    coreChange: {
      after: {
        basis: "code",
        evidence: [reference("source-3", 2, 4)],
        text: "The final retry error is returned to the caller.",
      },
      before: {
        basis: "code",
        evidence: [reference("source-3", 2)],
        text: "The final retry error was replaced by a generic error.",
      },
      details: [
        {
          basis: "code",
          evidence: [reference("source-3", 2, 4)],
          text: "The changed branch keeps the last error before it exits.",
        },
      ],
      why: {
        basis: "inferred",
        evidence: [reference("source-2", 1), reference("source-3", 2, 4)],
        text: "Callers can distinguish the real failure reason.",
      },
    },
    fileDispositions: [
      { disposition: "explained", fileId: "file-1" },
    ],
    limitImpacts: [
      {
        impact: "Compatibility with unchanged callers cannot be confirmed.",
        limitId: "limit-1",
        material: true,
      },
    ],
    locale: snapshot.settings.locale,
    purpose: {
      basis: "stated",
      evidence: [reference("source-2", 1)],
      text: "Return the final error after all retries fail.",
    },
    reviewItems: [
      {
        basis: "inferred",
        doneWhen: "A caller test confirms the final error is preserved.",
        effect: "An unchanged caller may handle the new error differently.",
        evidence: [reference("source-3", 2, 4)],
        explanation: "The changed error reaches callers that were not collected.",
        importance: "medium",
        kind: "verify",
        limitIds: ["limit-1"],
        nextStep: "Run or inspect a direct caller test.",
        title: "Check unchanged callers",
      },
    ],
    runId,
    schemaVersion: 1,
    snapshotDigest: snapshot.digest,
  };
}
