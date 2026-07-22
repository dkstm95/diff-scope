export const DIFF_REBUILD_CODE = "HOPE_DIFF_REBUILDING";
export const DIFF_REBUILD_MESSAGE =
  "Hope diff is being rebuilt from docs/diff.md. No review was created.";

export function runDiff() {
  const error = new Error(DIFF_REBUILD_MESSAGE);
  error.code = DIFF_REBUILD_CODE;
  throw error;
}
