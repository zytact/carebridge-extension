function emitHeartbeat(): void {
  chrome.runtime.sendMessage({ type: 'carebridge-heartbeat' });
}

emitHeartbeat();

window.addEventListener('focus', () => {
  emitHeartbeat();
});

window.addEventListener('pageshow', () => {
  emitHeartbeat();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    emitHeartbeat();
  }
});
