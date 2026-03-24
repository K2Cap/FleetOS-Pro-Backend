window.FLEETOS_API_BASE = "http://localhost:7331";
(function configureFleetPaths() {
  const path = window.location.pathname || "";
  const rootMatch = path.match(/^(.*?)(\/(?:APP|app))(?:\/|$)/);
  const appBasePath = rootMatch ? rootMatch[2] : "";
  window.FLEETOS_APP_BASE = window.location.origin + appBasePath;
})();
