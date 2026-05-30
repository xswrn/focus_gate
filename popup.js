/* FocusGate — Popup Script */
(function () {
  "use strict";

  const blockCount = document.getElementById("block-count");
  const openSettings = document.getElementById("open-settings");
  const dot = document.querySelector(".status-dot");
  const statusText = document.querySelector(".status-text");

  function updateStatus(paused) {
    dot.classList.toggle("paused", paused);
    statusText.classList.toggle("paused", paused);
    statusText.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = paused ? "Paused" : "Active";
    statusText.appendChild(strong);
    statusText.appendChild(document.createTextNode(
      paused ? " — Extension is inactive" : " — Guarding your focus"
    ));
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

  // Set version from manifest
  const footerText = document.querySelector(".popup-footer-text");
  if (footerText) {
    footerText.textContent = "FocusGate v" + browser.runtime.getManifest().version;
  }
})();
