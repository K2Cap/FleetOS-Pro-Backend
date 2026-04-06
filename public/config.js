window.FLEETOS_API_BASE = "https://fleetos-pro-backend-production.up.railway.app";
(function configureFleetPaths() {
  const path = window.location.pathname || "";
  const rootMatch = path.match(/^(.*?)(\/(?:APP|app))(?:\/|$)/);
  const appBasePath = rootMatch ? rootMatch[2] : "";
  window.FLEETOS_APP_BASE = window.location.origin + appBasePath;
})();

(function enableLiveVersionSync() {
  if (typeof window === "undefined" || typeof fetch !== "function") return;

  const VERSION_URL = "version.json";
  const STORAGE_KEY = "fleetos_live_version";
  const RELOAD_KEY = "fleetos_live_reload_target";
  const CHECK_INTERVAL_MS = 45000;

  async function checkVersion() {
    try {
      const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if (!response.ok) return;

      const payload = await response.json();
      const latestVersion = String(payload && payload.v ? payload.v : "").trim();
      if (!latestVersion) return;

      const currentVersion = localStorage.getItem(STORAGE_KEY);
      const pendingReload = sessionStorage.getItem(RELOAD_KEY);

      if (!currentVersion) {
        localStorage.setItem(STORAGE_KEY, latestVersion);
        return;
      }

      if (currentVersion !== latestVersion) {
        localStorage.setItem(STORAGE_KEY, latestVersion);
        if (pendingReload !== latestVersion) {
          sessionStorage.setItem(RELOAD_KEY, latestVersion);
          window.location.reload();
        }
        return;
      }

      if (pendingReload === latestVersion) {
        sessionStorage.removeItem(RELOAD_KEY);
      }
    } catch (error) {
      console.warn("FleetOS live sync check failed:", error);
    }
  }

  checkVersion();
  window.addEventListener("focus", checkVersion);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkVersion();
  });
  window.setInterval(checkVersion, CHECK_INTERVAL_MS);
})();
