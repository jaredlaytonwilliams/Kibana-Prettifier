let fullLogs = "";

document.addEventListener("DOMContentLoaded", () => {
  const output = document.getElementById("output");
  const searchBox = document.getElementById("searchBox");

  chrome.storage.local.get("lastLogs", (data) => {
    fullLogs = data.lastLogs || "No logs captured yet.";
    output.textContent = fullLogs;
  });

  searchBox.addEventListener("input", () => {
    const term = searchBox.value.toLowerCase();
    if (!term) {
      output.textContent = fullLogs;
      return;
    }

    // Simple filter: only show lines that contain the term
    const filtered = fullLogs
      .split("\n")
      .filter(line => line.toLowerCase().includes(term))
      .join("\n");

    output.textContent = filtered || "No matches found.";
  });
});
