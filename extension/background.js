// Un clic sur l'icône de l'extension ouvre la page de test de la manette.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tester.html') });
});
