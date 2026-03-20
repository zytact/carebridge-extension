const BRIDGE_ENDPOINT = 'http://127.0.0.1:17333/extension/open-urls';
const BRIDGE_TOKEN = 'carebridge-local-token';
const REPORT_ALARM = 'carebridge-open-urls-report';
const REPORT_INTERVAL_MINUTES = 1;
const EXTENSION_NOTIFICATION_ID = 'carebridge-proctoring-warning';
const MIN_REPORT_GAP_MS = 5000;

let lastReportAt = 0;

async function collectOpenUrls(): Promise<string[]> {
  const tabs = await chrome.tabs.query({});
  const urls = new Set<string>();

  for (const tab of tabs) {
    const url = tab.url?.trim();

    if (!url) {
      continue;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      urls.add(url);
    }
  }

  return Array.from(urls).sort();
}

async function reportOpenUrls(): Promise<void> {
  const urls = await collectOpenUrls();

  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-carebridge-token': BRIDGE_TOKEN,
      },
      body: JSON.stringify({ urls }),
    });

    if (!response.ok) {
      void notifyBridgeDisconnected(`Desktop bridge rejected update (${response.status})`);
    }
  } catch {
    void notifyBridgeDisconnected('Desktop app not reachable. Open Carebridge Proctoring Client.');
  }
}

async function maybeReportOpenUrls(force = false): Promise<void> {
  const now = Date.now();

  if (!force && now - lastReportAt < MIN_REPORT_GAP_MS) {
    return;
  }

  lastReportAt = now;
  await reportOpenUrls();
}

async function notifyBridgeDisconnected(message: string): Promise<void> {
  await chrome.notifications.create(EXTENSION_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'favicon.svg',
    title: 'Carebridge Proctoring',
    message,
    priority: 2,
  });
}

function ensureAlarm(): void {
  chrome.alarms.create(REPORT_ALARM, {
    periodInMinutes: REPORT_INTERVAL_MINUTES,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void maybeReportOpenUrls(true);
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void maybeReportOpenUrls(true);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'carebridge-heartbeat') {
    return;
  }

  void maybeReportOpenUrls();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REPORT_ALARM) {
    return;
  }

  void maybeReportOpenUrls();
});

chrome.tabs.onCreated.addListener(() => {
  void maybeReportOpenUrls();
});

chrome.tabs.onUpdated.addListener(() => {
  void maybeReportOpenUrls();
});

chrome.tabs.onRemoved.addListener(() => {
  void maybeReportOpenUrls();
});
