const TRACKER_DEFAULTS = {
  mode: "stopped",
  statusText: "Tracker is idle.",
  lastCheckAt: null,
  nextCheckAt: null,
  sessionStartedAt: null,
  runtimeMs: 0,
  productiveSearches: 0,
  nonProductiveSearches: 0
};

let trackerState = { ...TRACKER_DEFAULTS };
let runtimeTimer = null;

function formatTimestamp(ts) {
  if (!ts) return "Waiting";

  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(ts));
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

function setButtonState() {
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");

  startBtn.disabled = trackerState.mode === "running";
  pauseBtn.disabled = trackerState.mode !== "running";
  stopBtn.disabled = trackerState.mode === "stopped";
}

function syncRuntimeTicker() {
  if (runtimeTimer) {
    clearInterval(runtimeTimer);
    runtimeTimer = null;
  }

  if (trackerState.mode === "running") {
    runtimeTimer = setInterval(() => {
      document.getElementById("runtime").innerText = formatDuration(getLiveRuntimeMs());
    }, 1000);
  }
}

function updateUI() {
  const status = document.getElementById("status");
  const statusDetail = document.getElementById("statusDetail");

  status.innerText = trackerState.mode.charAt(0).toUpperCase() + trackerState.mode.slice(1);
  statusDetail.innerText = trackerState.statusText || "Tracker is idle.";

  document.getElementById("runtime").innerText = formatDuration(getLiveRuntimeMs());
  document.getElementById("lastCheck").innerText = formatTimestamp(trackerState.lastCheckAt);
  document.getElementById("productiveCount").innerText = String(trackerState.productiveSearches || 0);
  document.getElementById("nonProductiveCount").innerText = String(trackerState.nonProductiveSearches || 0);

  setButtonState();
  syncRuntimeTicker();
}

function mergeTrackerState(data) {
  trackerState = {
    ...TRACKER_DEFAULTS,
    ...trackerState,
    ...(data.trackerState || {})
  };

  updateUI();
}

function saveTrackerMode(mode) {
  const nextState = { ...trackerState };

  if (mode === "start") {
    if (nextState.mode === "paused") {
      Object.assign(nextState, {
        mode: "running",
        statusText: "Tracking resumed. Running an immediate check.",
        sessionStartedAt: Date.now(),
        nextCheckAt: null
      });
    } else {
      Object.assign(nextState, {
        mode: "running",
        statusText: "Tracking enabled. Running an immediate check.",
        sessionStartedAt: Date.now(),
        runtimeMs: 0,
        productiveSearches: 0,
        nonProductiveSearches: 0,
        lastCheckAt: null,
        nextCheckAt: null
      });
    }
  } else if (mode === "pause") {
    if (nextState.mode === "running" && nextState.sessionStartedAt) {
      nextState.runtimeMs = getLiveRuntimeMs();
    }

    Object.assign(nextState, {
      mode: "paused",
      statusText: "Tracking paused from the popup.",
      sessionStartedAt: null,
      nextCheckAt: null
    });
  } else if (mode === "stop") {
    Object.assign(nextState, {
      ...TRACKER_DEFAULTS,
      statusText: "Tracking stopped. Start a new session when ready."
    });
  }

  chrome.storage.local.set({ trackerState: nextState });
}

chrome.storage.local.get(["chatId", "token", "trackerState"], (data) => {
  if (data.chatId) document.getElementById("chatId").value = data.chatId;
  if (data.token) document.getElementById("token").value = data.token;
  mergeTrackerState(data);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.trackerState) {
    mergeTrackerState({ trackerState: changes.trackerState.newValue });
  }

  if (changes.chatId) {
    document.getElementById("chatId").value = changes.chatId.newValue || "";
  }

  if (changes.token) {
    document.getElementById("token").value = changes.token.newValue || "";
  }
});

document.getElementById("startBtn").addEventListener("click", () => {
  saveTrackerMode("start");
});

document.getElementById("pauseBtn").addEventListener("click", () => {
  saveTrackerMode("pause");
});

document.getElementById("stopBtn").addEventListener("click", () => {
  saveTrackerMode("stop");
});

document.getElementById("saveTelegram").addEventListener("click", () => {
  const chatId = document.getElementById("chatId").value.trim();
  const token = document.getElementById("token").value.trim();

  if (!chatId || !token) {
    alert("Enter both Token and Chat ID");
    return;
  }

  chrome.storage.local.set({ chatId, token }, () => {
    alert("Telegram saved");
  });
});

document.getElementById("coffeeBtn").addEventListener("click", () => {
  window.open("https://buymeacoffee.com/starcolision");
});

document.getElementById("testTelegram").addEventListener("click", () => {
  chrome.runtime.sendMessage({
    type: "SEND_TELEGRAM",
    message: "Tickr test message: Telegram is working."
  }, (response) => {
    if (response && response.success) {
      alert("Telegram working");
    } else {
      alert("Failed: check token and chat ID");
    }
  });
});
