// ======================
// Tickr Tracker
// ======================

let isRunning = false;
let lastNotification = 0;
let nextRunTimer = null;
let countdownTimer = null;
let lastCheckAt = null;
let nextCheckAt = null;
let trackerStatus = "Starting";
let trackerBadge = "idle";
let statusPanel = null;

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

function sendTelegram() {
  chrome.runtime.sendMessage({
    type: "SEND_TELEGRAM",
    message: `Tickets found!\n${window.location.href}`
  });
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
      <div class="tickr-grid">
        <div class="tickr-metric">
          <span class="tickr-metric-label">Last check</span>
          <span class="tickr-last-check">Waiting</span>
        </div>
        <div class="tickr-metric">
          <span class="tickr-metric-label">Next check</span>
          <span class="tickr-next-check">Waiting</span>
        </div>
      </div>
      <div class="tickr-status-text">Starting</div>
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
      #tickr-status-panel .tickr-brand {
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

      #tickr-status-panel .tickr-grid {
        gap: 10px;
        align-items: stretch;
        margin-bottom: 12px;
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

      #tickr-status-panel .tickr-last-check,
      #tickr-status-panel .tickr-next-check,
      #tickr-status-panel .tickr-status-text {
        font-variant-numeric: tabular-nums;
      }

      #tickr-status-panel .tickr-last-check,
      #tickr-status-panel .tickr-next-check {
        font-size: 15px;
        font-weight: 700;
        color: #f8fafc;
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

  document.documentElement.appendChild(panel);
  statusPanel = panel;
  return panel;
}

function updateStatusPanel() {
  const panel = ensureStatusPanel();
  const theme = STATUS_THEME[trackerBadge] || STATUS_THEME.idle;

  panel.style.setProperty("--tickr-accent", theme.accent);
  panel.style.setProperty("--tickr-glow", theme.glow);
  panel.style.setProperty("--tickr-badge-bg", theme.badgeBg);

  panel.querySelector(".tickr-badge").innerText = trackerBadge;
  panel.querySelector(".tickr-ticket-target").innerText = getTicketTarget();
  panel.querySelector(".tickr-last-check").innerText = formatTimestamp(lastCheckAt);
  panel.querySelector(".tickr-next-check").innerText = formatCountdown(nextCheckAt);
  panel.querySelector(".tickr-status-text").innerText = trackerStatus;
}

function setTrackerState(statusText, badge) {
  trackerStatus = statusText;
  trackerBadge = badge;
  updateStatusPanel();
}

function startCountdown() {
  if (countdownTimer) return;

  countdownTimer = setInterval(() => {
    if (!nextCheckAt) {
      stopCountdown();
      return;
    }

    updateStatusPanel();
  }, 1000);
}

function stopCountdown() {
  if (!countdownTimer) return;

  clearInterval(countdownTimer);
  countdownTimer = null;
}

function notify() {
  const now = Date.now();

  if (now - lastNotification < 60000) return;

  lastNotification = now;
  setTrackerState("Tickets detected. Alert sent.", "found");

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

function scheduleNext(delay = randomDelay(7000, 11000)) {
  isRunning = false;
  nextCheckAt = Date.now() + delay;
  startCountdown();
  updateStatusPanel();

  if (nextRunTimer) {
    clearTimeout(nextRunTimer);
  }

  nextRunTimer = setTimeout(() => {
    nextRunTimer = null;
    runTracker();
  }, delay);
}

function stopTracker() {
  isRunning = false;
  nextCheckAt = null;

  if (nextRunTimer) {
    clearTimeout(nextRunTimer);
    nextRunTimer = null;
  }

  stopCountdown();
  setTrackerState("Tracking paused in the Tickr popup.", "paused");
}

function runTracker() {
  chrome.storage.local.get(["enabled"], (data) => {
    if (!data.enabled) {
      stopTracker();
      return;
    }

    if (isRunning) return;

    isRunning = true;
    lastCheckAt = Date.now();
    nextCheckAt = null;
    stopCountdown();
    setTrackerState("Checking page state and ticket actions.", "scanning");

    try {
      if (hasReserved()) {
        notify();
        scheduleNext(12000);
        return;
      }

      if (detectTickets()) {
        notify();
        scheduleNext(10000);
        return;
      }

      if (isLoading()) {
        setTrackerState("Ticketmaster is still loading results.", "waiting");
        scheduleNext(randomDelay(5000, 7000));
        return;
      }

      if (hasError()) {
        clickFind() || clickSearchAgain();
        setTrackerState("Retrying after a Ticketmaster error state.", "error");
        scheduleNext(randomDelay(9000, 12000));
        return;
      }

      const clicked = clickFind() || clickSearchAgain();
      setTrackerState(
        clicked ? "Triggered a retry action on the page." : "Watching for availability changes.",
        "waiting"
      );
      scheduleNext(randomDelay(7000, 11000));
    } catch (err) {
      console.log("Loop error:", err);
      setTrackerState("Tracker hit an unexpected page error.", "error");
      scheduleNext(randomDelay(10000, 14000));
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.enabled) return;

  if (changes.enabled.newValue) {
    setTrackerState("Tracking enabled. Running an immediate check.", "scanning");
    runTracker();
    return;
  }

  stopTracker();
});

window.addEventListener("load", updateStatusPanel);
document.addEventListener("visibilitychange", updateStatusPanel);

updateStatusPanel();
runTracker();
