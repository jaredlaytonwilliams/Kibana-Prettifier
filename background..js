chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "prettifyLogs",
    title: "Prettify Logs",
    contexts: ["selection"]  // Only show when text is selected
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "prettifyLogs" && info.selectionText) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => {
        try {
          const parsed = JSON.parse(text);
          alert(JSON.stringify(parsed, null, 2));  // temporary pretty-print
        } catch (e) {
          alert("Could not parse JSON: " + e.message);
        }
      },
      args: [info.selectionText]
    });
  }
});
