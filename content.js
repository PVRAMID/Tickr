// ======================
// Tickr Tracker
// ======================

let isRunning = false;
let nextRunTimer = null;
let refreshTimer = null;
let lastNotification = 0;
let statusPanel = null;
let telegramConfig = {
  token: "",
  chatId: ""
};

const TRACKER_DEFAULTS = {
  mode: "stopped",
  statusText: "Tracker is idle.",
  badge: "idle",
  lastResult: "Standing by",
  lastCheckAt: null,
  nextCheckAt: null,
  sessionStartedAt: null,
  runtimeMs: 0,
  productiveSearches: 0,
  nonProductiveSearches: 0,
  errorCount: 0,
  errorAlertSent: false,
  telegramConfigured: false
};

let trackerState = { ...TRACKER_DEFAULTS };

const NEGATIVE_AVAILABILITY_PHRASES = [
  "there arent enough tickets",
  "there aren't enough tickets",
  "search for tickets",
  "resale tickets will appear below when they are available",
  "tickets will appear below when they are available",
  "no tickets available",
  "no results available"
];

const PURCHASE_CTA_PHRASES = [
  "buy now",
  "checkout",
  "go to checkout",
  "continue",
  "next",
  "place order",
  "add to basket",
  "add to cart"
];

const STATUS_THEME = {
  idle: {
    accent: "#94a3b8",
    glow: "rgba(148, 163, 184, 0.35)",
    badgeBg: "rgba(148, 163, 184, 0.14)"
  },
  scanning: {
    accent: "#38bdf8",
    glow: "rgba(56, 189, 248, 0.35)",
    badgeBg: "rgba(56, 189, 248, 0.14)"
  },
  waiting: {
    accent: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.35)",
    badgeBg: "rgba(245, 158, 11, 0.14)"
  },
  found: {
    accent: "#22c55e",
    glow: "rgba(34, 197, 94, 0.35)",
    badgeBg: "rgba(34, 197, 94, 0.16)"
  },
  error: {
    accent: "#fb7185",
    glow: "rgba(251, 113, 133, 0.35)",
    badgeBg: "rgba(251, 113, 133, 0.14)"
  },
  paused: {
    accent: "#a78bfa",
    glow: "rgba(167, 139, 250, 0.35)",
    badgeBg: "rgba(167, 139, 250, 0.14)"
  }
};

function playSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();

  setTimeout(() => {
    oscillator.stop();
    audioCtx.close();
  }, 400);
}

function sendTelegramMessage(message) {
  chrome.runtime.sendMessage({
    type: "SEND_TELEGRAM",
    message
  });
}

function sendTelegram() {
  sendTelegramMessage(`Tickets found!\n${window.location.href}`);
}

function formatTimestamp(ts) {
  if (!ts) return "Waiting";

  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(ts));
}

function formatCountdown(targetTs) {
  if (!targetTs) return "Waiting";

  const diffMs = targetTs - Date.now();
  if (diffMs <= 0) return "Now";

  const totalSeconds = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getLiveRuntimeMs() {
  const runtimeMs = trackerState.runtimeMs || 0;

  if (trackerState.mode !== "running" || !trackerState.sessionStartedAt) {
    return runtimeMs;
  }

  return runtimeMs + (Date.now() - trackerState.sessionStartedAt);
}

function getPageText() {
  return (document.body?.innerText || "").toLowerCase();
}

function getTicketTarget() {
  const pageHeading = document.querySelector("h1");
  const metaTitle = document.querySelector('meta[property="og:title"]');
  const rawTitle = pageHeading?.innerText || metaTitle?.content || document.title || "Current event page";
  const cleanedTitle = rawTitle
    .replace(/\s*\|\s*Ticketmaster.*$/i, "")
    .replace(/\s*[-|]\s*Buy Tickets.*$/i, "")
    .trim();

  const quantitySelect = document.querySelector('select[name*="quantity" i], select[id*="quantity" i]');
  const quantityInput = document.querySelector('input[name*="quantity" i], input[id*="quantity" i]');
  const quantityValue = quantitySelect?.value || quantityInput?.value || "";
  const quantityLabel = quantityValue ? `${quantityValue} ticket${quantityValue === "1" ? "" : "s"}` : "Any available tickets";

  return `${cleanedTitle || "Current event page"} - ${quantityLabel}`;
}

function getResultTone(result) {
  const normalized = (result || "").toLowerCase();

  if (normalized.includes("tickets found") || normalized.includes("reserved")) {
    return "positive";
  }

  if (normalized.includes("error") || normalized.includes("refresh")) {
    return "warning";
  }

  if (normalized.includes("loading")) {
    return "neutral";
  }

  return "muted";
}

function ensureStatusPanel() {
  if (statusPanel?.isConnected) return statusPanel;

  const panel = document.createElement("div");
  panel.id = "tickr-status-panel";
  panel.innerHTML = `
    <div class="tickr-card">
      <div class="tickr-header">
        <div class="tickr-brand">
          <span class="tickr-dot"></span>
          <span class="tickr-label">Tickr</span>
        </div>
        <span class="tickr-badge">idle</span>
      </div>
      <div class="tickr-ticket-target"></div>
      <div class="tickr-result-shell">
        <div class="tickr-result-label">Latest result</div>
        <div class="tickr-result-pill" data-tone="muted">Standing by</div>
      </div>
      <div class="tickr-signal-row">
        <div class="tickr-signal-chip" data-telegram="off">
          <span class="tickr-signal-dot"></span>
          <span class="tickr-signal-text">Telegram not configured</span>
        </div>
      </div>
      <div class="tickr-grid">
        <div class="tickr-metric">
          <span class="tickr-metric-label">Run time</span>
          <span class="tickr-runtime">00:00</span>
        </div>
        <div class="tickr-metric">
          <span class="tickr-metric-label">Last check</span>
          <span class="tickr-last-check">Waiting</span>
        </div>
      </div>
      <div class="tickr-grid">
        <div class="tickr-metric">
          <span class="tickr-metric-label">Productive</span>
          <span class="tickr-productive">0</span>
        </div>
        <div class="tickr-metric">
          <span class="tickr-metric-label">Non-productive</span>
          <span class="tickr-non-productive">0</span>
        </div>
      </div>
      <div class="tickr-grid">
        <div class="tickr-metric">
          <span class="tickr-metric-label">Next check</span>
          <span class="tickr-next-check">Waiting</span>
        </div>
        <div class="tickr-metric tickr-controls">
          <button type="button" data-action="start">Start</button>
          <button type="button" data-action="pause">Pause</button>
          <button type="button" data-action="stop">Stop</button>
        </div>
      </div>
      <div class="tickr-status-text">Tracker is idle.</div>
    </div>
  `;

  const styleId = "tickr-status-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #tickr-status-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        pointer-events: none;
        color: #f8fafc;
        font-family: "Segoe UI", Arial, sans-serif;
      }

      #tickr-status-panel .tickr-card {
        width: 320px;
        padding: 14px;
        border-radius: 18px;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.15), transparent 35%),
          linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.92));
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.32);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }

      #tickr-status-panel .tickr-header,
      #tickr-status-panel .tickr-grid,
      #tickr-status-panel .tickr-brand,
      #tickr-status-panel .tickr-controls {
        display: flex;
        align-items: center;
      }

      #tickr-status-panel .tickr-header {
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      #tickr-status-panel .tickr-brand {
        gap: 10px;
        min-width: 0;
      }

      #tickr-status-panel .tickr-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--tickr-accent, #38bdf8);
        box-shadow: 0 0 14px var(--tickr-glow, rgba(56, 189, 248, 0.35));
        animation: tickrPulse 1.8s infinite;
        flex: 0 0 auto;
      }

      #tickr-status-panel .tickr-label,
      #tickr-status-panel .tickr-badge,
      #tickr-status-panel .tickr-metric-label {
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      #tickr-status-panel .tickr-label {
        font-size: 11px;
        font-weight: 700;
        color: rgba(226, 232, 240, 0.9);
      }

      #tickr-status-panel .tickr-badge {
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        color: var(--tickr-accent, #38bdf8);
        background: var(--tickr-badge-bg, rgba(56, 189, 248, 0.14));
        border: 1px solid rgba(255, 255, 255, 0.08);
        white-space: nowrap;
      }

      #tickr-status-panel .tickr-ticket-target {
        margin-bottom: 12px;
        font-size: 14px;
        line-height: 1.4;
        font-weight: 600;
        color: #f8fafc;
        text-wrap: balance;
      }

      #tickr-status-panel .tickr-result-shell {
        margin-bottom: 10px;
        padding: 12px;
        border-radius: 16px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03)),
          rgba(15, 23, 42, 0.58);
        border: 1px solid rgba(148, 163, 184, 0.14);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }

      #tickr-status-panel .tickr-result-label {
        margin-bottom: 8px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(148, 163, 184, 0.86);
      }

      #tickr-status-panel .tickr-result-pill {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        color: #f8fafc;
        background: rgba(71, 85, 105, 0.38);
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.22);
      }

      #tickr-status-panel .tickr-result-pill[data-tone="positive"] {
        color: #dcfce7;
        background: linear-gradient(135deg, rgba(34, 197, 94, 0.22), rgba(21, 128, 61, 0.34));
        border-color: rgba(34, 197, 94, 0.34);
      }

      #tickr-status-panel .tickr-result-pill[data-tone="warning"] {
        color: #ffe4e6;
        background: linear-gradient(135deg, rgba(244, 63, 94, 0.22), rgba(190, 24, 93, 0.3));
        border-color: rgba(244, 63, 94, 0.34);
      }

      #tickr-status-panel .tickr-result-pill[data-tone="neutral"] {
        color: #e0f2fe;
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(14, 116, 144, 0.3));
        border-color: rgba(56, 189, 248, 0.32);
      }

      #tickr-status-panel .tickr-result-pill[data-tone="muted"] {
        color: #e2e8f0;
      }

      #tickr-status-panel .tickr-signal-row {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }

      #tickr-status-panel .tickr-signal-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.48);
        border: 1px solid rgba(148, 163, 184, 0.12);
      }

      #tickr-status-panel .tickr-signal-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #fb7185;
        box-shadow: 0 0 12px rgba(251, 113, 133, 0.4);
      }

      #tickr-status-panel .tickr-signal-chip[data-telegram="on"] .tickr-signal-dot {
        background: #22c55e;
        box-shadow: 0 0 12px rgba(34, 197, 94, 0.45);
      }

      #tickr-status-panel .tickr-signal-text {
        font-size: 11px;
        font-weight: 700;
        color: rgba(226, 232, 240, 0.92);
      }

      #tickr-status-panel .tickr-grid {
        gap: 10px;
        align-items: stretch;
        margin-bottom: 10px;
      }

      #tickr-status-panel .tickr-metric {
        flex: 1 1 0;
        min-width: 0;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.48);
        border: 1px solid rgba(148, 163, 184, 0.12);
      }

      #tickr-status-panel .tickr-metric-label {
        display: block;
        margin-bottom: 4px;
        font-size: 9px;
        font-weight: 700;
        color: rgba(148, 163, 184, 0.9);
      }

      #tickr-status-panel .tickr-runtime,
      #tickr-status-panel .tickr-last-check,
      #tickr-status-panel .tickr-next-check,
      #tickr-status-panel .tickr-productive,
      #tickr-status-panel .tickr-non-productive,
      #tickr-status-panel .tickr-status-text {
        font-variant-numeric: tabular-nums;
      }

      #tickr-status-panel .tickr-runtime,
      #tickr-status-panel .tickr-last-check,
      #tickr-status-panel .tickr-next-check,
      #tickr-status-panel .tickr-productive,
      #tickr-status-panel .tickr-non-productive {
        font-size: 15px;
        font-weight: 700;
        color: #f8fafc;
      }

      #tickr-status-panel .tickr-controls {
        gap: 6px;
        justify-content: space-between;
        pointer-events: auto;
      }

      #tickr-status-panel .tickr-controls button {
        flex: 1 1 0;
        padding: 8px 0;
        border: 0;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        color: #e2e8f0;
        background: rgba(51, 65, 85, 0.85);
      }

      #tickr-status-panel .tickr-controls button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      #tickr-status-panel .tickr-status-text {
        font-size: 12px;
        font-weight: 600;
        color: rgba(226, 232, 240, 0.88);
      }

      @keyframes tickrPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.35); opacity: 0.55; }
      }

      @media (max-width: 640px) {
        #tickr-status-panel {
          top: auto;
          right: 12px;
          bottom: 12px;
          left: 12px;
        }

        #tickr-status-panel .tickr-card {
          width: auto;
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  panel.querySelectorAll(".tickr-controls button").forEach((button) => {
    button.addEventListener("click", () => {
      applyModeChange(button.dataset.action);
    });
  });

  document.documentElement.appendChild(panel);
  statusPanel = panel;
  return panel;
}

function updateStatusPanel() {
  const panel = ensureStatusPanel();
  const theme = STATUS_THEME[trackerState.badge] || STATUS_THEME.idle;

  panel.style.setProperty("--tickr-accent", theme.accent);
  panel.style.setProperty("--tickr-glow", theme.glow);
  panel.style.setProperty("--tickr-badge-bg", theme.badgeBg);

  panel.querySelector(".tickr-badge").innerText = trackerState.badge;
  panel.querySelector(".tickr-ticket-target").innerText = getTicketTarget();
  panel.querySelector(".tickr-result-pill").innerText = trackerState.lastResult || "Standing by";
  panel.querySelector(".tickr-result-pill").dataset.tone = getResultTone(trackerState.lastResult);
  panel.querySelector(".tickr-runtime").innerText = formatDuration(getLiveRuntimeMs());
  panel.querySelector(".tickr-last-check").innerText = formatTimestamp(trackerState.lastCheckAt);
  panel.querySelector(".tickr-next-check").innerText = formatCountdown(trackerState.nextCheckAt);
  panel.querySelector(".tickr-productive").innerText = String(trackerState.productiveSearches || 0);
  panel.querySelector(".tickr-non-productive").innerText = String(trackerState.nonProductiveSearches || 0);
  panel.querySelector(".tickr-status-text").innerText = trackerState.statusText;
  panel.querySelector(".tickr-signal-chip").dataset.telegram = trackerState.telegramConfigured ? "on" : "off";
  panel.querySelector(".tickr-signal-text").innerText = trackerState.telegramConfigured
    ? "Telegram armed"
    : "Telegram not configured";

  const startBtn = panel.querySelector('[data-action="start"]');
  const pauseBtn = panel.querySelector('[data-action="pause"]');
  const stopBtn = panel.querySelector('[data-action="stop"]');

  startBtn.disabled = trackerState.mode === "running";
  pauseBtn.disabled = trackerState.mode !== "running";
  stopBtn.disabled = trackerState.mode === "stopped";
}

function persistTrackerState() {
  chrome.storage.local.set({ trackerState });
}

function patchTrackerState(patch, shouldPersist = true) {
  trackerState = {
    ...trackerState,
    ...patch
  };

  updateStatusPanel();

  if (shouldPersist) {
    persistTrackerState();
  }
}

function setTrackerState(statusText, badge, extra = {}, shouldPersist = true) {
  patchTrackerState({
    statusText,
    badge,
    ...extra
  }, shouldPersist);
}

function recordSearchResult(kind) {
  if (kind === "productive") {
    patchTrackerState({
      productiveSearches: (trackerState.productiveSearches || 0) + 1
    });
    return;
  }

  patchTrackerState({
    nonProductiveSearches: (trackerState.nonProductiveSearches || 0) + 1
  });
}

function resetErrorState(shouldPersist = true) {
  patchTrackerState({
    errorCount: 0,
    errorAlertSent: false
  }, shouldPersist);
}

function syncTelegramConfig(token, chatId, shouldPersist = true) {
  telegramConfig = {
    token: token || "",
    chatId: chatId || ""
  };

  patchTrackerState({
    telegramConfigured: Boolean(telegramConfig.token && telegramConfig.chatId)
  }, shouldPersist);
}

function startRefreshTimer() {
  if (refreshTimer) return;

  refreshTimer = setInterval(() => {
    updateStatusPanel();
  }, 1000);
}

function stopRefreshTimer() {
  if (!refreshTimer) return;

  clearInterval(refreshTimer);
  refreshTimer = null;
}

function notify() {
  const now = Date.now();

  if (now - lastNotification < 60000) return;

  lastNotification = now;
  recordSearchResult("productive");
  setTrackerState("Tickets detected. Alert sent.", "found", {
    lastResult: "Tickets found"
  });

  console.log("Tickets found!");

  playSound();
  sendTelegram();

  document.title = "TICKETS FOUND";
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hasPurchaseCTA() {
  return [...document.querySelectorAll("button, a")].some((el) => {
    const label = (el.innerText || "").trim().toLowerCase();
    return PURCHASE_CTA_PHRASES.some((phrase) => label.includes(phrase));
  });
}

function detectTickets() {
  const text = getPageText();

  if (NEGATIVE_AVAILABILITY_PHRASES.some((phrase) => text.includes(phrase))) {
    return false;
  }

  const hasPrice = /(?:\u00A3|\$)\s?\d/.test(text);

  return hasPrice && hasPurchaseCTA();
}

function hasReserved() {
  const text = getPageText();
  return text.includes("tickets reserved for");
}

function isLoading() {
  const text = getPageText();
  return text.includes("loading") || text.includes("searching");
}

function hasError() {
  const text = getPageText();
  return text.includes("something went wrong");
}

function clickFind() {
  const btn = [...document.querySelectorAll("button")].find((button) =>
    button.innerText.toLowerCase().includes("find tickets")
  );

  if (btn && !btn.disabled) {
    btn.click();
    return true;
  }

  return false;
}

function clickSearchAgain() {
  const btn = [...document.querySelectorAll("button")].find((button) =>
    button.innerText.toLowerCase().includes("search again")
  );

  if (btn && !btn.disabled) {
    btn.click();
    return true;
  }

  return false;
}

function clearNextRunTimer() {
  if (!nextRunTimer) return;

  clearTimeout(nextRunTimer);
  nextRunTimer = null;
}

function refreshPageAfterError(errorCount) {
  const shouldAlert = errorCount >= 3 && !trackerState.errorAlertSent;

  patchTrackerState({
    errorCount,
    errorAlertSent: shouldAlert ? true : trackerState.errorAlertSent
  }, false);

  setTrackerState(
    shouldAlert
      ? `Error state detected ${errorCount} times. Telegram alert sent before refreshing.`
      : `Error state detected. Refreshing page now (${errorCount}).`,
    "error",
    {
      lastResult: shouldAlert
        ? `Error refresh ${errorCount}: Telegram alert sent`
        : `Error refresh ${errorCount}: no tickets found`
    },
    false
  );

  persistTrackerState();

  if (shouldAlert) {
    sendTelegramMessage(
      `Tickr hit ${errorCount} error states and is still unsuccessful.\nRefreshing page: ${window.location.href}`
    );
  }

  window.location.reload();
}

function scheduleNext(delay = randomDelay(7000, 11000)) {
  isRunning = false;
  const nextCheckAt = Date.now() + delay;
  patchTrackerState({ nextCheckAt }, false);
  updateStatusPanel();

  clearNextRunTimer();
  nextRunTimer = setTimeout(() => {
    nextRunTimer = null;
    runTracker();
  }, delay);

  persistTrackerState();
}

function stopTrackerSession(mode, statusText, shouldPersist = true) {
  isRunning = false;
  clearNextRunTimer();

  const patch = {
    mode,
    badge: mode === "paused" ? "paused" : "idle",
    statusText,
    nextCheckAt: null,
    sessionStartedAt: null,
    runtimeMs: getLiveRuntimeMs()
  };

  if (mode === "stopped") {
    Object.assign(patch, {
      ...TRACKER_DEFAULTS,
      mode: "stopped",
      badge: "idle",
      statusText
    });
  }

  patchTrackerState(patch, shouldPersist);

  if (mode !== "running") {
    stopRefreshTimer();
  }
}

function runTracker() {
  if (trackerState.mode !== "running") {
    stopTrackerSession(trackerState.mode, trackerState.statusText || "Tracking is not running.");
    return;
  }

  if (isRunning) return;

  isRunning = true;
  patchTrackerState({
    lastCheckAt: Date.now(),
    nextCheckAt: null
  }, false);
  setTrackerState("Checking page state and ticket actions.", "scanning");

  try {
    if (hasReserved()) {
      resetErrorState(false);
      setTrackerState("Tickets reserved on page.", "found", {
        lastResult: "Tickets found: reserved on page"
      });
      notify();
      scheduleNext(12000);
      return;
    }

    if (detectTickets()) {
      resetErrorState(false);
      setTrackerState("Tickets detected on page.", "found", {
        lastResult: "Tickets found"
      });
      notify();
      scheduleNext(10000);
      return;
    }

    if (isLoading()) {
      resetErrorState(false);
      recordSearchResult("productive");
      setTrackerState("Ticketmaster is still loading results.", "waiting", {
        lastResult: "Loading search results"
      });
      scheduleNext(randomDelay(5000, 7000));
      return;
    }

    if (hasError()) {
      const errorCount = (trackerState.errorCount || 0) + 1;
      recordSearchResult("non-productive");
      refreshPageAfterError(errorCount);
      return;
    }

    resetErrorState(false);
    const clicked = clickFind() || clickSearchAgain();
    recordSearchResult(clicked ? "productive" : "non-productive");
    setTrackerState(
      clicked ? "Triggered a retry action on the page." : "Watching for availability changes.",
      "waiting",
      {
        lastResult: clicked ? "No tickets found: search triggered" : "No tickets found"
      }
    );
    scheduleNext(randomDelay(7000, 11000));
  } catch (err) {
    console.log("Loop error:", err);
    const errorCount = (trackerState.errorCount || 0) + 1;
    recordSearchResult("non-productive");
    refreshPageAfterError(errorCount);
  }
}

function applyModeChange(action) {
  if (action === "start") {
    const baseState = trackerState.mode === "paused"
      ? {
          ...trackerState,
          mode: "running",
          badge: "scanning",
          statusText: "Tracking resumed. Running an immediate check.",
          sessionStartedAt: Date.now(),
          nextCheckAt: null
        }
      : {
          ...TRACKER_DEFAULTS,
          mode: "running",
          badge: "scanning",
          statusText: "Tracking enabled. Running an immediate check.",
          sessionStartedAt: Date.now(),
          telegramConfigured: trackerState.telegramConfigured
        };

    trackerState = baseState;

    updateStatusPanel();
    persistTrackerState();
    startRefreshTimer();
    runTracker();
    return;
  }

  if (action === "pause") {
    stopTrackerSession("paused", "Tracking paused from the Tickr controls.");
    return;
  }

  if (action === "stop") {
    stopTrackerSession("stopped", "Tracking stopped. Start a new session when ready.");
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.chatId || changes.token) {
    syncTelegramConfig(
      changes.token ? changes.token.newValue : telegramConfig.token,
      changes.chatId ? changes.chatId.newValue : telegramConfig.chatId,
      false
    );
  }

  if (!changes.trackerState) return;

  const previousMode = changes.trackerState.oldValue?.mode;
  const nextMode = changes.trackerState.newValue?.mode;

  trackerState = {
    ...TRACKER_DEFAULTS,
    ...changes.trackerState.newValue
  };

  updateStatusPanel();

  if (nextMode === "running" && previousMode !== "running") {
    startRefreshTimer();
    runTracker();
    return;
  }

  if (nextMode !== "running" && previousMode === "running") {
    stopTrackerSession(
      trackerState.mode,
      trackerState.statusText || (trackerState.mode === "paused" ? "Tracking paused." : "Tracking stopped."),
      false
    );
    return;
  }

  if (trackerState.mode !== "running") {
    stopRefreshTimer();
  }
});

window.addEventListener("load", () => {
  updateStatusPanel();

  chrome.storage.local.get(["trackerState", "chatId", "token"], (data) => {
    telegramConfig = {
      token: data.token || "",
      chatId: data.chatId || ""
    };

    trackerState = {
      ...TRACKER_DEFAULTS,
      ...(data.trackerState || {}),
      telegramConfigured: Boolean(telegramConfig.token && telegramConfig.chatId)
    };

    updateStatusPanel();

    if (trackerState.mode === "running") {
      startRefreshTimer();
      runTracker();
    }
  });
});

document.addEventListener("visibilitychange", updateStatusPanel);

updateStatusPanel();
