/* FocusGate — Options Page Script */
(function () {
  "use strict";

  const domainInput = document.getElementById("domain-input");
  const addBtn = document.getElementById("add-domain-btn");
  const domainListEl = document.getElementById("domain-list");
  const domainCountWrap = document.getElementById("domain-count-wrap");
  const domainCountText = document.getElementById("domain-count-text");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const promptInput = document.getElementById("prompt-input");
  const blurToggle = document.getElementById("blur-toggle");
  const pauseToggle = document.getElementById("pause-toggle");
  const pauseStatusText = document.getElementById("pause-status-text");
  const resetBtn = document.getElementById("reset-btn");
  const toast = document.getElementById("toast");

  // Page navigation
  const sidebarLinks = document.querySelectorAll(".sidebar-link");
  const pages = document.querySelectorAll(".page");

  sidebarLinks.forEach(link => {
    link.addEventListener("click", () => {
      const target = link.dataset.page;
      sidebarLinks.forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      pages.forEach(p => {
        p.classList.toggle("active", p.id === `page-${target}`);
      });
    });
  });

  // Toast
  function showToast(msg = "Saved!") {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  // Preset hold durations (seconds)
  const PRESET_DURATIONS = [2, 3, 5, 10, 15, 20, 30, 45, 60];

  // Helper to format hold duration
  function formatDuration(sec) {
    return `${sec} sec`;
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Local state for blocklist
  let currentBlocklist = [];
  let saveTimer = null;

  function debouncedSaveBlocklist(msg = "Saved!") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      browser.storage.sync.set({ blocklist: currentBlocklist }).then(() => {
        // Silent save internally
      });
    }, 400);
  }

  // Load settings
  function loadSettings() {
    browser.storage.sync.get({
      blocklist: [],
      promptText: "Why do you need this right now?",
      blurBlocked: true,
      paused: false
    }).then(data => {
      let needsSave = false;
      const rawList = Array.isArray(data.blocklist) ? data.blocklist : [];
      const migratedList = rawList.map(item => {
        if (typeof item === "string") {
          needsSave = true;
          const cleanDomain = item.trim().substring(0, 253);
          return cleanDomain ? { domain: cleanDomain, holdDuration: 5 } : null;
        }
        if (item && typeof item === "object" && typeof item.domain === "string") {
          const cleanDomain = item.domain.trim().substring(0, 253);
          if (cleanDomain) {
            const holdDuration = typeof item.holdDuration === "number" && !isNaN(item.holdDuration)
              ? Math.max(1, Math.min(180, item.holdDuration))
              : 5;
            if (item.domain !== cleanDomain || item.holdDuration !== holdDuration) {
              needsSave = true;
            }
            return {
              domain: cleanDomain,
              holdDuration: holdDuration
            };
          }
        }
        needsSave = true;
        return null;
      }).filter(Boolean);

      let cleanPromptText = "Why do you need this right now?";
      if (typeof data.promptText === "string") {
        cleanPromptText = data.promptText.trim().substring(0, 100) || cleanPromptText;
        if (data.promptText !== cleanPromptText) {
          needsSave = true;
        }
      } else {
        needsSave = true;
      }

      if (needsSave) {
        browser.storage.sync.set({ blocklist: migratedList, promptText: cleanPromptText });
      }

      currentBlocklist = migratedList;
      renderDomainList(currentBlocklist);
      promptInput.value = cleanPromptText;
      blurToggle.checked = typeof data.blurBlocked === "boolean" ? data.blurBlocked : true;
      pauseToggle.checked = typeof data.paused === "boolean" ? data.paused : false;
      updatePauseStatusText(pauseToggle.checked);
    });
  }

  function updatePauseStatusText(paused) {
    if (paused) {
      pauseStatusText.textContent = "OFF";
      pauseStatusText.className = "pause-status paused";
    } else {
      pauseStatusText.textContent = "ON";
      pauseStatusText.className = "pause-status";
    }
  }

  // Render domain list with custom dropdowns
  function renderDomainList(blocklist) {
    domainListEl.innerHTML = "";

    if (blocklist.length === 0) {
      domainListEl.innerHTML = '<div class="domain-empty">No websites blocked yet. Add one above to get started.</div>';
      domainCountWrap.style.display = "none";
      return;
    }

    domainCountWrap.style.display = "flex";
    domainCountText.textContent = `${blocklist.length} website${blocklist.length !== 1 ? "s" : ""}`;

    blocklist.forEach((entry, index) => {
      const escapedDomain = escapeHTML(entry.domain);
      const currentVal = typeof entry.holdDuration === "number" && !isNaN(entry.holdDuration)
        ? entry.holdDuration
        : 5;

      const item = document.createElement("div");
      item.className = "domain-item";

      // Build dropdown options HTML
      let optionsHtml = "";
      PRESET_DURATIONS.forEach(d => {
        const isSelected = d === currentVal ? "selected" : "";
        optionsHtml += `
          <div class="fg-dropdown-option ${isSelected}" data-val="${d}">
            <span>${formatDuration(d)}</span>
            <svg class="checkmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        `;
      });

      // Add Custom... option
      const isCustomSelected = !PRESET_DURATIONS.includes(currentVal) ? "selected" : "";
      optionsHtml += `
        <div class="fg-dropdown-option custom-opt ${isCustomSelected}" data-val="custom">
          <span>${isCustomSelected ? formatDuration(currentVal) : "Custom..."}</span>
          <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
      `;

      item.innerHTML = `
        <div class="domain-favicon">
          <img src="https://www.google.com/s2/favicons?domain=${escapedDomain}&sz=32" alt="" onerror="this.style.display='none'">
        </div>
        <span class="domain-name">${escapedDomain}</span>
        
        <!-- Custom Hold Duration Dropdown -->
        <div class="fg-dropdown-container">
          <button class="fg-dropdown-btn" data-index="${index}">
            <span class="fg-dropdown-btn-label">${formatDuration(currentVal)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="fg-dropdown-menu">
            ${optionsHtml}
          </div>
        </div>

        <button class="domain-remove" data-index="${index}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      `;

      domainListEl.appendChild(item);
    });

    // Bind dropdown events
    bindDropdownEvents(blocklist);

    // Bind remove buttons
    domainListEl.querySelectorAll(".domain-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index);
        removeDomain(idx);
      });
    });
  }

  // Handle dropdown interactions
  function bindDropdownEvents(blocklist) {
    const containers = domainListEl.querySelectorAll(".fg-dropdown-container");

    containers.forEach(container => {
      const btn = container.querySelector(".fg-dropdown-btn");
      const menu = container.querySelector(".fg-dropdown-menu");
      const idx = parseInt(btn.dataset.index);

      // Toggle menu
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Close all other menus
        document.querySelectorAll(".fg-dropdown-menu").forEach(m => {
          if (m !== menu) m.classList.remove("show");
        });
        document.querySelectorAll(".fg-dropdown-btn").forEach(b => {
          if (b !== btn) b.classList.remove("active");
        });

        btn.classList.toggle("active");
        menu.classList.toggle("show");
      });

      // Option clicks
      const options = menu.querySelectorAll(".fg-dropdown-option");
      options.forEach(opt => {
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          const val = opt.dataset.val;

          if (val === "custom") {
            // Prompt for custom input
            const currentVal = blocklist[idx].holdDuration || 5;
            const customVal = prompt("Enter custom hold duration in seconds (1 to 180):", currentVal);
            if (customVal !== null) {
              const parsed = parseInt(customVal);
              if (!isNaN(parsed) && parsed >= 1 && parsed <= 180) {
                updateDomainDuration(idx, parsed);
              } else {
                alert("Please enter a valid number between 1 and 180.");
              }
            }
            btn.classList.remove("active");
            menu.classList.remove("show");
          } else {
            const parsedVal = parseInt(val);
            updateDomainDuration(idx, parsedVal);
            btn.classList.remove("active");
            menu.classList.remove("show");
          }
        });
      });
    });
  }

  // Update domain duration in storage
  function updateDomainDuration(index, newDuration) {
    if (currentBlocklist[index]) {
      currentBlocklist[index].holdDuration = newDuration;
      renderDomainList(currentBlocklist);
      showToast("Duration updated!");
      debouncedSaveBlocklist();
    }
  }

  // Add domain
  function addDomain() {
    let domain = domainInput.value.trim().toLowerCase();
    if (!domain) return;

    // Clean up domain
    domain = domain.replace(/^(https?:\/\/)/, "");
    domain = domain.replace(/^www\./, "");
    domain = domain.split("/")[0];
    domain = domain.split("?")[0];

    if (domain.length > 253 || !domain || domain.indexOf(".") === -1) {
      showToast("Please enter a valid domain");
      return;
    }

    const exists = currentBlocklist.some(item => item.domain === domain);
    if (exists) {
      showToast("Domain already blocked");
      return;
    }

    currentBlocklist.push({ domain: domain, holdDuration: 5 }); // Default to 5s hold duration
    domainInput.value = "";
    renderDomainList(currentBlocklist);
    showToast("Website added!");
    debouncedSaveBlocklist();
  }

  // Remove domain
  function removeDomain(index) {
    if (currentBlocklist[index]) {
      currentBlocklist.splice(index, 1);
      renderDomainList(currentBlocklist);
      showToast("Website removed");
      debouncedSaveBlocklist();
    }
  }

  // Clear all
  clearAllBtn.addEventListener("click", () => {
    if (confirm("Remove all blocked websites?")) {
      currentBlocklist = [];
      renderDomainList(currentBlocklist);
      showToast("All websites cleared");
      debouncedSaveBlocklist();
    }
  });

  // Add button click
  addBtn.addEventListener("click", addDomain);
  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });

  // Save prompt on change
  let promptTimer;
  promptInput.addEventListener("input", () => {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => {
      let val = promptInput.value.trim();
      if (val.length > 100) {
        val = val.substring(0, 100);
      }
      val = val || "Why do you need this right now?";
      browser.storage.sync.set({ promptText: val }).then(() => showToast());
    }, 500);
  });

  // Option toggles (Blur blocked)
  blurToggle.addEventListener("change", () => {
    browser.storage.sync.set({ blurBlocked: blurToggle.checked }).then(() => {
      showToast("Blur setting updated!");
    });
  });

  // Sidebar Pause Toggle
  pauseToggle.addEventListener("change", () => {
    const isPaused = pauseToggle.checked;
    browser.storage.sync.set({ paused: isPaused }).then(() => {
      updatePauseStatusText(isPaused);
      showToast(isPaused ? "Extension paused!" : "Extension active!");
    });
  });

  // Reset all
  resetBtn.addEventListener("click", () => {
    if (confirm("Reset all settings and clear blocklist?")) {
      browser.storage.sync.clear().then(() => {
        loadSettings();
        showToast("All settings reset");
      });
    }
  });
  // Close dropdowns on clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll(".fg-dropdown-menu").forEach(m => m.classList.remove("show"));
    document.querySelectorAll(".fg-dropdown-btn").forEach(b => b.classList.remove("active"));
  });

  // Init
  loadSettings();
})();
