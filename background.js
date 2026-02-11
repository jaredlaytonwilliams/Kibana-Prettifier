// background.js (MV3)
// - Context menu to prettify current selection
// - Robust JSON/XML detection & pretty-printing (tolerates headers/noise)
// - JSON is now prioritized: exact JSON -> balanced JSON -> XML
// - Saves { lastLogs, lastDetected } then opens popup
// - Hotkeys (configurable at chrome://extensions/shortcuts)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "prettifyLogs",
    title: "Prettify Logs",
    contexts: ["selection"]
  });
});

// ---------------- Shared injected function (runs in page when injected) ----------------
function prettifySelectionInPage(rawText) {
  const trimMaybe = (s) => (typeof s === "string" ? s.trim() : "");

  // JSON try-parse
  const tryParseJSON = (text) => {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch { return { ok: false }; }
  };

  // Simple, readable XML pretty printer
  const prettyXml = (xmlString) => {
    let xml = xmlString.replace(/>\s*</g, ">\n<"); // normalize whitespace between tags
    const lines = xml.split("\n");
    let indent = 0;
    const pad = () => "  ".repeat(indent);
    return lines.map((line) => {
      line = line.trim();
      if (!line) return "";
      if (/^<\/[^>]+>/.test(line)) { indent = Math.max(indent - 1, 0); return pad() + line; }
      if (/^<[^>]+\/>$/.test(line) || /^<\?[^>]+\?>$/.test(line) || /^<![^>]+>$/.test(line)) return pad() + line;
      if (/^<[^/!][^>]*>$/.test(line)) { const out = pad() + line; indent += 1; return out; }
      return pad() + line; // text node
    }).join("\n");
  };

  const stripDoctype = (s) => String(s).replace(/<!DOCTYPE[\s\S]*?>/i, "");

  // ---- Balanced XML fragment from noisy text ----
  const extractXmlFragment = (t) => {
    const text = trimMaybe(t);
    const firstRealTagIdx = text.search(/<(?!\?|!)[A-Za-z_][\w.\-:]*/);
    if (firstRealTagIdx === -1) return null;
    const startSlice = text.slice(firstRealTagIdx);
    const openRe = /^<([A-Za-z_][\w.\-:]*)\b[^>]*>/;
    const openMatch = startSlice.match(openRe);
    if (!openMatch) return null;
    const root = openMatch[1];

    const tagRe = /<\/?([A-Za-z_][\w.\-:]*)\b[^>]*\/?>/g;
    let depth = 0, end = null, sawRoot = false, m;
    while ((m = tagRe.exec(startSlice))) {
      const full = m[0], name = m[1];
      const isClosing = full[1] === "/";
      const selfClosing = /\/>$/.test(full);
      if (name === root) {
        if (!isClosing && !selfClosing) { depth++; sawRoot = true; }
        else if (isClosing) depth--;
        if (sawRoot && depth === 0) { end = tagRe.lastIndex; break; }
      }
    }
    return end != null ? startSlice.slice(0, end) : null;
  };

  // ---- Balanced JSON extractors (object & array), string-aware ----
  function extractBalanced(text, openCh, closeCh) {
    const start = text.indexOf(openCh);
    if (start === -1) return null;

    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = false; continue; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null; // unbalanced
  }
  const extractBalancedJsonObject = (t) => extractBalanced(t, "{", "}");
  const extractBalancedJsonArray  = (t) => extractBalanced(t, "[", "]");

  // ---- XML parse tolerant of headers/fluff ----
  const tryParseXML = (text) => {
    try {
      const parser = new DOMParser();
      const firstRealTagIdx = text.search(/<(?!\?|!)[A-Za-z_][\w.\-:]*/);
      const candidateText = firstRealTagIdx >= 0 ? text.slice(firstRealTagIdx) : text;
      const noDoctype = stripDoctype(candidateText);
      let doc = parser.parseFromString(noDoctype, "application/xml");

      if (doc.getElementsByTagName("parsererror")[0]) {
        const frag = extractXmlFragment(text);
        if (!frag) return { ok: false };
        doc = parser.parseFromString(stripDoctype(frag), "application/xml");
        if (doc.getElementsByTagName("parsererror")[0]) return { ok: false };
      }

      const serialized = new XMLSerializer().serializeToString(doc.documentElement);
      return { ok: true, value: prettyXml(serialized) };
    } catch {
      return { ok: false };
    }
  };

  /**
   * Extract candidate content (JSON first, then XML).
   * 1) Exact JSON object/array
   * 2) Balanced JSON object/array (inside noisy text)
   * 3) Balanced XML fragment
   * 4) null
   */
  const extractCandidate = (text) => {
    const t = trimMaybe(text);

    // 1) Exact JSON (fast path)
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      return t;
    }

    // 2) Balanced JSON inside noise
    const jsonObj = extractBalancedJsonObject(t);
    if (jsonObj) return jsonObj;
    const jsonArr = extractBalancedJsonArray(t);
    if (jsonArr) return jsonArr;

    // 3) Balanced XML fragment
    const xmlFrag = extractXmlFragment(t);
    if (xmlFrag) return xmlFrag;

    return null;
  };

  // ----- detection path -----
  const original = trimMaybe(rawText);
  const candidate = extractCandidate(original);

  // Try JSON on candidate first
  if (candidate) {
    const asJson = tryParseJSON(candidate);
    if (asJson.ok) {
      return { detected: "json", formatted: JSON.stringify(asJson.value, null, 2) };
    }
    // Else try XML on candidate
    const asXmlFromCandidate = tryParseXML(candidate);
    if (asXmlFromCandidate.ok) {
      return { detected: "xml", formatted: asXmlFromCandidate.value };
    }
  }

  // Last chance: XML on whole string (tolerant)
  const asXmlWhole = tryParseXML(original);
  if (asXmlWhole.ok) {
    return { detected: "xml", formatted: asXmlWhole.value };
  }

  // Fallback plain text
  return { detected: "text", formatted: original };
}

// -------------------------------- Context menu flow --------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "prettifyLogs" || !info.selectionText) return;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [info.selectionText],
    func: prettifySelectionInPage
  }).then(async (injectionResults) => {
    const [{ result }] = injectionResults;
    const { detected, formatted } = result || { detected: "text", formatted: "No content" };
    await chrome.storage.local.set({ lastLogs: formatted, lastDetected: detected });
    await chrome.action.openPopup();
  }).catch(async (e) => {
    const msg = `Prettify failed: ${e?.message || e}`;
    await chrome.storage.local.set({ lastLogs: msg, lastDetected: "error" });
    await chrome.action.openPopup();
  });
});

// ------------------------------- Keyboard shortcuts ---------------------------------
// Define key combos in manifest.json; users can change them at chrome://extensions/shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-prettifier") {
    try { await chrome.action.openPopup(); } catch (e) {}
    return;
  }

  if (command === "prettify-selection-and-open") {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // 1) Get current selection text from the page
      const selResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (window.getSelection && window.getSelection().toString()) || ""
      });
      const selected = (selResult?.[0]?.result || "").trim();

      if (!selected) {
        await chrome.storage.local.set({
          lastLogs: "No selection found. Select some text and try again.",
          lastDetected: "text"
        });
        await chrome.action.openPopup();
        return;
      }

      // 2) Run the same prettify logic
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [selected],
        func: prettifySelectionInPage
      });

      const { detected, formatted } = injectionResults?.[0]?.result || { detected: "text", formatted: "No content" };
      await chrome.storage.local.set({ lastLogs: formatted, lastDetected: detected });
      await chrome.action.openPopup();
    } catch (e) {
      const msg = `Prettify failed: ${e?.message || e}`;
      await chrome.storage.local.set({ lastLogs: msg, lastDetected: "error" });
      await chrome.action.openPopup();
    }
  }
});
