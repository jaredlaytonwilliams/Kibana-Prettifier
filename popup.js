let fullLogs = "";
let lastDetected = "text";

document.addEventListener("DOMContentLoaded", () => {
  const searchBox = document.getElementById("searchBox");
  const badge = document.getElementById("detected");
  const scroller = document.getElementById("scroll");
  const output = document.getElementById("output");
  const hitMap = document.getElementById("hitMap");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const clearBtn = document.getElementById("clearBtn");
  const navCtrls = document.getElementById("navCtrls");
  const clearCtrls = document.getElementById("clearCtrls");
  const countEl = document.getElementById("count");

  let marks = [];            // NodeList -> Array
  let currentIndex = -1;     // active mark index

  // ---------------- helpers ----------------
  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function renderColored() {
  if (lastDetected === "xml") {
    output.innerHTML = highlightXmlEscaped(escapeHtml(fullLogs));
  } else if (lastDetected === "json") {
    output.innerHTML = highlightJson(fullLogs);
  } else {
    output.textContent = fullLogs;
  }
  // ensure a clean text-node layout before any searching
  output.normalize();
}

  // -------- XML coloring (escaped input) --------
  function colorXmlAttrs(attrChunk) {
    if (!attrChunk) return "";
    return attrChunk.replace(
      /([\s]+)([A-Za-z_][\w.\-:]*)(\s*=\s*)("(?:[^"]*)"|'(?:[^']*)'|[^\s"'=<>`]+)?/g,
      (_, ws, name, eq, val) => {
        const n = `<span class="xml-attr">${name}</span>`;
        const e = eq ? `<span class="xml-eq">${eq}</span>` : "";
        let v = "";
        if (val != null) {
          const quoted = /^".*"$|^'.*'$/.test(val);
          if (quoted) {
            const q1 = val[0], q2 = val[val.length - 1];
            const inner = val.slice(1, -1);
            v = `${q1}<span class="xml-val">${inner}</span>${q2}`;
          } else {
            v = `<span class="xml-val">${val}</span>`;
          }
        }
        return `${ws}${n}${e}${v}`;
      }
    );
  }
  function highlightXmlEscaped(escaped) {
    escaped = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, m =>
      `<span class="xml-comm">${m}</span>`);
    return escaped.replace(
      /(&lt;\/?)([A-Za-z_][\w.\-:]*)([\s\S]*?)(\/?&gt;)/g,
      (_, open, name, attrs, close) => {
        const o = `<span class="xml-punc">${open}</span>`;
        const n = `<span class="xml-tag">${name}</span>`;
        const a = colorXmlAttrs(attrs);
        const c = `<span class="xml-punc">${close}</span>`;
        return `${o}${n}${a}${c}`;
      }
    );
  }

  // -------- JSON coloring (pretty JSON string) --------
  function highlightJson(rawJson) {
    const escape = escapeHtml;
    const src = String(rawJson);
    const tokens = [];
    const re =
      /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g;
    let m;
    while ((m = re.exec(src))) {
      const text = m[0];
      let type = "text";
      if ("{}[]:,".includes(text)) type = "punc";
      else if (text === "true" || text === "false") type = "bool";
      else if (text === "null") type = "null";
      else if (text[0] === '"') {
        let i = re.lastIndex; while (i < src.length && /\s/.test(src[i])) i++;
        type = src[i] === ":" ? "key" : "string";
      } else type = "number";
      tokens.push({ start: m.index, end: m.index + text.length, text, type });
    }
    let out = "", cursor = 0;
    for (const t of tokens) {
      if (cursor < t.start) out += escape(src.slice(cursor, t.start));
      const esc = escape(t.text);
      switch (t.type) {
        case "punc":   out += `<span class="json-punc">${esc}</span>`; break;
        case "key":    out += `<span class="json-key">${esc}</span>`; break;
        case "string": out += `<span class="json-string">${esc}</span>`; break;
        case "number": out += `<span class="json-number">${esc}</span>`; break;
        case "bool":   out += `<span class="json-bool">${esc}</span>`; break;
        case "null":   out += `<span class="json-null">${esc}</span>`; break;
      }
      cursor = t.end;
    }
    if (cursor < src.length) out += escape(src.slice(cursor));
    return out;
  }

  // -------- Search highlighting ON TOP of syntax colors --------
  // Remove all existing <mark> wrappers, then merge adjacent text nodes
function clearMarks() {
  const ms = output.querySelectorAll("mark");
  ms.forEach(m => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  });
  output.normalize();                 // ← important: re-merge split text nodes
  marks = [];
  currentIndex = -1;
  updateHitMap?.();
  updateNavState?.();
}

// Wrap all matches of `term` (case-insensitive) in <mark> elements
function highlightSearch(term) {
  if (!term) { clearMarks(); return; }

  // Escape regex metacharacters
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(safe, "gi");

  // Walk *all* text nodes (don’t filter by trim); this avoids missing split nodes
  const walker = document.createTreeWalker(output, NodeFilter.SHOW_TEXT, null, false);

  // Collect first so we don’t mutate the live tree while walking it
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  // Replace each text node with a fragment containing <mark> wrappers
  for (const node of textNodes) {
    const text = node.nodeValue;
    if (!text) continue;

    re.lastIndex = 0;                 // reset per node
    let m, last = 0, any = false;
    const frag = document.createDocumentFragment();

    while ((m = re.exec(text))) {
      any = true;
      const before = text.slice(last, m.index);
      if (before) frag.appendChild(document.createTextNode(before));

      const mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);

      last = m.index + m[0].length;
    }

    if (!any) continue;               // nothing matched in this node

    const after = text.slice(last);
    if (after) frag.appendChild(document.createTextNode(after));

    node.parentNode.replaceChild(frag, node);
  }

  // Cache marks & select the first one
  marks = Array.from(output.querySelectorAll("mark"));
  currentIndex = marks.length ? 0 : -1;

  if (currentIndex >= 0) {
    setActiveByIndex?.(currentIndex, { scroll: true });
  }

  updateHitMap?.();
  updateNavState?.();
}


  // -------- Hit-map (ticks) --------
  function clearHitMap() { while (hitMap.firstChild) hitMap.removeChild(hitMap.firstChild); }
  function updateHitMap() {
    clearHitMap();
    if (!marks.length) return;

    const docHeight = output.scrollHeight || 1;
    marks.forEach((m, idx) => {
      const yPct = (m.offsetTop / docHeight) * 100;
      const tick = document.createElement("div");
      tick.className = "tick";
      if (idx === currentIndex) tick.classList.add("active");
      tick.style.top = `${yPct}%`;
      tick.title = `Match ${idx + 1}/${marks.length}`;
      tick.dataset.index = String(idx);
      tick.addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveByIndex(idx, { scroll: true });
      });
      hitMap.appendChild(tick);
    });
  }

  function updateTicksActive() {
    const ticks = hitMap.querySelectorAll(".tick");
    ticks.forEach((t, i) => t.classList.toggle("active", i === currentIndex));
  }

  // -------- Navigation (prev/next + counters) --------
  function updateNavState() {
    const visible = searchBox.value.trim().length > 0;
    navCtrls.style.display = visible ? "flex" : "none";
    clearCtrls.style.display = visible ? "flex" : "none";
    countEl.textContent = marks.length
      ? `${currentIndex + 1} / ${marks.length}`
      : "0 / 0";
    prevBtn.disabled = marks.length === 0;
    nextBtn.disabled = marks.length === 0;
  }

  function setActiveByIndex(idx, { scroll } = { scroll: false }) {
    // remove old active
    output.querySelectorAll("mark.active").forEach(m => m.classList.remove("active"));
    currentIndex = (idx >= 0 && idx < marks.length) ? idx : -1;

    if (currentIndex >= 0) {
      const el = marks[currentIndex];
      el.classList.add("active");
      if (scroll) {
        scroller.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
      }
    }
    updateTicksActive();
    updateNavState();
  }

  function gotoNext() {
    if (!marks.length) return;
    const next = (currentIndex + 1) % marks.length;
    setActiveByIndex(next, { scroll: true });
  }
  function gotoPrev() {
    if (!marks.length) return;
    const prev = (currentIndex - 1 + marks.length) % marks.length;
    setActiveByIndex(prev, { scroll: true });
  }

  // Sync active to nearest visible mark while scrolling
  let scrollRAF = null;
  scroller.addEventListener("scroll", () => {
    if (!marks.length) return;
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = null;
      const top = scroller.scrollTop;
      // find first mark not above top (with a small offset)
      let idx = marks.findIndex(m => m.offsetTop >= top + 10);
      if (idx === -1) idx = marks.length - 1;
      setActiveByIndex(idx);
    });
  });

  // -------- initial render from storage --------
  chrome.storage.local.get(["lastLogs", "lastDetected"], (data) => {
    fullLogs = data.lastLogs || "No logs captured yet.";
    lastDetected = data.lastDetected || "text";
    renderColored();
    if (badge && data.lastDetected) {
      badge.textContent = `Detected: ${String(data.lastDetected).toUpperCase()}`;
    }
  });

  // -------- search wiring --------
  function applySearch() {
    clearMarks();
    const term = searchBox.value.trim();
    if (!term) { updateNavState(); return; }
    highlightSearch(term);
  }

  searchBox.addEventListener("input", applySearch);

  // Enter = next, Shift+Enter = prev
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) gotoPrev();
      else gotoNext();
    }
  });

  nextBtn.addEventListener("click", gotoNext);
  prevBtn.addEventListener("click", gotoPrev);
  clearBtn.addEventListener("click", () => { searchBox.value = ""; applySearch(); });

  // Keep hit-map aligned if container resizes
  new ResizeObserver(() => updateHitMap()).observe(document.getElementById("viewer"));
});
