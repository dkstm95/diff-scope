// Generated from features/diff/derive.mjs. Do not edit.
const importanceOrder = new Map([
  ["high", 0],
  ["medium", 1],
  ["low", 2],
]);

const kindOrder = new Map([
  ["resolve", 0],
  ["decide", 1],
  ["verify", 2],
]);

export function sortReviewItems(items) {
  return [...items].sort((left, right) => (
    importanceOrder.get(left.importance) - importanceOrder.get(right.importance)
    || kindOrder.get(left.kind) - kindOrder.get(right.kind)
    || left.originalIndex - right.originalIndex
  ));
}

export function deriveReviewResult(items, limits) {
  const counts = {
    decide: 0,
    resolve: 0,
    verify: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  const status = counts.resolve > 0
    ? "action"
    : counts.decide > 0
      ? "decision"
      : counts.verify > 0
        ? "verify"
        : "none";
  return Object.freeze({
    counts: Object.freeze(counts),
    scope: limits.some((limit) => limit.material) ? "limited" : "sufficient",
    status,
  });
}
