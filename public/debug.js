(() => {
  const enabled = new URLSearchParams(location.search).get('debug') === '1';
  const entries = [];
  let ready = false, visible = enabled;
  function render() {
    const panel = document.getElementById('startup-debug');
    if (!panel) return;
    panel.hidden = !visible;
    if (visible) panel.open = true;
    document.getElementById('startup-debug-output').textContent = entries.join('\n');
  }
  function log(message, error = false) {
    entries.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
    if (entries.length > 100) entries.shift();
    (error ? console.error : console.debug)(`[NutriMess] ${message}`);
    if (error) visible = true;
    render();
  }
  window.NutriMessDebug = {
    enabled, log,
    fail(message) { log(message, true); },
    ready(message) { ready = true; clearTimeout(watchdog); log(message); }
  };
  window.addEventListener('error', event => {
    const asset = event.target?.src || event.target?.href;
    if (asset) log(`Asset failed: ${new URL(asset, location.href).pathname}. Check HTTP/HTTPS and network access.`, true);
    else log(`JavaScript error: ${event.message || 'Unknown error'}${event.lineno ? ` at line ${event.lineno}` : ''}`, true);
  }, true);
  window.addEventListener('unhandledrejection', event => log(`Unhandled error: ${event.reason?.message || event.reason || 'Unknown error'}`, true));
  window.addEventListener('securitypolicyviolation', event => log(`Browser security policy blocked ${event.violatedDirective}: ${event.blockedURI}`, true));
  document.addEventListener('DOMContentLoaded', () => {
    render();
    document.getElementById('startup-debug-reload').addEventListener('click', () => location.reload());
    log('Page HTML loaded');
  });
  const watchdog = setTimeout(() => {
    if (!ready) log('Startup has not completed after 8 seconds. Last request or script stage is shown above.', true);
  }, 8000);
  log(`Diagnostics loaded on ${location.origin}; secure context: ${Boolean(window.isSecureContext)}`);
})();
