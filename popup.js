/* FocusGate — Popup Script */
(function () {
  "use strict";

  const blockCount = document.getElementById("block-count");
  const openSettings = document.getElementById("open-settings");
  const dot = document.querySelector(".status-dot");
  const statusText = document.querySelector(".status-text");

  function updateStatus(paused) {
    if (paused) {
      dot.classList.add("paused");
      statusText.classList.add("paused");
      statusText.innerHTML = "<strong>Paused</strong> — Extension is inactive";
    } else {
      dot.classList.remove("paused");
      statusText.classList.remove("paused");
      statusText.innerHTML = "<strong>Active</strong> — Guarding your focus";
    }
  }

  // Load paused status from sync storage
  browser.storage.sync.get({ paused: false }).then(data => {
    updateStatus(data.paused);
  }).catch(() => {
    updateStatus(false);
  });

  // Keep synced with options updates
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes && changes.paused) {
      updateStatus(changes.paused.newValue);
    }
  });

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
