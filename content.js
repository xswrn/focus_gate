/* FocusGate — Content Script */
(function () {
  "use strict";

  let overlayHost = null;
  let shadowRoot = null;
  let isOverlayVisible = false;
  let overlayAbortController = null;

  const currentHostname = location.hostname;

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
    shadowRoot = overlayHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = getOverlayCSS(holdDuration, blurBlocked);
    shadowRoot.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "fg-overlay";
    wrapper.innerHTML = getOverlayHTML(promptText, holdDuration, isReappear);
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
        padding: 16px 20px;
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
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        z-index: 2;
      }
      .fg-proceed-sub {
        font-size: 11.5px;
        font-weight: 400;
        opacity: 0.8;
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
    const escapedDomain = escapeHTML(currentHostname.replace(/^www\./, ""));
    const badgeText = isReappear ? "Limit reached" : "Active";
    const badgeColorStyle = isReappear ? "" : "";

    const reappearBlock = isReappear ? `
      <div class="fg-reappear-info">
        Your access to <strong>${escapedDomain}</strong> has ended.<br>
        You can choose to continue, or exit and stay focused.
      </div>
    ` : "";

    const titleText = isReappear ? "You've reached your limit." : escapeHTML(promptText);
    const subtitleText = isReappear
      ? "Do you want to continue?"
      : `You're attempting to access <a href="#">${escapedDomain}</a>`;

    return `
      <div class="fg-card">
        <div class="fg-badge">
          <span class="fg-badge-dot"></span>
          ${badgeText}
        </div>

        <div class="fg-clock-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>

        <div class="fg-title">${titleText}</div>
        <div class="fg-subtitle">${subtitleText}</div>

        <div class="fg-divider"></div>

        ${isReappear ? reappearBlock : `
          <div class="fg-textarea-wrap">
            <textarea class="fg-textarea" placeholder="I need to check..." maxlength="250"></textarea>
          </div>
          <div class="fg-textarea-hint">
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m 16.474 5.408 l 2.118 2.117 m -6.4 -3.553 l -7.263 7.262 a 1 1 0 0 0 -0.263 0.464 l -0.823 3.704 a 0.5 0.5 0 0 0 0.597 0.597 l 3.704 -0.823 a 1 1 0 0 0 0.464 -0.263 l 7.262 -7.262 a 2 2 0 0 0 0 -2.829 l -0.818 -0.818 a 2 2 0 0 0 -2.83 0 z"/></svg>
              Type at least 10 characters to continue
            </span>
            <span class="fg-char-count">0 / 10</span>
          </div>
        `}

        <div class="fg-slider-section">
          <div class="fg-slider-header">
            <span class="fg-slider-label">How long do you need access?</span>
            <span class="fg-slider-value">15 minutes</span>
          </div>
          <div class="fg-slider-track">
            <span class="fg-slider-bound">1 min</span>
            <input type="range" class="fg-range" min="1" max="120" value="15">
            <span class="fg-slider-bound right">120 mins</span>
          </div>
          <div class="fg-presets">
            <button class="fg-preset-btn" data-val="5">5 min</button>
            <button class="fg-preset-btn active" data-val="15">15 min</button>
            <button class="fg-preset-btn" data-val="30">30 min</button>
            <button class="fg-preset-btn" data-val="60">1 hour</button>
          </div>
        </div>

        <div class="fg-warning" id="fg-warning">
          <div class="fg-warning-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <div class="fg-warning-badge">
              <svg viewBox="0 0 24 24" fill="#ef4444" stroke="none">
                <path d="M12 2L2 20h20L12 2zm0 14a1 1 0 110 2 1 1 0 010-2zm-1-8h2v6h-2V8z"/>
              </svg>
            </div>
          </div>
          <div class="fg-warning-separator"></div>
          <div class="fg-warning-text">
            <div class="fg-warning-title">That's a long time.</div>
            <div class="fg-warning-desc">You might not need this much time.<br>Take a moment to make sure it's necessary.</div>
          </div>
        </div>

        <div class="fg-buttons">
          <button class="fg-exit-btn" id="fg-exit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            <div class="fg-exit-inner">
              <span>Exit</span>
              <span class="fg-exit-sub">Close this tab</span>
            </div>
          </button>
          <button class="fg-proceed-btn" id="fg-proceed">
            <div class="fg-ring-wrap">
              <svg viewBox="0 0 40 40">
                <circle class="fg-ring-bg" cx="20" cy="20" r="18"/>
                <circle class="fg-ring-progress" cx="20" cy="20" r="18"/>
                <circle class="fg-ring-dot" cx="20" cy="20" r="5"/>
              </svg>
            </div>
            <div class="fg-proceed-inner">
              <span>Hold to Proceed</span>
              <span class="fg-proceed-sub">Hold for ${holdDuration} seconds to continue.</span>
            </div>
            <div class="fg-proceed-fill"></div>
          </button>
        </div>

        <div class="fg-footer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Each time you continue, it gets harder to break the cycle.</span>
        </div>
      </div>
    `;
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
        browser.runtime.sendMessage({ type: "CLOSE_TAB" });
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
        });
        removeOverlay();
      }

      proceedBtn.addEventListener("pointerdown", (e) => {
        if (!canProceed()) return;
        e.preventDefault();
        resetProgress();
        holdStart = Date.now();
        animFrame = requestAnimationFrame(animateProgress);
      });

      const cancelHold = () => {
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
