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
  const pauseTriggerBtn = document.getElementById("pause-trigger-btn");
  const pauseHoldTrigger = document.getElementById("pause-hold-trigger");
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
  function showToast(msg = "Saved!", type = "success") {
    toast.textContent = msg;
    toast.className = "toast";
    if (type === "error") {
      toast.classList.add("error");
    }
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

  let isExtensionPaused = false;
  let isHoldingPause = false;
  let holdPauseStart = 0;
  let pauseHoldAnimFrame = null;

  let isHoldingDelete = false;
  let deleteHoldStart = 0;
  let deleteHoldAnimFrame = null;
  let activeDeleteBtn = null;

  let isHoldingDropdown = false;
  let dropdownHoldStart = 0;
  let dropdownHoldAnimFrame = null;
  let activeDropdownOpt = null;

  function saveBlocklist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    browser.storage.sync.set({ blocklist: currentBlocklist }).catch(err => {
      showToast("Save failed — storage limit exceeded?", "error");
    });
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
          const cleanDomain = item.trim().replace(/\.+$/, "").toLowerCase().substring(0, 253);
          return cleanDomain ? { domain: cleanDomain, holdDuration: 5 } : null;
        }
        if (item && typeof item === "object" && typeof item.domain === "string") {
          const cleanDomain = item.domain.trim().replace(/\.+$/, "").toLowerCase().substring(0, 253);
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
        browser.storage.sync.set({ blocklist: migratedList, promptText: cleanPromptText }).catch(() => {});
      }

      currentBlocklist = migratedList;
      renderDomainList(currentBlocklist);
      promptInput.value = cleanPromptText;
      blurToggle.checked = typeof data.blurBlocked === "boolean" ? data.blurBlocked : true;
      isExtensionPaused = typeof data.paused === "boolean" ? data.paused : false;
      updatePauseStatusText(isExtensionPaused);
    });
  }

  function updatePauseStatusText(paused) {
    const pillText = document.getElementById("pause-pill-text");
    const holdLabel = document.getElementById("pause-hold-label");
    
    if (pauseTriggerBtn) {
      pauseTriggerBtn.classList.toggle("paused", paused);
    }
    if (pillText) {
      pillText.textContent = paused ? "OFF" : "ON";
    }
    if (holdLabel) {
      holdLabel.textContent = paused ? "Hold to enable \u00b7 20s" : "Hold to disable \u00b7 20s";
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
          <button type="button" class="fg-dropdown-option ${isSelected}" data-val="${d}">
            <div class="dropdown-option-progress"></div>
            <span>${formatDuration(d)}</span>
            <svg class="checkmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
        `;
      });

      // Add Custom... option
      const isCustomSelected = !PRESET_DURATIONS.includes(currentVal) ? "selected" : "";
      optionsHtml += `
        <button type="button" class="fg-dropdown-option custom-opt ${isCustomSelected}" data-val="custom">
          <div class="dropdown-option-progress"></div>
          <span>${isCustomSelected ? formatDuration(currentVal) : "Custom..."}</span>
          <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      `;

      item.innerHTML = `
        <div class="domain-favicon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z"></path>
          </svg>
        </div>
        <span class="domain-name">${escapedDomain}</span>
        
        <!-- Red warning prompt for delete -->
        <span class="delete-warning-msg" style="display: none;">Is it really necessary?</span>

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
            <div class="dropdown-warning-msg" style="display: none;">Is it really necessary?</div>
          </div>
        </div>

        <button class="domain-remove" data-index="${index}" title="Remove">
          <div class="domain-remove-progress"></div>
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
    function cancelDeleteHold() {
      if (!isHoldingDelete) return;
      isHoldingDelete = false;
      if (deleteHoldAnimFrame) {
        cancelAnimationFrame(deleteHoldAnimFrame);
        deleteHoldAnimFrame = null;
      }
      if (activeDeleteBtn) {
        const progressEl = activeDeleteBtn.querySelector(".domain-remove-progress");
        if (progressEl) progressEl.style.width = "0%";
        const parentItem = activeDeleteBtn.closest(".domain-item");
        if (parentItem) {
          const warningMsg = parentItem.querySelector(".delete-warning-msg");
          if (warningMsg) warningMsg.style.display = "none";
        }
      }
      activeDeleteBtn = null;
    }

    function startDeleteHold(btn) {
      cancelDeleteHold();
      isHoldingDelete = true;
      activeDeleteBtn = btn;
      deleteHoldStart = Date.now();

      const progressEl = btn.querySelector(".domain-remove-progress");
      const parentItem = btn.closest(".domain-item");
      const warningMsg = parentItem ? parentItem.querySelector(".delete-warning-msg") : null;
      
      if (warningMsg) {
        warningMsg.style.display = "inline";
      }

      function updateDeleteProgress() {
        if (!isHoldingDelete || activeDeleteBtn !== btn) return;
        const elapsed = Date.now() - deleteHoldStart;
        const progress = Math.min(elapsed / 20000, 1);
        
        if (progressEl) {
          progressEl.style.width = `${progress * 100}%`;
        }
        
        if (progress >= 1) {
          const idx = parseInt(btn.dataset.index);
          removeDomain(idx);
          cancelDeleteHold();
          return;
        }
        deleteHoldAnimFrame = requestAnimationFrame(updateDeleteProgress);
      }
      
      deleteHoldAnimFrame = requestAnimationFrame(updateDeleteProgress);
    }

    domainListEl.querySelectorAll(".domain-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
      });

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        startDeleteHold(btn);
      });

      btn.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          startDeleteHold(btn);
        }
      });

      btn.addEventListener("pointerup", cancelDeleteHold);
      btn.addEventListener("pointerleave", cancelDeleteHold);
      btn.addEventListener("pointercancel", cancelDeleteHold);
      btn.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") {
          cancelDeleteHold();
        }
      });
      btn.addEventListener("blur", cancelDeleteHold);
    });
  }

  // Handle dropdown interactions
  function bindDropdownEvents(blocklist) {
    const containers = domainListEl.querySelectorAll(".fg-dropdown-container");

    containers.forEach(container => {
      const btn = container.querySelector(".fg-dropdown-btn");
      const menu = container.querySelector(".fg-dropdown-menu");
      const idx = parseInt(btn.dataset.index);
      const warningMsg = menu.querySelector(".dropdown-warning-msg");

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

      // Escape key handler to close menu
      container.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          btn.classList.remove("active");
          menu.classList.remove("show");
          btn.focus();
        }
      });

      // Option hold logic
      const options = menu.querySelectorAll(".fg-dropdown-option");
      
      function cancelDropdownHold() {
        if (!isHoldingDropdown) return;
        isHoldingDropdown = false;
        if (dropdownHoldAnimFrame) {
          cancelAnimationFrame(dropdownHoldAnimFrame);
          dropdownHoldAnimFrame = null;
        }
        if (activeDropdownOpt) {
          const progressEl = activeDropdownOpt.querySelector(".dropdown-option-progress");
          if (progressEl) progressEl.style.width = "0%";
        }
        if (warningMsg) {
          warningMsg.style.display = "none";
        }
        activeDropdownOpt = null;
      }

      function startDropdownHold(opt) {
        cancelDropdownHold();
        isHoldingDropdown = true;
        activeDropdownOpt = opt;
        dropdownHoldStart = Date.now();

        const progressEl = opt.querySelector(".dropdown-option-progress");
        if (warningMsg) {
          warningMsg.style.display = "block";
        }

        function updateDropdownProgress() {
          if (!isHoldingDropdown || activeDropdownOpt !== opt) return;
          const elapsed = Date.now() - dropdownHoldStart;
          const progress = Math.min(elapsed / 20000, 1);

          if (progressEl) {
            progressEl.style.width = `${progress * 100}%`;
          }

          if (progress >= 1) {
            const val = opt.dataset.val;
            if (val === "custom") {
              const currentVal = blocklist[idx].holdDuration || 5;
              openCustomDurationModal(idx, currentVal);
            } else {
              const parsedVal = parseInt(val);
              updateDomainDuration(idx, parsedVal);
            }
            btn.classList.remove("active");
            menu.classList.remove("show");
            btn.focus();
            cancelDropdownHold();
            return;
          }
          dropdownHoldAnimFrame = requestAnimationFrame(updateDropdownProgress);
        }

        dropdownHoldAnimFrame = requestAnimationFrame(updateDropdownProgress);
      }

      options.forEach(opt => {
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
        });

        opt.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          startDropdownHold(opt);
        });

        opt.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.stopPropagation();
            e.preventDefault();
            startDropdownHold(opt);
          }
        });

        opt.addEventListener("pointerup", (e) => {
          e.stopPropagation();
          cancelDropdownHold();
        });
        opt.addEventListener("pointerleave", (e) => {
          e.stopPropagation();
          cancelDropdownHold();
        });
        opt.addEventListener("pointercancel", (e) => {
          e.stopPropagation();
          cancelDropdownHold();
        });
        opt.addEventListener("keyup", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.stopPropagation();
            cancelDropdownHold();
          }
        });
        opt.addEventListener("blur", (e) => {
          e.stopPropagation();
          cancelDropdownHold();
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
      saveBlocklist();
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
    domain = domain.replace(/\.+$/, "");

    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
    if (domain.length > 253 || !domain || !domainRegex.test(domain)) {
      showToast("Please enter a valid domain", "error");
      return;
    }

    const exists = currentBlocklist.some(item => item.domain === domain);
    if (exists) {
      showToast("Domain already blocked", "error");
      return;
    }

    currentBlocklist.push({ domain: domain, holdDuration: 5 }); // Default to 5s hold duration
    domainInput.value = "";
    renderDomainList(currentBlocklist);
    showToast("Website added!");
    saveBlocklist();
  }

  // Remove domain
  function removeDomain(index) {
    if (currentBlocklist[index]) {
      currentBlocklist.splice(index, 1);
      renderDomainList(currentBlocklist);
      showToast("Website removed");
      saveBlocklist();
    }
  }

  // Clear all
  clearAllBtn.addEventListener("click", () => {
    showConfirmModal("Clear Blocked Websites", "Are you sure you want to remove all blocked websites from your list?", () => {
      currentBlocklist = [];
      renderDomainList(currentBlocklist);
      showToast("All websites cleared");
      saveBlocklist();
    });
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
      browser.storage.sync.set({ promptText: val }).then(() => showToast()).catch(err => {
        showToast("Save failed", "error");
      });
    }, 500);
  });

  promptInput.addEventListener("blur", () => {
    clearTimeout(promptTimer);
    promptTimer = null;
    let val = promptInput.value.trim();
    if (val.length > 100) {
      val = val.substring(0, 100);
    }
    val = val || "Why do you need this right now?";
    browser.storage.sync.set({ promptText: val }).catch(err => {
      showToast("Save failed", "error");
    });
  });

  // Option toggles (Blur blocked)
  blurToggle.addEventListener("change", () => {
    browser.storage.sync.set({ blurBlocked: blurToggle.checked }).then(() => {
      showToast("Blur setting updated!");
    }).catch(err => {
      showToast("Save failed", "error");
    });
  });

  // Sidebar Pause Hold Logic (20s confirm)
  if (pauseHoldTrigger) {
    const pauseHoldFill = document.getElementById("pause-hold-fill");
    const pauseHoldLabel = document.getElementById("pause-hold-label");
    const pauseDangerAlert = document.getElementById("pause-danger-alert");
    const pauseCardHint = document.getElementById("pause-card-hint");

    function cancelPauseHold() {
      if (!isHoldingPause) return;
      isHoldingPause = false;
      if (pauseHoldAnimFrame) {
        cancelAnimationFrame(pauseHoldAnimFrame);
        pauseHoldAnimFrame = null;
      }

      if (pauseHoldFill) {
        pauseHoldFill.style.width = "0%";
      }
      if (pauseHoldLabel) {
        pauseHoldLabel.textContent = isExtensionPaused ? "Hold to enable \u00b7 20s" : "Hold to disable \u00b7 20s";
      }
      if (pauseDangerAlert) {
        pauseDangerAlert.style.display = "none";
      }
      if (pauseCardHint) {
        pauseCardHint.style.display = "flex";
      }
    }

    function updatePauseHoldProgress() {
      if (!isHoldingPause) return;
      const elapsed = Date.now() - holdPauseStart;
      const progress = Math.min(elapsed / 20000, 1);
      
      if (pauseHoldFill) {
        pauseHoldFill.style.width = `${progress * 100}%`;
      }
      if (pauseHoldLabel) {
        const remaining = Math.ceil((20000 - elapsed) / 1000);
        const action = isExtensionPaused ? "Enabling" : "Disabling";
        pauseHoldLabel.textContent = `${action} \u00b7 ${Math.max(0, remaining)}s`;
      }

      if (progress >= 1) {
        // Success!
        isExtensionPaused = !isExtensionPaused;
        browser.storage.sync.set({ paused: isExtensionPaused }).then(() => {
          updatePauseStatusText(isExtensionPaused);
          showToast(isExtensionPaused ? "Extension paused!" : "Extension active!");
          cancelPauseHold();
        }).catch(err => {
          showToast("Save failed", "error");
          cancelPauseHold();
        });
        return;
      }
      pauseHoldAnimFrame = requestAnimationFrame(updatePauseHoldProgress);
    }

    function startPauseHold() {
      if (isHoldingPause) return;
      isHoldingPause = true;
      holdPauseStart = Date.now();

      if (pauseHoldFill) {
        pauseHoldFill.style.width = "0%";
      }
      if (pauseDangerAlert) {
        pauseDangerAlert.style.display = "block";
      }
      if (pauseCardHint) {
        pauseCardHint.style.display = "none";
      }
      pauseHoldAnimFrame = requestAnimationFrame(updatePauseHoldProgress);
    }

    pauseHoldTrigger.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startPauseHold();
    });

    pauseHoldTrigger.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        startPauseHold();
      }
    });

    pauseHoldTrigger.addEventListener("pointerup", cancelPauseHold);
    pauseHoldTrigger.addEventListener("pointerleave", cancelPauseHold);
    pauseHoldTrigger.addEventListener("pointercancel", cancelPauseHold);
    pauseHoldTrigger.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") {
        cancelPauseHold();
      }
    });
    pauseHoldTrigger.addEventListener("blur", cancelPauseHold);
  }

  // Reset all
  resetBtn.addEventListener("click", () => {
    showConfirmModal("Reset All Settings", "Are you sure you want to reset all settings and clear the blocklist? This action cannot be undone.", () => {
      browser.storage.sync.clear().then(() => {
        loadSettings();
        showToast("All settings reset");
      }).catch(err => {
        showToast("Reset failed", "error");
      });
    });
  });
  // Close dropdowns on clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll(".fg-dropdown-menu").forEach(m => m.classList.remove("show"));
    document.querySelectorAll(".fg-dropdown-btn").forEach(b => b.classList.remove("active"));
  });

  function flushPendingSaves() {
    if (promptTimer) {
      clearTimeout(promptTimer);
      promptTimer = null;
      let val = promptInput.value.trim();
      if (val.length > 100) {
        val = val.substring(0, 100);
      }
      val = val || "Why do you need this right now?";
      browser.storage.sync.set({ promptText: val }).catch(() => {});
    }
  }

  window.addEventListener("beforeunload", flushPendingSaves);
  window.addEventListener("pagehide", flushPendingSaves);

  // Listen for changes from other tabs
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    if (changes.blocklist && !saveTimer) {
      currentBlocklist = Array.isArray(changes.blocklist.newValue) ? changes.blocklist.newValue : [];
      renderDomainList(currentBlocklist);
    }
    if (changes.promptText && !promptTimer) {
      promptInput.value = typeof changes.promptText.newValue === "string" ? changes.promptText.newValue : "Why do you need this right now?";
    }
    if (changes.blurBlocked) {
      blurToggle.checked = typeof changes.blurBlocked.newValue === "boolean" ? changes.blurBlocked.newValue : true;
    }
    if (changes.paused) {
      const isPaused = typeof changes.paused.newValue === "boolean" ? changes.paused.newValue : false;
      isExtensionPaused = isPaused;
      updatePauseStatusText(isPaused);
    }
  });

  // Custom Duration Modal
  let activeCustomIdx = null;
  const customModal = document.getElementById("custom-duration-modal");
  const customInput = document.getElementById("custom-duration-input");
  const modalError = document.getElementById("modal-error-msg");
  const modalCloseBtn = document.getElementById("modal-close");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalSaveBtn = document.getElementById("modal-save-btn");

  function openCustomDurationModal(index, currentVal) {
    activeCustomIdx = index;
    if (customInput) {
      customInput.value = currentVal;
    }
    if (modalError) {
      modalError.style.display = "none";
    }
    if (customModal) {
      customModal.style.display = "flex";
      void customModal.offsetWidth;
      customModal.classList.add("show");
    }
    if (customInput) {
      customInput.focus();
      customInput.select();
    }
  }

  function closeCustomDurationModal() {
    if (customModal) {
      customModal.classList.remove("show");
      setTimeout(() => {
        if (!customModal.classList.contains("show")) {
          customModal.style.display = "none";
        }
      }, 200);
    }
    activeCustomIdx = null;
  }

  function saveCustomDuration() {
    if (activeCustomIdx === null) return;
    const valStr = customInput ? customInput.value.trim() : "";
    const parsed = parseInt(valStr);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 180) {
      updateDomainDuration(activeCustomIdx, parsed);
      closeCustomDurationModal();
    } else {
      if (modalError) {
        modalError.style.display = "block";
      }
    }
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeCustomDurationModal);
  if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeCustomDurationModal);
  if (modalSaveBtn) modalSaveBtn.addEventListener("click", saveCustomDuration);
  if (customInput) {
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        saveCustomDuration();
      } else if (e.key === "Escape") {
        closeCustomDurationModal();
      }
    });
  }
  if (customModal) {
    customModal.addEventListener("click", (e) => {
      if (e.target === customModal) {
        closeCustomDurationModal();
      }
    });
  }

  // Custom Confirmation Modal Logic
  let confirmCallback = null;
  const confirmModal = document.getElementById("confirm-modal");
  const confirmTitle = document.getElementById("confirm-modal-title");
  const confirmText = document.getElementById("confirm-modal-text");
  const confirmCloseBtn = document.getElementById("confirm-modal-close");
  const confirmCancelBtn = document.getElementById("confirm-modal-cancel-btn");
  const confirmConfirmBtn = document.getElementById("confirm-modal-confirm-btn");

  function showConfirmModal(title, text, onConfirm) {
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmText) confirmText.textContent = text;
    confirmCallback = onConfirm;
    
    if (confirmModal) {
      confirmModal.style.display = "flex";
      void confirmModal.offsetWidth;
      confirmModal.classList.add("show");
    }
  }

  function closeConfirmModal() {
    if (confirmModal) {
      confirmModal.classList.remove("show");
      setTimeout(() => {
        if (!confirmModal.classList.contains("show")) {
          confirmModal.style.display = "none";
        }
      }, 200);
    }
    confirmCallback = null;
  }

  if (confirmCloseBtn) confirmCloseBtn.addEventListener("click", closeConfirmModal);
  if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", closeConfirmModal);
  if (confirmConfirmBtn) {
    confirmConfirmBtn.addEventListener("click", () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });
  }
  if (confirmModal) {
    confirmModal.addEventListener("click", (e) => {
      if (e.target === confirmModal) {
        closeConfirmModal();
      }
    });
  }

  // Init
  loadSettings();
})();
