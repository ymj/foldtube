(function () {
  chrome.storage.local.get('settings', function (r) {
    var t = r && r.settings && r.settings.theme;
    if (t && t !== 'system') {
      document.documentElement.setAttribute('data-theme', t);
    }
  });
})();
