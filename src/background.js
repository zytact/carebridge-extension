const LOCKDOWN_STORAGE_KEY = "aipx_lockdown_state";
const ENFORCEMENT_INTERVAL_MS = 300;
const TAB_CLOSE_RETRY_MS = 120;

let lockdownState = {
  active: false,
  interviewTabId: null,
  interviewWindowId: null,
  sessionToken: "",
  allowedOrigin: "",
  allowedPathPrefix: "/interview",
  startedAt: 0,
  lastHeartbeatAt: 0,
};
let enforcementTimer = null;
const stateReady = loadState();

async function persistState() {
  await chrome.storage.session.set({
    [LOCKDOWN_STORAGE_KEY]: lockdownState,
  });
}

async function loadState() {
  try {
    const data = await chrome.storage.session.get(LOCKDOWN_STORAGE_KEY);
    const saved = data?.[LOCKDOWN_STORAGE_KEY];
    if (saved && typeof saved === "object") {
      lockdownState = { ...lockdownState, ...saved };
    }
  } catch {
    // ignore restore failures
  }
}

async function ensureActiveState() {
  await stateReady;
  if (lockdownState.active) return;

  try {
    const data = await chrome.storage.session.get(LOCKDOWN_STORAGE_KEY);
    const saved = data?.[LOCKDOWN_STORAGE_KEY];
    if (saved && typeof saved === "object") {
      lockdownState = { ...lockdownState, ...saved };
    }
  } catch {
    // ignore hydrate failures
  }
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isAllowedOrigin(origin) {
  return typeof origin === "string" && /^https?:\/\//.test(origin);
}

function stopLockdown() {
  if (enforcementTimer) {
    clearInterval(enforcementTimer);
    enforcementTimer = null;
  }
  lockdownState = {
    active: false,
    interviewTabId: null,
    interviewWindowId: null,
    sessionToken: "",
    allowedOrigin: "",
    allowedPathPrefix: "/interview",
    startedAt: 0,
    lastHeartbeatAt: 0,
  };
  persistState();
}

function getPathPrefix(pagePath) {
  if (typeof pagePath !== "string" || !pagePath.startsWith("/")) {
    return "/interview";
  }
  if (pagePath.startsWith("/interview")) {
    return "/interview";
  }
  return pagePath;
}

function startEnforcementLoop() {
  if (enforcementTimer) {
    clearInterval(enforcementTimer);
    enforcementTimer = null;
  }

  if (!lockdownState.active) return;

  enforcementTimer = setInterval(async () => {
    if (!lockdownState.active) return;
    await ensureInterviewTabStillValid();
    if (!lockdownState.active) return;
    await closeDisallowedTabs();
  }, ENFORCEMENT_INTERVAL_MS);
}

async function closeTabIfDisallowed(tabId) {
  if (!lockdownState.active || typeof lockdownState.interviewTabId !== "number") {
    return;
  }
  if (!tabId || tabId === lockdownState.interviewTabId) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.id === lockdownState.interviewTabId) return;
    await chrome.tabs.remove(tabId);
  } catch {
    // ignore closure failures on browser-protected tabs
  }
}

async function closeDisallowedTabs() {
  if (!lockdownState.active || typeof lockdownState.interviewTabId !== "number") {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const removableTabIds = tabs
    .filter((tab) => tab.id && tab.id !== lockdownState.interviewTabId)
    .map((tab) => tab.id);

  for (const tabId of removableTabIds) {
    await closeTabIfDisallowed(tabId);
  }
}

async function ensureInterviewTabStillValid() {
  if (!lockdownState.active || typeof lockdownState.interviewTabId !== "number") {
    return;
  }
  try {
    const tab = await chrome.tabs.get(lockdownState.interviewTabId);
    if (!tab || !tab.url) {
      stopLockdown();
      return;
    }
    if (lockdownState.allowedOrigin && !tab.url.startsWith(lockdownState.allowedOrigin)) {
      stopLockdown();
      return;
    }

    if (lockdownState.allowedPathPrefix) {
      const tabUrl = new URL(tab.url);
      if (!tabUrl.pathname.startsWith(lockdownState.allowedPathPrefix)) {
        stopLockdown();
      }
    }
  } catch {
    stopLockdown();
  }
}

async function startLockdownForSender(senderTabId, senderWindowId, origin, pagePath) {
  const nextPathPrefix = getPathPrefix(pagePath);

  if (
    lockdownState.active &&
    lockdownState.interviewTabId === senderTabId &&
    lockdownState.allowedOrigin === origin
  ) {
    lockdownState.lastHeartbeatAt = Date.now();
    lockdownState.allowedPathPrefix = nextPathPrefix;
    await persistState();
    startEnforcementLoop();
    return {
      sessionToken: lockdownState.sessionToken,
      heartbeatIntervalMs: 1000,
      heartbeatGraceMs: 4000,
    };
  }

  lockdownState = {
    active: true,
    interviewTabId: senderTabId,
    interviewWindowId: senderWindowId,
    sessionToken: randomToken(),
    allowedOrigin: origin,
    allowedPathPrefix: nextPathPrefix,
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
  };

  await persistState();
  await closeDisallowedTabs();
  startEnforcementLoop();
  await chrome.tabs.update(senderTabId, { active: true });
  await chrome.windows.update(senderWindowId, { focused: true });

  return {
    sessionToken: lockdownState.sessionToken,
    heartbeatIntervalMs: 1000,
    heartbeatGraceMs: 4000,
  };
}

async function stopLockdownForSender(senderTabId, sessionToken) {
  if (!lockdownState.active) {
    return { ok: true };
  }

  if (sessionToken && sessionToken !== lockdownState.sessionToken) {
    return { ok: false, error: "invalid_session" };
  }

  if (!sessionToken && senderTabId !== lockdownState.interviewTabId) {
    return { ok: false, error: "lockdown_owner_mismatch" };
  }

  stopLockdown();
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  stopLockdown();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureActiveState();
  await ensureInterviewTabStillValid();
  if (lockdownState.active) {
    startEnforcementLoop();
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureActiveState();
  if (!lockdownState.active) return;
  await closeTabIfDisallowed(tab.id);
  if (tab.id) {
    setTimeout(() => {
      closeTabIfDisallowed(tab.id).catch(() => {});
    }, TAB_CLOSE_RETRY_MS);
  }
  await closeDisallowedTabs();
});

chrome.tabs.onUpdated.addListener(async (tabId) => {
  await ensureActiveState();
  if (!lockdownState.active) return;
  if (tabId !== lockdownState.interviewTabId) {
    await closeTabIfDisallowed(tabId);
    return;
  }

  await ensureInterviewTabStillValid();
  await closeDisallowedTabs();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ensureActiveState();
  if (!lockdownState.active) return;
  if (activeInfo.tabId !== lockdownState.interviewTabId) {
    await closeTabIfDisallowed(activeInfo.tabId);
    await closeDisallowedTabs();
    try {
      await chrome.tabs.update(lockdownState.interviewTabId, { active: true });
    } catch {
      // ignore activation failures when tab no longer exists
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureActiveState();
  if (!lockdownState.active) return;
  if (tabId === lockdownState.interviewTabId) {
    stopLockdown();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderTab = sender?.tab;
  const senderTabId = senderTab?.id;
  const senderWindowId = senderTab?.windowId;
  const payload = message?.payload || {};

  const respond = (obj) => {
    sendResponse(obj);
  };

  const run = async () => {
    await ensureActiveState();

    if (message?.type === "AIPX_PING") {
      respond({
        ok: true,
        payload: {
          active: lockdownState.active,
          sessionToken: lockdownState.sessionToken,
          startedAt: lockdownState.startedAt,
          heartbeatIntervalMs: 1000,
          heartbeatGraceMs: 4000,
        },
      });
      return;
    }

    if (message?.type === "AIPX_START_LOCKDOWN") {
      if (typeof senderTabId !== "number" || typeof senderWindowId !== "number") {
        respond({ ok: false, error: "missing_sender_tab" });
        return;
      }

      const origin = payload.pageOrigin || message.pageOrigin || "";
      if (!isAllowedOrigin(origin)) {
        respond({ ok: false, error: "invalid_origin" });
        return;
      }

      const payloadData = await startLockdownForSender(
        senderTabId,
        senderWindowId,
        origin,
        payload.pagePath || message.pagePath || "/interview",
      );

      respond({ ok: true, payload: payloadData });
      return;
    }

    if (message?.type === "AIPX_HEARTBEAT_ACK") {
      if (!lockdownState.active) {
        respond({ ok: false, error: "not_active" });
        return;
      }

      if (payload.sessionToken !== lockdownState.sessionToken) {
        respond({ ok: false, error: "invalid_session" });
        return;
      }

      lockdownState.lastHeartbeatAt = Date.now();
      await persistState();
      respond({ ok: true, payload: { alive: true } });
      return;
    }

    if (message?.type === "AIPX_STOP_LOCKDOWN") {
      const result = await stopLockdownForSender(senderTabId, payload.sessionToken);
      respond(result);
      return;
    }

    if (message?.type === "AIPX_STATUS") {
      respond({
        ok: true,
        payload: {
          ...lockdownState,
          heartbeatAgeMs: lockdownState.lastHeartbeatAt
            ? Date.now() - lockdownState.lastHeartbeatAt
            : null,
        },
      });
      return;
    }

    respond({ ok: false, error: "unknown_message_type" });
  };

  run().catch((error) => {
    respond({
      ok: false,
      error: "runtime_failure",
      message: error?.message || "Unknown runtime failure",
    });
  });

  return true;
});

stateReady.then(() => {
  ensureInterviewTabStillValid();
  if (lockdownState.active) {
    startEnforcementLoop();
  }
});
