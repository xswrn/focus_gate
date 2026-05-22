/* FocusGate — Background Service Worker */

let cache = {
  blocklist: [],
  paused: false,
  promptText: "Why do you need this right now?",
  blurBlocked: true
};
let isCacheLoaded = false;
let cachePromise = null;

function sanitizeSyncData(data) {
  if (!data || typeof data !== "object") {
    data = {};
  }
  const sanitized = {};

  if (Array.isArray(data.blocklist)) {
    sanitized.blocklist = data.blocklist.map(entry => {
      if (entry && typeof entry === "object" && typeof entry.domain === "string") {
        const cleanDomain = entry.domain.trim().replace(/\.$/, "").toLowerCase().substring(0, 253);
        if (cleanDomain) {
          return {
            domain: cleanDomain,
            holdDuration: typeof entry.holdDuration === "number" && !isNaN(entry.holdDuration)
              ? Math.max(1, Math.min(180, entry.holdDuration))
              : 5
          };
        }
      } else if (typeof entry === "string") {
        const cleanDomain = entry.trim().replace(/\.$/, "").toLowerCase().substring(0, 253);
        if (cleanDomain) {
          return { domain: cleanDomain, holdDuration: 5 };
        }
      }
      return null;
    }).filter(Boolean);
  } else {
    sanitized.blocklist = [];
  }

  sanitized.paused = typeof data.paused === "boolean" ? data.paused : false;

  if (typeof data.promptText === "string") {
    sanitized.promptText = data.promptText.trim().substring(0, 100) || "Why do you need this right now?";
  } else {
    sanitized.promptText = "Why do you need this right now?";
  }

  sanitized.blurBlocked = typeof data.blurBlocked === "boolean" ? data.blurBlocked : true;

  return sanitized;
}

function loadCache() {
  if (cachePromise) return cachePromise;
  cachePromise = browser.storage.sync.get({
    blocklist: [],
    paused: false,
    promptText: "Why do you need this right now?",
    blurBlocked: true
  }).then(data => {
    cache = sanitizeSyncData(data);
    isCacheLoaded = true;
    return cache;
  }).catch(err => {
    cachePromise = null;
    return cache;
  });
  return cachePromise;
}

// Hydrate on startup
loadCache();

// Keep synced with options
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes && typeof changes === "object") {
    const rawData = {};
    Object.keys(cache).forEach(k => {
      rawData[k] = cache[k];
    });
    for (const [key, change] of Object.entries(changes)) {
      if (change && typeof change === "object" && change.newValue !== undefined) {
        rawData[key] = change.newValue;
      }
    }
    cache = sanitizeSyncData(rawData);
  }
});

// Shared helper to guarantee identical domain normalization
function getNormalizedDomainInfo(hostname) {
  const host = (hostname || "").replace(/\.$/, "").toLowerCase();
  const matched = cache.blocklist.find(entry => {
    const domain = typeof entry === "string" ? entry : entry.domain;
    return host === domain || host.endsWith("." + domain);
  });
  const domainStr = matched ? (typeof matched === "string" ? matched : matched.domain) : host;
  return { domainStr, matched };
}

// Listen for messages from content scripts and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  switch (message.type) {
    case "INIT_CHECK":
      if (tabId == null || !Number.isInteger(tabId)) {
        sendResponse({ error: "invalid_tab" });
        return false;
      }

      const processCheck = async () => {
        if (!isCacheLoaded) await loadCache();

        if (cache.paused) {
          return { hasGrace: false, blocked: false };
        }

        const { domainStr, matched } = getNormalizedDomainInfo(message.hostname);

        if (matched) {
          const alarm = await browser.alarms.get(`timer_${tabId}_${domainStr}`);
          if (alarm) {
            return { hasGrace: true, blocked: false };
          }
        }

        if (matched) {
          const holdDuration = (typeof matched === "object" && matched.holdDuration !== undefined) 
            ? matched.holdDuration : 3;
          return {
            hasGrace: false,
            blocked: true,
            settings: {
              holdDuration,
              promptText: cache.promptText,
              blurBlocked: cache.blurBlocked
            }
          };
        }

        return { hasGrace: false, blocked: false };
      };

      processCheck().then(sendResponse);
      return true;

    case "START_TIMER":
      if (tabId != null && Number.isInteger(tabId)) {
        const { domainStr } = getNormalizedDomainInfo(message.hostname);
        const safeDuration = Math.max(1, Math.min(180, Number(message.duration) || 5));
        browser.alarms.create(`timer_${tabId}_${domainStr}`, { delayInMinutes: safeDuration });
      }
      return false;

    case "CLOSE_TAB":
      if (tabId != null && Number.isInteger(tabId)) {
        browser.tabs.remove(tabId);
      }
      return false;

    case "GET_BLOCKLIST_COUNT":
      if (isCacheLoaded) {
        sendResponse({ count: cache.blocklist.length });
        return false;
      } else {
        loadCache().then(c => sendResponse({ count: c.blocklist.length }));
        return true;
      }

    default:
      return false;
  }
});

// Clean up timers when tabs are closed
browser.tabs.onRemoved.addListener((tabId) => {
  browser.alarms.getAll().then(alarms => {
    alarms.forEach(alarm => {
      if (alarm.name.startsWith(`timer_${tabId}_`)) {
        browser.alarms.clear(alarm.name);
      }
    });
  });
});

// Handle alarms (timer expiration)
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("timer_")) {
    const tabId = parseInt(alarm.name.split("_")[1], 10);
    // Send message to content script to re-show overlay
    browser.tabs.sendMessage(tabId, { type: "TIMER_EXPIRED" }).catch(() => {
      // Tab may have been closed
    });
  }
});

