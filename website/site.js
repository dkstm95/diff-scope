"use strict";

const copyButton = document.querySelector("[data-copy-target]");
const copyStatus = document.getElementById("copy-status");

if (copyButton && copyStatus) {
  copyButton.addEventListener("click", async () => {
    const target = document.getElementById(copyButton.dataset.copyTarget);
    const installRequest = target?.textContent.trim();
    if (!target || !installRequest) return;

    try {
      await navigator.clipboard.writeText(installRequest);
      copyButton.textContent = "Copied";
      copyStatus.textContent = "Paste the request into Codex and send it.";
    } catch {
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = "The request is selected. Copy it, then paste it into Codex.";
    }
  });
}
