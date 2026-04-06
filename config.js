window.FLEETOS_API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? "http://localhost:7331"
  : "https://fleetos-pro-backend-production.up.railway.app";
(function configureFleetPaths() {
  const path = window.location.pathname || "";
  const rootMatch = path.match(/^(.*?)(\/(?:APP|app))(?:\/|$)/);
  const appBasePath = rootMatch ? rootMatch[2] : "";
  window.FLEETOS_APP_BASE = window.location.origin + appBasePath;
})();
