/* FocusGate — Popup Script */
(function () {
  "use strict";

  const blockCount = document.getElementById("block-count");
  const openSettings = document.getElementById("open-settings");

  // Load blocklist count
  browser.runtime.sendMessage({ type: "GET_BLOCKLIST_COUNT" }).then(resp => {
    if (resp && typeof resp.count === "number") {
      blockCount.textContent = resp.count;
    }
  }).catch(() => {
    blockCount.textContent = "0";
  });

  // Open settings page
  openSettings.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });
})();
