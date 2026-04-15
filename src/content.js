const WEB_SOURCE = "aip-web";
const EXT_SOURCE = "aip-extension";
const CHANNEL = "AIPX_CHANNEL_V1";

let heartbeatTimer = null;
let activeSessionToken = "";
let routeObserverTimer = null;
let lockdownReconcileTimer = null;
let lastKnownPathname = window.location.pathname;
let routeGuardBusy = false;

function postToPage(payload) {
  window.postMessage(
    {
      source: EXT_SOURCE,
      channel: CHANNEL,
      ...payload,
    },
    window.location.origin,
  );
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(sessionToken) {
  clearHeartbeat();
  activeSessionToken = sessionToken;
  postToPage({
    type: "AIPX_HEARTBEAT",
    sessionToken,
    sentAt: Date.now(),
  });
  heartbeatTimer = setInterval(() => {
    postToPage({
      type: "AIPX_HEARTBEAT",
      sessionToken,
      sentAt: Date.now(),
    });
  }, 1000);
}

function isInterviewRoute(pathname) {
  return typeof pathname === "string" && pathname.startsWith("/interview");
}

function sendToRuntime(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type,
        payload,
        pageOrigin: window.location.origin,
        pagePath: window.location.pathname,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          resolve({
            ok: false,
            error: "extension_runtime_unavailable",
            message: runtimeError.message,
          });
          return;
        }
        resolve(response || { ok: false, error: "empty_response" });
      },
    );
  });
}

async function ensureInterviewRouteLockdown() {
  if (routeGuardBusy) return;
  routeGuardBusy = true;

  try {
  if (!isInterviewRoute(window.location.pathname)) return;

  const ping = await sendToRuntime("AIPX_PING");
  if (
    ping?.ok &&
    ping.payload?.active &&
    typeof ping.payload?.sessionToken === "string" &&
    ping.payload.sessionToken
  ) {
    if (ping.payload.sessionToken !== activeSessionToken) {
      startHeartbeat(ping.payload.sessionToken);
    }
    return;
  }

  const started = await sendToRuntime("AIPX_START_LOCKDOWN", {
    pageOrigin: window.location.origin,
    pagePath: window.location.pathname,
  });

  if (started?.ok && started?.payload?.sessionToken) {
    startHeartbeat(started.payload.sessionToken);
    postToPage({
      type: "AIPX_ROUTE_LOCKDOWN_STARTED",
      sessionToken: started.payload.sessionToken,
      startedAt: Date.now(),
    });
  } else {
    postToPage({
      type: "AIPX_ROUTE_LOCKDOWN_START_FAILED",
      error: started?.error || "lockdown_start_failed",
      message: started?.message || "",
      at: Date.now(),
    });
  }
  } finally {
    routeGuardBusy = false;
  }
}

async function handleRouteTransition(pathname) {
  if (isInterviewRoute(pathname)) {
    await ensureInterviewRouteLockdown();
    return;
  }

  const status = await sendToRuntime("AIPX_STATUS");
  if (!status?.ok || !status.payload?.active) {
    clearHeartbeat();
    activeSessionToken = "";
    return;
  }

  const stopRes = await sendToRuntime("AIPX_STOP_LOCKDOWN", {
    sessionToken: activeSessionToken || status.payload?.sessionToken || "",
  });

  if (stopRes?.ok) {
    clearHeartbeat();
    activeSessionToken = "";
    postToPage({
      type: "AIPX_ROUTE_LOCKDOWN_STOPPED",
      stoppedAt: Date.now(),
    });
  }
}

function watchRouteChanges() {
  if (routeObserverTimer) {
    clearInterval(routeObserverTimer);
    routeObserverTimer = null;
  }

  routeObserverTimer = setInterval(() => {
    const nextPath = window.location.pathname;
    if (nextPath === lastKnownPathname) return;
    lastKnownPathname = nextPath;
    handleRouteTransition(nextPath).catch(() => {});
  }, 250);
}

function startLockdownReconcileLoop() {
  if (lockdownReconcileTimer) {
    clearInterval(lockdownReconcileTimer);
    lockdownReconcileTimer = null;
  }

  lockdownReconcileTimer = setInterval(() => {
    if (!isInterviewRoute(window.location.pathname)) return;
    ensureInterviewRouteLockdown().catch(() => {});
  }, 1000);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== WEB_SOURCE || message.channel !== CHANNEL) {
    return;
  }

  const { requestId, type, payload } = message;

  sendToRuntime(type, payload || {}).then((response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        clearHeartbeat();
        activeSessionToken = "";
        postToPage({
          type: "AIPX_RESPONSE",
          requestId,
          ok: false,
          error: "extension_runtime_unavailable",
          message: runtimeError.message,
        });
        return;
      }

      const safeResponse = response || {};
      const responsePayload = safeResponse.payload || {};

      if (type === "AIPX_START_LOCKDOWN" && safeResponse.ok) {
        const sessionToken = responsePayload.sessionToken;
        if (sessionToken) {
          startHeartbeat(sessionToken);
        }
      }

      if (type === "AIPX_STOP_LOCKDOWN" && safeResponse.ok) {
        clearHeartbeat();
        activeSessionToken = "";
      }

      if (
        type === "AIPX_PING" &&
        safeResponse.ok &&
        safeResponse.payload?.active &&
        safeResponse.payload?.sessionToken
      ) {
        if (safeResponse.payload.sessionToken !== activeSessionToken) {
          startHeartbeat(safeResponse.payload.sessionToken);
        }
      }

      postToPage({
        type: "AIPX_RESPONSE",
        requestId,
        ok: !!safeResponse.ok,
        error: safeResponse.error || "",
        message: safeResponse.message || "",
        payload: responsePayload,
      });
    });
});

window.addEventListener("beforeunload", () => {
  clearHeartbeat();
  if (routeObserverTimer) {
    clearInterval(routeObserverTimer);
    routeObserverTimer = null;
  }
  if (lockdownReconcileTimer) {
    clearInterval(lockdownReconcileTimer);
    lockdownReconcileTimer = null;
  }
});

watchRouteChanges();
startLockdownReconcileLoop();
handleRouteTransition(window.location.pathname).catch(() => {});
