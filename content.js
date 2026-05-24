/* FocusGate — Content Script */
(function () {
  "use strict";

  let overlayHost = null;
  let shadowRoot = null;
  let isOverlayVisible = false;
  let overlayAbortController = null;

  const currentHostname = location.hostname.replace(/\.+$/, "").toLowerCase();

  // Inject startup shield style synchronously to prevent Flash of Unblocked Content (FOUC)
  const shield = document.createElement("style");
  shield.textContent = "html { display: none !important; }";
  document.documentElement.appendChild(shield);

  // Auto-remove shield after 200ms to prevent perceived slowness on non-blocked pages
  // during service worker cold starts. If the page is blocked, the overlay will cover it.
  const shieldTimeout = setTimeout(removeShield, 200);

  function removeShield() {
    clearTimeout(shieldTimeout);
    if (shield && shield.parentNode) {
      shield.parentNode.removeChild(shield);
    }
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const RETRY_DELAYS = [0, 100, 250, 500, 1000];

  async function init(attempt = 0) {
    try {
      const resp = await browser.runtime.sendMessage({
        type: "INIT_CHECK",
        hostname: currentHostname
      });

      // Success — clear any fallback overlay that may be showing
      removeFallbackOverlay();

      if (resp && resp.blocked && !resp.hasGrace) {
        showOverlay(false, resp.settings);
      } else {
        removeShield();
      }
    } catch (e) {
      if (attempt < RETRY_DELAYS.length - 1) {
        const delay = RETRY_DELAYS[attempt + 1];
        setTimeout(() => init(attempt + 1), delay);
      } else {
        // All retries exhausted — fail safe, never fail open
        showFallbackOverlay();
      }
    }
  }

  // Lightweight fallback overlay shown when background cannot be reached
  let fallbackHost = null;

  function showFallbackOverlay() {
    if (fallbackHost || isOverlayVisible) return;

    fallbackHost = document.createElement("div");
    fallbackHost.id = "focusgate-fallback-host";
    fallbackHost.style.cssText = "all:initial;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;";
    document.documentElement.appendChild(fallbackHost);
    removeShield();
    const shadow = fallbackHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      .fg-fallback {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(8, 10, 18, 0.96);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e2e4ea;
        animation: fg-fbIn 0.3s ease;
      }
      @keyframes fg-fbIn { from { opacity: 0; } to { opacity: 1; } }
      .fg-fb-card {
        background: #13151e;
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 20px;
        width: 92vw; max-width: 420px;
        padding: 40px 32px;
        display: flex; flex-direction: column; align-items: center;
        gap: 20px;
        box-shadow: 0 0 80px rgba(99, 102, 241, 0.08), 0 4px 32px rgba(0,0,0,0.5);
        text-align: center;
      }
      .fg-fb-icon {
        width: 48px; height: 48px;
        background: rgba(99, 102, 241, 0.12);
        border: 2px solid rgba(99, 102, 241, 0.3);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
      }
      .fg-fb-icon svg { width: 24px; height: 24px; }
      .fg-fb-spinner {
        animation: fg-spin 1.2s linear infinite;
      }
      @keyframes fg-spin { to { transform: rotate(360deg); } }
      .fg-fb-title {
        font-size: 20px; font-weight: 700; color: #f0f1f5;
        letter-spacing: -0.3px;
      }
      .fg-fb-subtitle {
        font-size: 14px; color: #8b8fa3; line-height: 1.5;
      }
      .fg-fb-retry {
        padding: 12px 28px;
        background: linear-gradient(135deg, #6366f1 0%, #4f8cff 100%);
        border: none; border-radius: 12px;
        color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 600;
        cursor: pointer; transition: all 0.2s;
      }
      .fg-fb-retry:hover { filter: brightness(1.08); }
      .fg-fb-retry:active { filter: brightness(0.95); }
    `;
    shadow.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "fg-fallback";
    wrapper.innerHTML = `
      <div class="fg-fb-card">
        <div class="fg-fb-icon">
          <svg class="fg-fb-spinner" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
        <div class="fg-fb-title">FocusGate is starting&hellip;</div>
        <div class="fg-fb-subtitle">Please wait a moment while the extension initializes.<br>If this persists, click Retry.</div>
        <button class="fg-fb-retry">Retry</button>
      </div>
    `;
    shadow.appendChild(wrapper);

    shadow.querySelector(".fg-fb-retry").addEventListener("click", () => {
      init(0);
    });
  }

  function removeFallbackOverlay() {
    if (fallbackHost && fallbackHost.parentNode) {
      fallbackHost.parentNode.removeChild(fallbackHost);
    }
    fallbackHost = null;
  }

  // Listen for timer expiry from background
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "TIMER_EXPIRED") {
      browser.runtime.sendMessage({
        type: "INIT_CHECK",
        hostname: currentHostname
      }).then(resp => {
        if (resp && resp.settings) {
          showOverlay(true, resp.settings);
        }
      }).catch(() => {});
    }
  });

  function showOverlay(isReappear = false, settings = {}) {
    if (isOverlayVisible) return;
    isOverlayVisible = true;

    let holdDuration = parseInt(settings.holdDuration, 10);
    if (isNaN(holdDuration) || holdDuration < 1 || holdDuration > 180) {
      holdDuration = 3;
    }
    let promptText = typeof settings.promptText === "string" ? settings.promptText : "Why do you need this right now?";
    if (promptText.length > 100) {
      promptText = promptText.substring(0, 100);
    }
    const blurBlocked = settings.blurBlocked !== false; // default true

    // Create Shadow DOM host
    overlayHost = document.createElement("div");
    overlayHost.id = "focusgate-overlay-host";
    overlayHost.style.cssText = "all:initial;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;";
    document.documentElement.appendChild(overlayHost);
    removeShield();
    shadowRoot = overlayHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = getOverlayCSS(holdDuration, blurBlocked);
    shadowRoot.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "fg-overlay";
    wrapper.appendChild(getOverlayHTML(promptText, holdDuration, isReappear));
    shadowRoot.appendChild(wrapper);

    overlayAbortController = new AbortController();

    // Bind events
    bindOverlayEvents(shadowRoot, holdDuration);
  }

  function removeOverlay() {
    if (overlayAbortController) {
      overlayAbortController.abort();
      overlayAbortController = null;
    }
    if (overlayHost && overlayHost.parentNode) {
      overlayHost.parentNode.removeChild(overlayHost);
    }
    overlayHost = null;
    shadowRoot = null;
    isOverlayVisible = false;
  }

  function getOverlayCSS(holdSec, blurBlocked) {
    const blurStyle = blurBlocked 
      ? "backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);" 
      : "";

    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .fg-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(8, 10, 18, 0.94);
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e2e4ea;
        ${blurStyle}
        animation: fg-fadeIn 0.35s ease;
      }

      @keyframes fg-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .fg-card {
        background: #13151e;
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 20px;
        width: 92vw; max-width: 500px;
        padding: 36px 32px 28px;
        display: flex; flex-direction: column; align-items: center;
        gap: 0;
        box-shadow: 0 0 80px rgba(99, 102, 241, 0.08), 0 4px 32px rgba(0,0,0,0.5);
        position: relative;
        animation: fg-slideUp 0.4s ease;
      }

      @keyframes fg-slideUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Status badge */
      .fg-badge {
        position: absolute; top: 18px; right: 20px;
        display: flex; align-items: center; gap: 6px;
        background: rgba(99, 102, 241, 0.12);
        border: 1px solid rgba(99, 102, 241, 0.25);
        border-radius: 20px;
        padding: 5px 14px;
        font-size: 12px;
        color: #a5b4fc;
        font-weight: 500;
      }
      .fg-badge-dot {
        width: 7px; height: 7px;
        background: #6366f1;
        border-radius: 50%;
        box-shadow: 0 0 6px #6366f1;
      }

      /* Clock icon */
      .fg-clock-icon {
        width: 48px; height: 48px;
        background: rgba(99, 102, 241, 0.12);
        border: 2px solid rgba(99, 102, 241, 0.3);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 20px;
        margin-top: 4px;
      }
      .fg-clock-icon svg { width: 24px; height: 24px; }

      /* Title */
      .fg-title {
        font-size: 24px; font-weight: 700;
        color: #f0f1f5;
        text-align: center;
        margin-bottom: 6px;
        letter-spacing: -0.3px;
      }

      .fg-subtitle {
        font-size: 14px;
        color: #8b8fa3;
        margin-bottom: 18px;
        text-align: center;
      }
      .fg-subtitle a {
        color: #818cf8;
        text-decoration: none;
      }

      /* Divider */
      .fg-divider {
        width: 100%;
        height: 1px;
        background: rgba(255,255,255,0.06);
        margin: 4px 0 18px;
      }

      /* Reappear info */
      .fg-reappear-info {
        text-align: center;
        font-size: 13.5px;
        color: #8b8fa3;
        margin-bottom: 20px;
        line-height: 1.5;
      }
      .fg-reappear-info strong {
        color: #818cf8;
        font-weight: 600;
      }

      /* Textarea */
      .fg-textarea-wrap {
        width: 100%;
        margin-bottom: 6px;
      }
      .fg-textarea {
        width: 100%;
        min-height: 90px;
        background: #1a1d2b;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        color: #e2e4ea;
        font-family: inherit;
        font-size: 14px;
        padding: 14px 16px;
        resize: vertical;
        outline: none;
        transition: border-color 0.2s;
      }
      .fg-textarea::placeholder { color: #4a4e63; }
      .fg-textarea:focus { border-color: rgba(99, 102, 241, 0.5); }

      .fg-textarea-hint {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 12px; color: #5a5e73;
        padding: 6px 2px 0;
        margin-bottom: 18px;
      }
      .fg-textarea-hint svg { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }

      /* Slider section */
      .fg-slider-section {
        width: 100%;
        margin-bottom: 14px;
      }
      .fg-slider-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 10px;
      }
      .fg-slider-label {
        font-size: 14px;
        font-weight: 600;
        color: #c8cad3;
      }
      .fg-slider-value {
        font-size: 14px;
        font-weight: 700;
        color: #818cf8;
      }
      .fg-slider-track {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 12px;
      }
      .fg-slider-bound {
        font-size: 11px; color: #5a5e73; white-space: nowrap;
        min-width: 36px;
      }
      .fg-slider-bound.right { text-align: right; }

      input[type="range"].fg-range {
        -webkit-appearance: none;
        appearance: none;
        flex: 1;
        height: 6px;
        background: #252838;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
      }
      input[type="range"].fg-range::-moz-range-track {
        height: 6px;
        background: #252838;
        border-radius: 3px;
        border: none;
      }
      input[type="range"].fg-range::-moz-range-thumb {
        width: 18px; height: 18px;
        border-radius: 50%;
        background: #818cf8;
        border: 3px solid #13151e;
        cursor: pointer;
        box-shadow: 0 0 8px rgba(99,102,241,0.4);
      }
      input[type="range"].fg-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px; height: 18px;
        border-radius: 50%;
        background: #818cf8;
        border: 3px solid #13151e;
        cursor: pointer;
        box-shadow: 0 0 8px rgba(99,102,241,0.4);
      }

      /* Preset buttons */
      .fg-presets {
        display: flex; gap: 8px; flex-wrap: wrap;
        margin-bottom: 20px;
      }
      .fg-preset-btn {
        flex: 1; min-width: 60px;
        padding: 8px 4px;
        background: #1a1d2b;
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px;
        color: #b0b3c5;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      .fg-preset-btn:hover {
        background: #22253a;
        border-color: rgba(99,102,241,0.3);
        color: #d0d2e0;
      }
      .fg-preset-btn.active {
        background: rgba(99, 102, 241, 0.18);
        border-color: #6366f1;
        color: #a5b4fc;
        font-weight: 600;
      }

      /* Button row */
      .fg-buttons {
        display: flex; gap: 12px; width: 100%;
        margin-bottom: 16px;
      }

      /* Exit button */
      .fg-exit-btn {
        flex: 0 0 38%;
        display: flex; align-items: center; justify-content: center; gap: 10px;
        padding: 16px 12px;
        background: #1a1d2b;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        color: #c8cad3;
        font-family: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .fg-exit-btn:hover {
        background: #22253a;
        border-color: rgba(255,255,255,0.12);
      }
      .fg-exit-btn svg { width: 18px; height: 18px; }
      .fg-exit-sub {
        font-size: 11.5px; color: #5a5e73; font-weight: 400;
      }
      .fg-exit-inner { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }

      /* Proceed button */
      .fg-proceed-btn {
        flex: 1;
        display: flex; align-items: center; gap: 14px;
        padding: 18px 22px;
        background: linear-gradient(135deg, #6366f1 0%, #4f8cff 100%);
        border: none;
        border-radius: 14px;
        color: #fff;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      .fg-proceed-btn:hover {
        filter: brightness(1.08);
      }
      .fg-proceed-btn:active {
        filter: brightness(0.95);
      }

      .fg-proceed-inner {
        display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
        z-index: 2;
        line-height: 1.3;
      }
      .fg-proceed-sub {
        font-size: 11px;
        font-weight: 400;
        opacity: 0.8;
        line-height: 1.35;
      }

      /* Progress ring */
      .fg-ring-wrap {
        width: 40px; height: 40px;
        position: relative;
        flex-shrink: 0;
        z-index: 2;
      }
      .fg-ring-bg {
        fill: none;
        stroke: rgba(255,255,255,0.2);
        stroke-width: 3;
      }
      .fg-ring-progress {
        fill: none;
        stroke: #fff;
        stroke-width: 3;
        stroke-linecap: round;
        stroke-dasharray: 113;
        stroke-dashoffset: 113;
        transform: rotate(-90deg);
        transform-origin: center;
        transition: none;
      }
      .fg-ring-dot {
        fill: #fff;
        cx: 20;
        cy: 20;
        r: 5;
      }

      /* Fill bar behind proceed button */
      .fg-proceed-fill {
        position: absolute; top: 0; left: 0;
        height: 100%;
        width: 0%;
        background: rgba(255,255,255,0.10);
        transition: none;
        z-index: 1;
        border-radius: 14px;
      }

      /* Shake animation */
      @keyframes fg-shake {
        0%, 100% { transform: translateX(0); }
        15% { transform: translateX(-6px); }
        30% { transform: translateX(5px); }
        45% { transform: translateX(-4px); }
        60% { transform: translateX(3px); }
        75% { transform: translateX(-2px); }
      }
      .fg-shake {
        animation: fg-shake 0.45s ease;
      }

      /* Footer text */
      .fg-footer {
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px;
        color: #5a5e73;
        text-align: center;
        line-height: 1.5;
      }
      .fg-footer svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.6; }
      .fg-footer strong { color: #818cf8; font-weight: 600; }

      /* Responsive */
      @media (max-width: 540px) {
        .fg-card { padding: 28px 18px 22px; }
        .fg-title { font-size: 20px; }
        .fg-buttons { flex-direction: column-reverse; }
        .fg-exit-btn { flex: 1; }
      }

      /* Firefox range filled track */
      input[type="range"].fg-range::-moz-range-progress {
        background: #6366f1;
        border-radius: 3px;
        height: 6px;
        transition: background 0.4s ease;
      }
      input[type="range"].fg-range.warning-track::-moz-range-progress {
        background: linear-gradient(to right, #6366f1, #ef4444);
      }
      input[type="range"].fg-range::-moz-range-thumb {
        transition: background 0.4s ease, box-shadow 0.4s ease;
      }
      input[type="range"].fg-range.warning-track::-moz-range-thumb {
        background: #ef4444;
        border: 3px solid #13151e;
        box-shadow: 0 0 8px rgba(239,68,68,0.4);
      }
      input[type="range"].fg-range.warning-track::-webkit-slider-thumb {
        -webkit-appearance: none;
        background: #ef4444;
        border: 3px solid #13151e;
        box-shadow: 0 0 8px rgba(239,68,68,0.4);
      }

      /* Duration warning card — smooth reveal */
      .fg-warning {
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
        background: rgba(239, 68, 68, 0.06);
        border: 1px solid rgba(239, 68, 68, 0.15);
        border-radius: 12px;
        padding: 14px 18px;
        margin-bottom: 20px;
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        padding-top: 0;
        padding-bottom: 0;
        margin-bottom: 0;
        border-width: 0;
        transition: max-height 0.4s ease, opacity 0.35s ease, padding 0.4s ease, margin-bottom 0.4s ease, border-width 0.3s ease;
      }
      .fg-warning.show {
        max-height: 120px;
        opacity: 1;
        padding: 14px 18px;
        margin-bottom: 20px;
        border-width: 1px;
      }
      .fg-warning-icon {
        width: 44px; height: 44px;
        background: rgba(239, 68, 68, 0.1);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        position: relative;
      }
      .fg-warning-icon svg { width: 22px; height: 22px; }
      .fg-warning-badge {
        position: absolute; bottom: -2px; right: -2px;
        width: 18px; height: 18px;
        background: #13151e;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
      }
      .fg-warning-badge svg { width: 12px; height: 12px; }
      .fg-warning-separator {
        width: 2px;
        align-self: stretch;
        background: rgba(239, 68, 68, 0.25);
        border-radius: 1px;
        flex-shrink: 0;
      }
      .fg-warning-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .fg-warning-title {
        font-size: 14px;
        font-weight: 700;
        color: #ef4444;
        line-height: 1.3;
      }
      .fg-warning-desc {
        font-size: 12.5px;
        color: #8b8fa3;
        line-height: 1.45;
      }

      /* Warning state - slider value text with smooth color transition */
      .fg-slider-value {
        transition: color 0.4s ease;
      }
      .fg-slider-value.warning {
        color: #ef4444 !important;
      }
    `;
  }

  function getOverlayHTML(promptText, holdDuration, isReappear) {
    const domainText = currentHostname.replace(/^www\./, "");
    const badgeText = isReappear ? "Limit reached" : "Active";
    const titleText = isReappear ? "You've reached your limit." : promptText;

    const card = document.createElement("div");
    card.className = "fg-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "fg-title-id");
    card.setAttribute("aria-describedby", "fg-subtitle-id");

    const badge = document.createElement("div");
    badge.className = "fg-badge";
    const badgeDot = document.createElement("span");
    badgeDot.className = "fg-badge-dot";
    badge.appendChild(badgeDot);
    badge.appendChild(document.createTextNode(badgeText));
    card.appendChild(badge);

    const clockDiv = document.createElement("div");
    clockDiv.className = "fg-clock-icon";

    const svgClock = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgClock.setAttribute("viewBox", "0 0 24 24");
    svgClock.setAttribute("fill", "none");
    svgClock.setAttribute("stroke", "#818cf8");
    svgClock.setAttribute("stroke-width", "2");
    svgClock.setAttribute("stroke-linecap", "round");
    svgClock.setAttribute("stroke-linejoin", "round");

    const clockCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    clockCircle.setAttribute("cx", "12");
    clockCircle.setAttribute("cy", "12");
    clockCircle.setAttribute("r", "10");
    svgClock.appendChild(clockCircle);

    const clockPolyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    clockPolyline.setAttribute("points", "12 6 12 12 16 14");
    svgClock.appendChild(clockPolyline);

    clockDiv.appendChild(svgClock);
    card.appendChild(clockDiv);

    const title = document.createElement("div");
    title.className = "fg-title";
    title.id = "fg-title-id";
    title.textContent = titleText;
    card.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "fg-subtitle";
    subtitle.id = "fg-subtitle-id";
    if (isReappear) {
      subtitle.textContent = "Do you want to continue?";
    } else {
      subtitle.appendChild(document.createTextNode("You're attempting to access "));
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = domainText;
      subtitle.appendChild(link);
    }
    card.appendChild(subtitle);

    const divider = document.createElement("div");
    divider.className = "fg-divider";
    card.appendChild(divider);

    if (isReappear) {
      const reappearInfo = document.createElement("div");
      reappearInfo.className = "fg-reappear-info";
      reappearInfo.appendChild(document.createTextNode("Your access to "));
      const strong = document.createElement("strong");
      strong.textContent = domainText;
      reappearInfo.appendChild(strong);
      reappearInfo.appendChild(document.createTextNode(" has ended."));
      reappearInfo.appendChild(document.createElement("br"));
      reappearInfo.appendChild(document.createTextNode("You can choose to continue, or exit and stay focused."));
      card.appendChild(reappearInfo);
    } else {
      const textareaWrap = document.createElement("div");
      textareaWrap.className = "fg-textarea-wrap";

      const textarea = document.createElement("textarea");
      textarea.className = "fg-textarea";
      textarea.setAttribute("placeholder", "I need to check...");
      textarea.setAttribute("maxlength", "250");
      textarea.setAttribute("aria-label", "Distraction reflection prompt");
      textareaWrap.appendChild(textarea);
      card.appendChild(textareaWrap);

      const textareaHint = document.createElement("div");
      textareaHint.className = "fg-textarea-hint";

      const hintSpan = document.createElement("span");
      
      const svgHint = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgHint.setAttribute("viewBox", "0 0 24 24");
      svgHint.setAttribute("fill", "none");
      svgHint.setAttribute("stroke", "currentColor");
      svgHint.setAttribute("stroke-width", "2");
      svgHint.setAttribute("stroke-linecap", "round");
      svgHint.setAttribute("stroke-linejoin", "round");

      const hintPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hintPath.setAttribute("d", "m 16.474 5.408 l 2.118 2.117 m -6.4 -3.553 l -7.263 7.262 a 1 1 0 0 0 -0.263 0.464 l -0.823 3.704 a 0.5 0.5 0 0 0 0.597 0.597 l 3.704 -0.823 a 1 1 0 0 0 0.464 -0.263 l 7.262 -7.262 a 2 2 0 0 0 0 -2.829 l -0.818 -0.818 a 2 2 0 0 0 -2.83 0 z");
      svgHint.appendChild(hintPath);
      hintSpan.appendChild(svgHint);

      hintSpan.appendChild(document.createTextNode(" Type at least 10 characters to continue"));
      textareaHint.appendChild(hintSpan);

      const charCountSpan = document.createElement("span");
      charCountSpan.className = "fg-char-count";
      charCountSpan.textContent = "0 / 10";
      textareaHint.appendChild(charCountSpan);

      card.appendChild(textareaHint);
    }

    const sliderSection = document.createElement("div");
    sliderSection.className = "fg-slider-section";

    const sliderHeader = document.createElement("div");
    sliderHeader.className = "fg-slider-header";

    const sliderLabel = document.createElement("span");
    sliderLabel.className = "fg-slider-label";
    sliderLabel.textContent = "How long do you need access?";
    sliderHeader.appendChild(sliderLabel);

    const sliderValue = document.createElement("span");
    sliderValue.className = "fg-slider-value";
    sliderValue.textContent = "15 minutes";
    sliderHeader.appendChild(sliderValue);
    sliderSection.appendChild(sliderHeader);

    const sliderTrack = document.createElement("div");
    sliderTrack.className = "fg-slider-track";

    const boundLeft = document.createElement("span");
    boundLeft.className = "fg-slider-bound";
    boundLeft.textContent = "1 min";
    sliderTrack.appendChild(boundLeft);

    const rangeInput = document.createElement("input");
    rangeInput.type = "range";
    rangeInput.className = "fg-range";
    rangeInput.min = "1";
    rangeInput.max = "120";
    rangeInput.value = "15";
    rangeInput.setAttribute("aria-label", "Access duration in minutes");
    sliderTrack.appendChild(rangeInput);

    const boundRight = document.createElement("span");
    boundRight.className = "fg-slider-bound right";
    boundRight.textContent = "120 mins";
    sliderTrack.appendChild(boundRight);
    sliderSection.appendChild(sliderTrack);

    const presets = document.createElement("div");
    presets.className = "fg-presets";

    const presetVals = [
      { val: "5", label: "5 min", active: false },
      { val: "15", label: "15 min", active: true },
      { val: "30", label: "30 min", active: false },
      { val: "60", label: "1 hour", active: false }
    ];

    presetVals.forEach(p => {
      const btn = document.createElement("button");
      btn.className = p.active ? "fg-preset-btn active" : "fg-preset-btn";
      btn.setAttribute("data-val", p.val);
      btn.textContent = p.label;
      presets.appendChild(btn);
    });

    sliderSection.appendChild(presets);
    card.appendChild(sliderSection);

    const warning = document.createElement("div");
    warning.className = "fg-warning";
    warning.id = "fg-warning";

    const warningIcon = document.createElement("div");
    warningIcon.className = "fg-warning-icon";

    const svgWarning = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgWarning.setAttribute("viewBox", "0 0 24 24");
    svgWarning.setAttribute("fill", "none");
    svgWarning.setAttribute("stroke", "#ef4444");
    svgWarning.setAttribute("stroke-width", "2");
    svgWarning.setAttribute("stroke-linecap", "round");
    svgWarning.setAttribute("stroke-linejoin", "round");

    const warnCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    warnCircle.setAttribute("cx", "12");
    warnCircle.setAttribute("cy", "12");
    warnCircle.setAttribute("r", "10");
    svgWarning.appendChild(warnCircle);

    const warnPolyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    warnPolyline.setAttribute("points", "12 6 12 12 16 14");
    svgWarning.appendChild(warnPolyline);
    warningIcon.appendChild(svgWarning);

    const warningBadge = document.createElement("div");
    warningBadge.className = "fg-warning-badge";

    const svgBadge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgBadge.setAttribute("viewBox", "0 0 24 24");
    svgBadge.setAttribute("fill", "#ef4444");
    svgBadge.setAttribute("stroke", "none");

    const badgePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    badgePath.setAttribute("d", "M12 2L2 20h20L12 2zm0 14a1 1 0 110 2 1 1 0 010-2zm-1-8h2v6h-2V8z");
    svgBadge.appendChild(badgePath);
    warningBadge.appendChild(svgBadge);
    warningIcon.appendChild(warningBadge);
    warning.appendChild(warningIcon);

    const separator = document.createElement("div");
    separator.className = "fg-warning-separator";
    warning.appendChild(separator);

    const warningText = document.createElement("div");
    warningText.className = "fg-warning-text";

    const warningTitle = document.createElement("div");
    warningTitle.className = "fg-warning-title";
    warningTitle.textContent = "That's a long time.";
    warningText.appendChild(warningTitle);

    const warningDesc = document.createElement("div");
    warningDesc.className = "fg-warning-desc";
    warningDesc.appendChild(document.createTextNode("You might not need this much time."));
    warningDesc.appendChild(document.createElement("br"));
    warningDesc.appendChild(document.createTextNode("Take a moment to make sure it's necessary."));
    warningText.appendChild(warningDesc);
    warning.appendChild(warningText);
    card.appendChild(warning);

    const buttons = document.createElement("div");
    buttons.className = "fg-buttons";

    const exitBtn = document.createElement("button");
    exitBtn.className = "fg-exit-btn";
    exitBtn.id = "fg-exit";

    const svgCross = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgCross.setAttribute("viewBox", "0 0 24 24");
    svgCross.setAttribute("fill", "none");
    svgCross.setAttribute("stroke", "currentColor");
    svgCross.setAttribute("stroke-width", "2.5");
    svgCross.setAttribute("stroke-linecap", "round");
    svgCross.setAttribute("stroke-linejoin", "round");

    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "18");
    line1.setAttribute("y1", "6");
    line1.setAttribute("x2", "6");
    line1.setAttribute("y2", "18");
    svgCross.appendChild(line1);

    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "6");
    line2.setAttribute("y1", "6");
    line2.setAttribute("x2", "18");
    line2.setAttribute("y2", "18");
    svgCross.appendChild(line2);
    exitBtn.appendChild(svgCross);

    const exitInner = document.createElement("div");
    exitInner.className = "fg-exit-inner";

    const exitTitleSpan = document.createElement("span");
    exitTitleSpan.textContent = "Exit";
    exitInner.appendChild(exitTitleSpan);

    const exitSubSpan = document.createElement("span");
    exitSubSpan.className = "fg-exit-sub";
    exitSubSpan.textContent = "Close this tab";
    exitInner.appendChild(exitSubSpan);
    exitBtn.appendChild(exitInner);
    buttons.appendChild(exitBtn);

    const proceedBtn = document.createElement("button");
    proceedBtn.className = "fg-proceed-btn";
    proceedBtn.id = "fg-proceed";

    const ringWrap = document.createElement("div");
    ringWrap.className = "fg-ring-wrap";

    const svgRing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgRing.setAttribute("viewBox", "0 0 40 40");

    const circleBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circleBg.setAttribute("class", "fg-ring-bg");
    circleBg.setAttribute("cx", "20");
    circleBg.setAttribute("cy", "20");
    circleBg.setAttribute("r", "18");
    svgRing.appendChild(circleBg);

    const circleProgress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circleProgress.setAttribute("class", "fg-ring-progress");
    circleProgress.setAttribute("cx", "20");
    circleProgress.setAttribute("cy", "20");
    circleProgress.setAttribute("r", "18");
    svgRing.appendChild(circleProgress);

    const circleDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circleDot.setAttribute("class", "fg-ring-dot");
    circleDot.setAttribute("cx", "20");
    circleDot.setAttribute("cy", "20");
    circleDot.setAttribute("r", "5");
    svgRing.appendChild(circleDot);

    ringWrap.appendChild(svgRing);
    proceedBtn.appendChild(ringWrap);

    const proceedInner = document.createElement("div");
    proceedInner.className = "fg-proceed-inner";

    const proceedSpan = document.createElement("span");
    proceedSpan.textContent = "Hold to Proceed";
    proceedInner.appendChild(proceedSpan);

    const proceedSub = document.createElement("span");
    proceedSub.className = "fg-proceed-sub";
    proceedSub.textContent = "Hold for " + holdDuration + " seconds to continue.";
    proceedInner.appendChild(proceedSub);
    proceedBtn.appendChild(proceedInner);

    const proceedFill = document.createElement("div");
    proceedFill.className = "fg-proceed-fill";
    proceedBtn.appendChild(proceedFill);
    buttons.appendChild(proceedBtn);
    card.appendChild(buttons);

    const footer = document.createElement("div");
    footer.className = "fg-footer";

    const svgLock = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgLock.setAttribute("viewBox", "0 0 24 24");
    svgLock.setAttribute("fill", "none");
    svgLock.setAttribute("stroke", "currentColor");
    svgLock.setAttribute("stroke-width", "2");
    svgLock.setAttribute("stroke-linecap", "round");
    svgLock.setAttribute("stroke-linejoin", "round");

    const lockRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    lockRect.setAttribute("x", "3");
    lockRect.setAttribute("y", "11");
    lockRect.setAttribute("width", "18");
    lockRect.setAttribute("height", "11");
    lockRect.setAttribute("rx", "2");
    lockRect.setAttribute("ry", "2");
    svgLock.appendChild(lockRect);

    const lockPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    lockPath.setAttribute("d", "M7 11V7a5 5 0 0 1 10 0v4");
    svgLock.appendChild(lockPath);
    footer.appendChild(svgLock);

    const footerSpan = document.createElement("span");
    footerSpan.textContent = "Each time you continue, it gets harder to break the cycle.";
    footer.appendChild(footerSpan);
    card.appendChild(footer);

    return card;
  }

  function bindOverlayEvents(root, holdDuration) {
    const slider = root.querySelector(".fg-range");
    const sliderValue = root.querySelector(".fg-slider-value");
    const presets = root.querySelectorAll(".fg-preset-btn");
    const textarea = root.querySelector(".fg-textarea");
    const charCount = root.querySelector(".fg-char-count");
    const exitBtn = root.querySelector("#fg-exit");
    const proceedBtn = root.querySelector("#fg-proceed");
    const ringProgress = root.querySelector(".fg-ring-progress");
    const fillBar = root.querySelector(".fg-proceed-fill");
    const warningCard = root.querySelector("#fg-warning");

    let sliderVal = 15;
    let holdTimer = null;
    let holdStart = 0;
    let animFrame = null;
    let shakeTimer = null;
    const holdMs = holdDuration * 1000;
    const circumference = 2 * Math.PI * 18; // ~113

    // Check if proceed should be enabled (for reappear mode there's no textarea)
    function canProceed() {
      if (!textarea) return true;
      return textarea.value.trim().length >= 10;
    }

    function updateProceedState() {
      if (proceedBtn) {
        proceedBtn.style.opacity = canProceed() ? "1" : "0.5";
        proceedBtn.style.pointerEvents = canProceed() ? "auto" : "none";
      }
    }

    // Show/hide duration warning when slider exceeds 1 hour
    function updateWarningState(val) {
      if (warningCard) {
        if (val > 60) {
          warningCard.classList.add('show');
        } else {
          warningCard.classList.remove('show');
        }
      }
      if (sliderValue) {
        if (val > 60) {
          sliderValue.classList.add('warning');
        } else {
          sliderValue.classList.remove('warning');
        }
      }
      // Toggle warning styling on slider track
      if (slider) {
        if (val > 60) {
          slider.classList.add('warning-track');
        } else {
          slider.classList.remove('warning-track');
        }
      }
    }

    // Textarea character count
    if (textarea && charCount) {
      textarea.addEventListener("input", () => {
        const len = textarea.value.trim().length;
        charCount.textContent = `${len} / 10`;
        updateProceedState();
      });
    }

    // Always initialize proceed button state (critical for reappear mode where there's no textarea)
    updateProceedState();

    // Slider
    if (slider) {
      slider.addEventListener("input", () => {
        sliderVal = parseInt(slider.value);
        sliderValue.textContent = sliderVal === 1 ? "1 minute" : `${sliderVal} minutes`;
        presets.forEach(btn => {
          btn.classList.toggle("active", parseInt(btn.dataset.val) === sliderVal);
        });
        updateWarningState(sliderVal);
      });
    }

    // Preset buttons
    presets.forEach(btn => {
      btn.addEventListener("click", () => {
        sliderVal = parseInt(btn.dataset.val);
        slider.value = sliderVal;
        sliderValue.textContent = sliderVal === 1 ? "1 minute" : `${sliderVal} minutes`;
        presets.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        updateWarningState(sliderVal);
      });
    });

    // Exit button
    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        browser.runtime.sendMessage({ type: "CLOSE_TAB" }).catch(() => {});
        // Fallback
        try { window.close(); } catch (e) {}
      });
    }

    // Proceed hold logic
    if (proceedBtn) {
      function resetProgress() {
        if (animFrame) cancelAnimationFrame(animFrame);
        animFrame = null;
        holdTimer = null;
        holdStart = 0;
        if (ringProgress) {
          ringProgress.style.strokeDashoffset = circumference;
          ringProgress.style.transition = "none";
        }
        if (fillBar) {
          fillBar.style.width = "0%";
          fillBar.style.transition = "none";
        }
      }

      function animateProgress() {
        const elapsed = Date.now() - holdStart;
        const progress = Math.min(elapsed / holdMs, 1);
        const offset = circumference * (1 - progress);

        if (ringProgress) {
          ringProgress.style.strokeDashoffset = offset;
        }
        if (fillBar) {
          fillBar.style.width = `${progress * 100}%`;
        }

        if (progress >= 1) {
          // Hold complete — proceed
          onProceedSuccess();
          return;
        }
        animFrame = requestAnimationFrame(animateProgress);
      }

      function onProceedSuccess() {
        // Start background timer
        browser.runtime.sendMessage({
          type: "START_TIMER",
          duration: sliderVal,
          hostname: currentHostname
        }).catch(() => {});
        removeOverlay();
      }

      let isKeyboardHolding = false;

      proceedBtn.addEventListener("pointerdown", (e) => {
        if (!canProceed()) return;
        e.preventDefault();
        resetProgress();
        holdStart = Date.now();
        animFrame = requestAnimationFrame(animateProgress);
      });

      proceedBtn.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          if (!canProceed()) return;
          e.preventDefault();
          if (isKeyboardHolding) return;
          isKeyboardHolding = true;
          resetProgress();
          holdStart = Date.now();
          animFrame = requestAnimationFrame(animateProgress);
        }
      });

      const cancelHold = () => {
        isKeyboardHolding = false;
        if (!holdStart) return;
        const elapsed = Date.now() - holdStart;
        resetProgress();
        if (elapsed > 0 && elapsed < holdMs) {
          if (shakeTimer) {
            clearTimeout(shakeTimer);
            proceedBtn.classList.remove("fg-shake");
            void proceedBtn.offsetWidth; // Force reflow to restart animation smoothly
          }
          proceedBtn.classList.add("fg-shake");
          shakeTimer = setTimeout(() => {
            proceedBtn.classList.remove("fg-shake");
            shakeTimer = null;
          }, 500);
        }
      };

      proceedBtn.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          cancelHold();
        }
      });

      proceedBtn.addEventListener("blur", cancelHold);

      document.addEventListener("pointerup", cancelHold, { signal: overlayAbortController.signal });
      document.addEventListener("pointercancel", cancelHold, { signal: overlayAbortController.signal });
      window.addEventListener("blur", cancelHold, { signal: overlayAbortController.signal });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancelHold();
      }, { signal: overlayAbortController.signal });

      // Focus trapping to prevent keyboard escape into the parent document
      root.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          const focusableElements = Array.from(
            root.querySelectorAll('textarea, input, button')
          ).filter(el => !el.disabled && el.tabIndex !== -1);

          if (focusableElements.length === 0) return;

          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];
          const activeEl = root.activeElement;

          if (e.shiftKey) {
            if (activeEl === firstElement || !focusableElements.includes(activeEl)) {
              lastElement.focus();
              e.preventDefault();
            }
          } else {
            if (activeEl === lastElement || !focusableElements.includes(activeEl)) {
              firstElement.focus();
              e.preventDefault();
            }
          }
        }
      });

      // Auto-focus textarea or first focusable element
      if (textarea) {
        textarea.focus();
      } else {
        const firstEl = root.querySelector('input, button');
        if (firstEl) firstEl.focus();
      }
    }
  }

  init();
})();
