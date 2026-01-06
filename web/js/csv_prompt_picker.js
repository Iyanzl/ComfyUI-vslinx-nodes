import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_NAME = "vsLinx_MultiLangPromptPicker";

function toast(severity, summary, detail, life = 3000) {
  const t = app.extensionManager?.toast;
  if (t?.add) {
    t.add({ severity, summary, detail, life });
    return;
  }
  const fn =
    severity === "error" ? console.error :
      severity === "warn" ? console.warn :
        console.log;
  fn(`[${summary}] ${detail}`);
}

function ellipsizeToWidth(ctx, text, maxWidth) {
  text = String(text ?? "");
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  const ellW = ctx.measureText(ellipsis).width;
  if (ellW >= maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  const cut = Math.max(0, lo - 1);
  return text.slice(0, cut) + ellipsis;
}

function drawClippedText(ctx, text, x, yMid, w, h) {
  const padX = 10;
  const padY = 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    x + padX,
    yMid - h / 2 + padY,
    Math.max(0, w - padX * 2),
    Math.max(0, h - padY * 2)
  );
  ctx.clip();
  const maxTextW = Math.max(0, w - padX * 2);
  const t = ellipsizeToWidth(ctx, text, maxTextW);
  ctx.fillText(t, x + padX, yMid);
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawSmallX(ctx, x, y, w, h, color = "#e05555") {
  const pad = Math.max(4, Math.floor(Math.min(w, h) * 0.28));
  const x0 = x + pad;
  const y0 = y + pad;
  const x1 = x + w - pad;
  const y1 = y + h - pad;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.8, Math.min(w, h) * 0.12);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();
  ctx.restore();
}

function drawHoverOverlay(ctx, x, y, w, h, danger = false) {
  if (w <= 2 || h <= 2) return;
  ctx.save();
  ctx.globalAlpha = danger ? 0.10 : 0.08;
  ctx.fillStyle = danger ? "#e05555" : "#ffffff";
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 6);
  ctx.fill();
  ctx.globalAlpha = danger ? 0.22 : 0.16;
  ctx.strokeStyle = danger ? "#e05555" : "#ffffff";
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 6);
  ctx.stroke();
  ctx.restore();
}

function drawGripDots(ctx, x, y, w, h, active = false) {
  ctx.save();
  ctx.globalAlpha = active ? 0.92 : 0.72;
  ctx.fillStyle = "#d0d0d0";
  const cols = 2;
  const rows = 3;
  const r = Math.max(1.2, Math.min(w, h) * 0.07);
  const gapX = Math.max(r * 2.2, w * 0.18);
  const gapY = Math.max(r * 2.2, h * 0.14);
  const gridW = gapX * (cols - 1);
  const gridH = gapY * (rows - 1);
  const cx0 = x + w / 2 - gridW / 2;
  const cy0 = y + h / 2 - gridH / 2;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const px = cx0 + cx * gapX;
      const py = cy0 + ry * gapY;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function setCanvasCursor(cursor) {
  try {
    const c = app?.canvas?.canvas;
    if (c) c.style.cursor = cursor || "";
  } catch (_) { }
}

let vslinxHoverNode = null;
let vslinxDragNode = null;

function isDragging() {
  return !!(vslinxDragNode?._vslinxDrag?.row && vslinxDragNode._vslinxDrag.row._dragging);
}

function clearHoverOnNode(node) {
  if (!node) return;
  let changed = false;
  for (const w of (node.widgets || [])) {
    const t = w?.value?.type;
    if ((t === "CsvRowWidget" || t === "ExtraPromptWidget") && w._hover) {
      w._hover = null;
      changed = true;
    }
    if ((t === "CsvRowWidget" || t === "ExtraPromptWidget") && w._dragging) {
      w._dragging = false;
      changed = true;
    }
  }
  if (node._vslinxDrag) {
    node._vslinxDrag = null;
    changed = true;
  }
  if (changed) node.setDirtyCanvas(true, true);
}

async function uploadPromptFile(file, mode = "auto", rename_to = null) {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  if (rename_to) form.append("rename_to", rename_to);
  const res = await api.fetchApi("/vslinx/csv_prompt_upload", { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || `Upload failed (${res.status})`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

async function readPromptFile(filename) {
  const res = await api.fetchApi(`/vslinx/csv_prompt_read?filename=${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Read failed (${res.status})`);
  return await res.json();
}

async function listPromptFiles() {
  const res = await api.fetchApi("/vslinx/csv_prompt_list");
  if (!res.ok) throw new Error(`List failed (${res.status})`);
  const json = await res.json();
  return Array.isArray(json?.files) ? json.files : [];
}

function showAdditionalPromptModal(currentText = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.zIndex = "999999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.width = "720px";
    card.style.maxWidth = "94vw";
    card.style.maxHeight = "86vh";
    card.style.background = "#1f1f1f";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "12px";
    card.style.padding = "14px";
    card.style.color = "#eee";
    card.style.fontFamily = "sans-serif";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";

    const title = document.createElement("div");
    title.textContent = "Additional Prompt (multiline)";
    title.style.fontSize = "15px";
    title.style.fontWeight = "600";

    const hint = document.createElement("div");
    hint.textContent = "This text will be inserted into the prompt at this row’s position.";
    hint.style.fontSize = "12px";
    hint.style.opacity = "0.8";
    hint.style.lineHeight = "1.35";

    const ta = document.createElement("textarea");
    ta.value = String(currentText ?? "");
    ta.style.width = "100%";
    ta.style.minHeight = "220px";
    ta.style.maxHeight = "52vh";
    ta.style.resize = "vertical";
    ta.style.padding = "10px";
    ta.style.borderRadius = "10px";
    ta.style.border = "1px solid #555";
    ta.style.background = "#2b2b2b";
    ta.style.color = "#eee";
    ta.style.outline = "none";
    ta.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ta.style.fontSize = "12px";
    ta.style.lineHeight = "1.35";

    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.justifyContent = "flex-end";
    buttons.style.gap = "8px";

    const btn = (label) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.padding = "8px 10px";
      b.style.borderRadius = "10px";
      b.style.border = "1px solid #555";
      b.style.background = "#2b2b2b";
      b.style.color = "#eee";
      b.style.cursor = "pointer";
      return b;
    };

    const cancel = btn("Cancel");
    const clear = btn("Clear");
    const save = btn("Save");

    const cleanup = () => document.removeEventListener("keydown", onKeyDown, true);

    const close = (val) => {
      cleanup();
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(val);
    };

    cancel.onclick = () => close(null);
    clear.onclick = () => (ta.value = "");
    save.onclick = () => close(ta.value);

    overlay.onclick = (e) => {
      if (e.target === overlay) cancel.onclick();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") cancel.onclick();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save.onclick();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(ta);
    buttons.appendChild(cancel);
    buttons.appendChild(clear);
    buttons.appendChild(save);
    card.appendChild(buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.value.length;
      ta.selectionEnd = ta.value.length;
    }, 0);
  });
}

function showConflictModal({ filename, suggested }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.zIndex = "999999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.width = "560px";
    card.style.maxWidth = "92vw";
    card.style.background = "#1f1f1f";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "12px";
    card.style.padding = "14px";
    card.style.color = "#eee";
    card.style.fontFamily = "sans-serif";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";

    const title = document.createElement("div");
    title.textContent = "File already exists";
    title.style.fontSize = "16px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "8px";

    const msg = document.createElement("div");
    msg.style.fontSize = "13px";
    msg.style.lineHeight = "1.35";
    msg.style.opacity = "0.95";
    msg.innerHTML =
      `<div>A file named <b>${filename}</b> already exists in <code>input/csv</code> with different content.</div>` +
      `<div style="margin-top:8px">Choose what to do:</div>`;

    const inputWrap = document.createElement("div");
    inputWrap.style.marginTop = "10px";
    inputWrap.style.display = "flex";
    inputWrap.style.flexDirection = "column";
    inputWrap.style.gap = "6px";

    const label = document.createElement("div");
    label.textContent = "Rename to:";
    label.style.fontSize = "12px";
    label.style.opacity = "0.85";

    const input = document.createElement("input");
    input.type = "text";
    input.value = suggested || filename;
    input.style.padding = "10px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #555";
    input.style.background = "#2b2b2b";
    input.style.color = "#eee";
    input.style.outline = "none";

    inputWrap.appendChild(label);
    inputWrap.appendChild(input);

    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.justifyContent = "flex-end";
    buttons.style.marginTop = "14px";

    function makeBtn(labelText) {
      const b = document.createElement("button");
      b.textContent = labelText;
      b.style.padding = "8px 10px";
      b.style.borderRadius = "10px";
      b.style.border = "1px solid #555";
      b.style.background = "#2b2b2b";
      b.style.color = "#eee";
      b.style.cursor = "pointer";
      return b;
    }

    const cancel = makeBtn("Cancel");
    const rename = makeBtn("Rename");
    const overwrite = makeBtn("Overwrite");

    function close(result) {
      document.body.removeChild(overlay);
      resolve(result);
    }

    cancel.onclick = () => close({ action: "cancel" });
    overwrite.onclick = () => close({ action: "overwrite" });
    rename.onclick = () => close({ action: "rename", rename_to: input.value });

    overlay.onclick = (e) => {
      if (e.target === overlay) cancel.onclick();
    };

    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(inputWrap);
    buttons.appendChild(cancel);
    buttons.appendChild(rename);
    buttons.appendChild(overwrite);
    card.appendChild(buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

function showFilePickerModal(files, current = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.zIndex = "999999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.width = "620px";
    card.style.maxWidth = "94vw";
    card.style.maxHeight = "84vh";
    card.style.background = "#1f1f1f";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "12px";
    card.style.padding = "14px";
    card.style.color = "#eee";
    card.style.fontFamily = "sans-serif";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";

    const title = document.createElement("div");
    title.textContent = "Select CSV file (input/csv)";
    title.style.fontSize = "15px";
    title.style.fontWeight = "600";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search...";
    search.style.padding = "10px";
    search.style.borderRadius = "10px";
    search.style.border = "1px solid #555";
    search.style.background = "#2b2b2b";
    search.style.color = "#eee";
    search.style.outline = "none";

    const list = document.createElement("div");
    list.style.flex = "1";
    list.style.overflow = "auto";
    list.style.border = "1px solid #333";
    list.style.borderRadius = "10px";
    list.style.background = "#181818";

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.padding = "8px 10px";
    cancel.style.borderRadius = "10px";
    cancel.style.border = "1px solid #555";
    cancel.style.background = "#2b2b2b";
    cancel.style.color = "#eee";
    cancel.style.cursor = "pointer";

    cancel.onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) cancel.onclick();
    };

    function render(filterText) {
      list.innerHTML = "";
      const f = (filterText || "").trim().toLowerCase();
      const shown = files.filter((fn) => !f || fn.toLowerCase().includes(f));
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.textContent = "No matching files.";
        empty.style.padding = "10px";
        empty.style.opacity = "0.8";
        list.appendChild(empty);
        return;
      }

      for (const fn of shown) {
        const row = document.createElement("div");
        row.textContent = fn;
        row.style.padding = "10px 12px";
        row.style.cursor = "pointer";
        row.style.borderBottom = "1px solid #222";
        row.style.whiteSpace = "nowrap";
        row.style.overflow = "hidden";
        row.style.textOverflow = "ellipsis";

        if (fn === current) {
          row.style.background = "#2a2a2a";
          row.style.fontWeight = "600";
        }

        row.onmouseenter = () => (row.style.background = fn === current ? "#2f2f2f" : "#232323");
        row.onmouseleave = () => (row.style.background = fn === current ? "#2a2a2a" : "transparent");

        row.onclick = () => {
          document.body.removeChild(overlay);
          resolve(fn);
        };

        list.appendChild(row);
      }
    }

    search.oninput = () => render(search.value);

    footer.appendChild(cancel);

    card.appendChild(title);
    card.appendChild(search);
    card.appendChild(list);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    render("");
    setTimeout(() => search.focus(), 0);
  });
}

function showKeyPickerMenu(items, event, titleText = "Selection", opts = {}) {
  return new Promise((resolve) => {
    const ev = event?.originalEvent || event?.detail?.event || event;
    const cx = typeof ev?.clientX === "number" ? ev.clientX : 0;
    const cy = typeof ev?.clientY === "number" ? ev.clientY : 0;

    const initialSelected = Array.isArray(opts?.selected) ? opts.selected.map(String) : [];

    let multiMode = false;
    const selected = new Set(initialSelected);

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "transparent";
    overlay.style.zIndex = "1000000";

    const card = document.createElement("div");
    card.style.position = "absolute";
    card.style.left = "0px";
    card.style.top = "0px";
    card.style.width = "340px";
    card.style.maxWidth = "86vw";
    card.style.background = "#1f1f1f";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "12px";
    card.style.padding = "10px";
    card.style.color = "#eee";
    card.style.fontFamily = "sans-serif";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "8px";

    const title = document.createElement("div");
    title.textContent = titleText;
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.opacity = "0.95";

    const filterRow = document.createElement("div");
    filterRow.style.display = "flex";
    filterRow.style.gap = "8px";
    filterRow.style.alignItems = "center";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Filter";
    search.style.flex = "1";
    search.style.padding = "9px 10px";
    search.style.borderRadius = "10px";
    search.style.border = "1px solid #555";
    search.style.background = "#2b2b2b";
    search.style.color = "#eee";
    search.style.outline = "none";

    const modeBtn = document.createElement("button");
    modeBtn.style.width = "36px";
    modeBtn.style.height = "36px";
    modeBtn.style.borderRadius = "10px";
    modeBtn.style.border = "1px solid #555";
    modeBtn.style.background = "#2b2b2b";
    modeBtn.style.color = "#eee";
    modeBtn.style.cursor = "pointer";
    modeBtn.style.display = "grid";
    modeBtn.style.placeItems = "center";
    modeBtn.style.padding = "0";

    function setModeButtonVisual() {
      if (!multiMode) {
        modeBtn.style.background = "#2b2b2b";
        modeBtn.style.borderColor = "#555";
        modeBtn.textContent = "⧉";
        modeBtn.title = "Enable multi-select";
      } else {
        modeBtn.style.background = "#1f3a25";
        modeBtn.style.borderColor = "#2d7a40";
        modeBtn.textContent = "✓";
        modeBtn.title = "Confirm selection";
      }
    }

    setModeButtonVisual();

    modeBtn.onclick = (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();

      if (!multiMode) {
        multiMode = true;
        selected.delete("(None)");
        setModeButtonVisual();
        render(search.value);
        return;
      }

      const chosen = Array.from(selected)
        .map(String)
        .filter((s) => s && s !== "(None)");

      cleanup();
      if (overlay.parentNode) document.body.removeChild(overlay);

      if (chosen.length === 0) {
        resolve({ mode: "clear" });
        return;
      }
      if (chosen.length === 1) {
        const one = chosen[0];
        const pickedItem = (items || []).find((it) => String(it?.content ?? "") === one) || { content: one };
        resolve({ mode: "single", picked: pickedItem });
        return;
      }
      resolve({ mode: "multi", selected: chosen });
    };

    filterRow.appendChild(search);
    filterRow.appendChild(modeBtn);

    const list = document.createElement("div");
    list.style.maxHeight = "320px";
    list.style.overflow = "auto";
    list.style.border = "1px solid #333";
    list.style.borderRadius = "10px";
    list.style.background = "#181818";

    const close = () => {
      cleanup();
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(null);
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
      if (multiMode && (e.key === "Enter" || e.key === "Return")) {
        modeBtn.onclick(e);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    const cleanup = () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };

    function addClearRow() {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.padding = "9px 10px";
      row.style.cursor = "pointer";
      row.style.borderBottom = "1px solid #222";
      row.style.whiteSpace = "nowrap";
      row.style.overflow = "hidden";
      row.style.background = "transparent";

      const label = document.createElement("div");
      label.textContent = "Clear";
      label.style.flex = "1";
      label.style.opacity = "0.95";

      const mark = document.createElement("div");
      mark.style.width = "18px";
      mark.style.minWidth = "18px";
      mark.style.textAlign = "center";
      mark.style.opacity = "0.9";
      mark.textContent = selected.size ? "↺" : "";

      row.onmouseenter = () => (row.style.background = "#232323");
      row.onmouseleave = () => (row.style.background = "transparent");

      row.onclick = (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        selected.clear();
        render(search.value);
      };

      row.appendChild(label);
      row.appendChild(mark);

      const wrap = document.createElement("div");
      wrap.style.paddingBottom = "6px";
      wrap.appendChild(row);
      list.appendChild(wrap);

      const sep = document.createElement("div");
      sep.style.height = "1px";
      sep.style.background = "#222";
      sep.style.margin = "6px 0 8px 0";
      list.appendChild(sep);
    }

    function render(filterText) {
      list.innerHTML = "";
      const f = (filterText || "").trim().toLowerCase();

      const shown = (items || []).filter((it) => {
        const t = String(it?.content ?? "");
        if (multiMode && t === "(None)") return false;
        return !f || t.toLowerCase().includes(f);
      });

      if (multiMode) addClearRow();

      if (!shown.length) {
        const empty = document.createElement("div");
        empty.textContent = "No matches.";
        empty.style.padding = "10px";
        empty.style.opacity = "0.8";
        list.appendChild(empty);
        return;
      }

      for (const it of shown) {
        const content = String(it?.content ?? "");
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.padding = "9px 10px";
        row.style.cursor = "pointer";
        row.style.borderBottom = "1px solid #222";
        row.style.whiteSpace = "nowrap";
        row.style.overflow = "hidden";

        const label = document.createElement("div");
        label.textContent = content;
        label.style.flex = "1";
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";

        const mark = document.createElement("div");
        mark.style.width = "18px";
        mark.style.minWidth = "18px";
        mark.style.textAlign = "center";
        mark.style.opacity = "0.95";

        const isSel = selected.has(content);
        if (multiMode) {
          mark.textContent = isSel ? "✓" : "";
          row.style.background = isSel ? "#242e25" : "transparent";
        } else {
          mark.textContent = "";
          row.style.background = "transparent";
        }

        row.onmouseenter = () => {
          row.style.background = multiMode
            ? (selected.has(content) ? "#283328" : "#232323")
            : "#232323";
        };
        row.onmouseleave = () => {
          row.style.background = multiMode
            ? (selected.has(content) ? "#242e25" : "transparent")
            : "transparent";
        };

        row.onclick = (e) => {
          e.preventDefault?.();
          e.stopPropagation?.();

          if (!multiMode) {
            cleanup();
            if (overlay.parentNode) document.body.removeChild(overlay);
            resolve({ mode: "single", picked: it });
            return;
          }

          if (selected.has(content)) selected.delete(content);
          else selected.add(content);

          render(search.value);
        };

        row.appendChild(label);
        row.appendChild(mark);
        list.appendChild(row);
      }
    }

    search.oninput = () => render(search.value);

    card.appendChild(title);
    card.appendChild(filterRow);
    card.appendChild(list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    render("");

    const pad = 8;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    const rect = card.getBoundingClientRect();
    let left = cx;
    let top = cy;

    if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height + pad > vh) top = Math.max(pad, vh - rect.height - pad);

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    setTimeout(() => {
      search.focus();
      search.select();
    }, 0);
  });
}

function pickFilesFromDialog() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".csv,text/csv";
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

async function uploadWithConflictResolution(file) {
  let up;
  let overwriteWasChosen = false;

  try {
    up = await uploadPromptFile(file, "auto");
  } catch (e) {
    if (e?.status === 409 && e?.data?.error === "NAME_CONFLICT") {
      const choice = await showConflictModal({
        filename: e.data.filename,
        suggested: e.data.suggested,
      });

      if (choice.action === "cancel") return { cancelled: true };

      if (choice.action === "overwrite") {
        overwriteWasChosen = true;
        up = await uploadPromptFile(file, "overwrite");
      } else if (choice.action === "rename") {
        up = await uploadPromptFile(file, "rename", choice.rename_to);
      } else {
        return { cancelled: true };
      }
    } else {
      throw e;
    }
  }

  return { cancelled: false, overwriteWasChosen, up };
}

function getRowWidgets(node) {
  return (node.widgets || []).filter((w) => {
    const t = w?.value?.type;
    return t === "CsvRowWidget" || t === "ExtraPromptWidget";
  });
}

function isRowWidget(w) {
  const t = w?.value?.type;
  return t === "CsvRowWidget" || t === "ExtraPromptWidget";
}

function hasRowForFilename(node, filename, excludeWidget = null) {
  return (node.widgets || []).some((w) => {
    if (w === excludeWidget) return false;
    if (w?.value?.type !== "CsvRowWidget") return false;
    return w?.value?.file === filename;
  });
}

function removeRowsForFilename(node, filename) {
  const rows = (node.widgets || []).filter((w) => w?.value?.type === "CsvRowWidget");
  for (const row of rows) {
    if (row?.value?.file === filename) {
      const idx = node.widgets.indexOf(row);
      if (idx !== -1) node.widgets.splice(idx, 1);
    }
  }
}

function recomputeNodeSize(node) {
  try {
    const computed = node.computeSize?.();
    if (computed && node.size) {
      node.size[0] = Math.max(node.size[0], computed[0]);
      node.size[1] = Math.max(80, computed[1]);
    }
  } catch (_) { }
}

const LIST_TOP_SPACER_ID = "vslinx_list_top_spacer";
const BUTTON_SPACER_ID = "vslinx_select_csv_spacer";
const BUTTON_ID = "vslinx_select_csv_button";
const BUTTON_LABEL = "Select CSV File";

const EXTRA_PROMPT_ID = "vslinx_extra_prompt_row";
const EXTRA_PROMPT_NAME = "csv_additional_prompt";

const LIST_SIDE_MARGIN = (globalThis?.LiteGraph?.NODE_WIDGET_MARGIN ?? 10);
const ROW_HEIGHT = 54;

const DRAG_SNAP_FRACTION = 0.50;
const DRAG_SNAP_ENTER = 0.15;
const DRAG_SNAP_EXIT = 0.65;

const DRAG_HANDLE_W = 22;
const DRAG_HANDLE_GAP = 8;

function isListTopSpacer(w) { return w?._vslinx_id === LIST_TOP_SPACER_ID; }
function isButtonSpacer(w) { return w?._vslinx_id === BUTTON_SPACER_ID; }
function isBottomButton(w) { return w?._vslinx_id === BUTTON_ID; }
function isExtraPromptRow(w) { return w?._vslinx_id === EXTRA_PROMPT_ID; }

function updateRowOrders(node) {
  const rows = getRowWidgets(node);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.value && typeof rows[i].value === "object") {
      rows[i].value.order = i;
    }
  }
}

function ensureListTopSpacer(node, height = 10) {
  const existing = (node.widgets || []).find(isListTopSpacer);
  if (existing) return existing;

  const spacer = {
    type: "custom",
    name: " ",
    _vslinx_id: LIST_TOP_SPACER_ID,
    value: { type: "VslinxListTopSpacer" },
    serialize: false,
    serializeValue() { return undefined; },
    computeSize() { return [0, height]; },
    draw() { },
  };

  node.addCustomWidget(spacer);
  return spacer;
}

function ensureButtonSpacer(node, height = 10) {
  const existing = (node.widgets || []).find(isButtonSpacer);
  if (existing) return existing;

  const spacer = {
    type: "custom",
    name: " ",
    _vslinx_id: BUTTON_SPACER_ID,
    value: { type: "VslinxButtonSpacer" },
    serialize: false,
    serializeValue() { return undefined; },
    computeSize() { return [0, height]; },
    draw() { },
  };

  node.addCustomWidget(spacer);
  return spacer;
}

function layoutWidgets(node) {
  const widgets = node.widgets || [];
  const rows = widgets.filter(isRowWidget);
  const topSpacer = widgets.find(isListTopSpacer) || null;
  const btnSpacer = widgets.find(isButtonSpacer) || null;
  const btn = widgets.find(isBottomButton) || null;

  const rest = widgets.filter((w) => {
    if (isRowWidget(w)) return false;
    if (w === topSpacer) return false;
    if (w === btnSpacer) return false;
    if (w === btn) return false;
    if (isListTopSpacer(w)) return false;
    if (isButtonSpacer(w)) return false;
    if (isBottomButton(w)) return false;
    return true;
  });

  const next = [...rest];
  if (topSpacer) next.push(topSpacer);
  next.push(...rows);
  if (btnSpacer) next.push(btnSpacer);
  if (btn) next.push(btn);

  node.widgets = next;
  updateRowOrders(node);
}

function removeAllVslinxUiWidgets(node) {
  node.widgets = (node.widgets || []).filter((w) => {
    if (isRowWidget(w)) return false;
    if (isListTopSpacer(w)) return false;
    if (isButtonSpacer(w)) return false;
    if (isBottomButton(w)) return false;
    if (isExtraPromptRow(w)) return false;
    if (w?._vslinx_id === LIST_TOP_SPACER_ID) return false;
    if (w?._vslinx_id === BUTTON_SPACER_ID) return false;
    if (w?._vslinx_id === BUTTON_ID) return false;
    if (w?._vslinx_id === EXTRA_PROMPT_ID) return false;
    return true;
  });
}

function ensureSelectButton(node) {
  const existing = (node.widgets || []).find(isBottomButton);
  if (existing) return existing;

  ensureListTopSpacer(node, 10);
  ensureButtonSpacer(node, 10);

  const btn = node.addWidget("button", BUTTON_LABEL, null, async () => {
    const files = await pickFilesFromDialog();
    if (!files || !files.length) return true;

    for (const file of files) {
      try {
        const { cancelled, overwriteWasChosen, up } = await uploadWithConflictResolution(file);
        if (cancelled) continue;

        const filename = up.filename;

        if (up.deduped === true && hasRowForFilename(node, filename)) {
          toast("info", "Already added", filename, 2500);
          continue;
        }

        if (up.overwritten === true || overwriteWasChosen) {
          removeRowsForFilename(node, filename);
        }

        node._csvRowCounter = (node._csvRowCounter || 0) + 1;
        const row = new CsvRowWidget("csv_" + node._csvRowCounter);
        node.addCustomWidget(row);

        row.value.order = getRowWidgets(node).length;
        await row.setFile(filename);

        layoutWidgets(node);
        recomputeNodeSize(node);
        node.setDirtyCanvas(true, true);
      } catch (e) {
        console.error(e);
        toast("error", "File Upload", String(e?.message || e), 4500);
      }
    }

    layoutWidgets(node);
    recomputeNodeSize(node);
    node.setDirtyCanvas(true, true);
    return true;
  });

  btn.serialize = false;
  btn._vslinx_id = BUTTON_ID;

  layoutWidgets(node);
  return btn;
}

function getRowsInOrder(node) {
  return getRowWidgets(node);
}

function reorderDraggedRow(node, draggedRow, targetIndex) {
  const rows = getRowsInOrder(node);
  const from = rows.indexOf(draggedRow);
  if (from === -1) return false;

  const clamped = Math.max(0, Math.min(targetIndex, rows.length - 1));
  if (clamped === from) return false;

  const nextRows = rows.slice();
  nextRows.splice(from, 1);
  nextRows.splice(clamped, 0, draggedRow);

  const nonRows = (node.widgets || []).filter((w) => !isRowWidget(w));
  node.widgets = [...nonRows, ...nextRows];

  layoutWidgets(node);
  node.setDirtyCanvas(true, true);
  return true;
}

function computeTargetIndex(node, probeY, draggedRow, dirY = 0) {
  const rows = getRowsInOrder(node);
  const others = rows.filter((r) => r !== draggedRow);

  if (!others.length) return 0;

  let minY = Infinity;
  for (const r of others) {
    const ry = r?._rowY;
    if (typeof ry === "number" && ry < minY) minY = ry;
  }
  if (!Number.isFinite(minY)) minY = 10;

  const thresh = dirY >= 0 ? DRAG_SNAP_ENTER : DRAG_SNAP_EXIT;

  for (let i = 0; i < others.length; i++) {
    const r = others[i];
    const ry = typeof r?._rowY === "number" ? r._rowY : (minY + i * ROW_HEIGHT);
    const triggerLine = ry + ROW_HEIGHT * thresh;
    if (probeY < triggerLine) return i;
  }
  return others.length;
}

function drawDropPlaceholderAt(ctx, node, y) {
  if (typeof y !== "number") return;

  const x = LIST_SIDE_MARGIN;
  const w = Math.max(0, (node?.size?.[0] ?? 0) - LIST_SIDE_MARGIN * 2);
  const h = ROW_HEIGHT;
  const padY = 2;
  const yy = y + padY;
  const hh = h - padY * 2;

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#000000";
  roundRectPath(ctx, x + 2, yy + 2, w - 4, hh - 4, 10);
  ctx.fill();

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, x + 1, yy + 1, w - 2, hh - 2, 10);
  ctx.fill();

  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 1, yy + 1, w - 2, hh - 2, 10);
  ctx.stroke();
  ctx.restore();
}

function drawGhostRow(ctx, node, row, ghostY) {
  const x = LIST_SIDE_MARGIN;
  const w = Math.max(0, (node?.size?.[0] ?? 0) - LIST_SIDE_MARGIN * 2);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000000";
  roundRectPath(ctx, x + 6, ghostY + 6, w - 12, ROW_HEIGHT - 6, 12);
  ctx.fill();

  ctx.globalAlpha = 0.98;
  row._render(ctx, node, w, ghostY, { ghost: true });

  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 1, ghostY + 1, w - 2, ROW_HEIGHT - 2, 10);
  ctx.stroke();

  ctx.restore();
}

function restoreOriginalOrder(node, originalRows) {
  if (!node || !Array.isArray(originalRows) || !originalRows.length) return;
  const currentRows = getRowsInOrder(node);
  const present = new Set(currentRows);
  const restored = originalRows.filter((r) => present.has(r));
  for (const r of currentRows) {
    if (!restored.includes(r)) restored.push(r);
  }
  const nonRows = (node.widgets || []).filter((w) => !isRowWidget(w));
  node.widgets = [...nonRows, ...restored];
  layoutWidgets(node);
  node.setDirtyCanvas(true, true);
}

function endDrag(node, commit = true) {
  const d = node?._vslinxDrag;
  if (!d?.row) return;

  const row = d.row;

  row._dragging = false;
  row._hover = null;

  node._vslinxDrag = null;
  vslinxDragNode = null;

  if (!commit) {
    restoreOriginalOrder(node, d.originalRows);
  }

  setCanvasCursor("");
  updateRowOrders(node);
  node.setDirtyCanvas(true, true);
}

class ExtraPromptWidget {
  constructor(name) {
    this.name = name;
    this.type = "custom";
    this.value = { type: "ExtraPromptWidget", text: "", order: 0 };
    this._hover = null;
    this._rowY = null;
    this._dragging = false;
    this._bounds = {
      drag: [0, 0, 0, 0],
      edit: [0, 0, 0, 0],
    };
  }

  computeSize() { return [0, ROW_HEIGHT]; }
  serializeValue() { return this.value; }

  _hitPart(pos) {
    const x = pos[0];
    const y = pos[1];
    const inRect = (r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
    if (inRect(this._bounds.drag)) return "drag";
    if (inRect(this._bounds.edit)) return "edit";
    return null;
  }

  _render(ctx, node, _width, y, { ghost = false } = {}) {
    if (!ghost) this._rowY = y;

    const height = ROW_HEIGHT;
    const x = LIST_SIDE_MARGIN;
    const w = Math.max(0, (node?.size?.[0] ?? _width) - LIST_SIDE_MARGIN * 2);

    const innerPadY = 2;
    const yy = y + innerPadY;
    const hh = Math.max(0, height - innerPadY * 2);

    const handleW = DRAG_HANDLE_W;
    const gap = DRAG_HANDLE_GAP;

    const handleX = x;
    const handleY = yy;

    const tableX = x + handleW + gap;
    const tableW = Math.max(0, w - handleW - gap);

    ctx.save();

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#232323";
    roundRectPath(ctx, handleX, handleY, handleW, hh, 7);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 1;
    roundRectPath(ctx, handleX, handleY, handleW, hh, 7);
    ctx.stroke();

    if (this._hover === "drag" || this._dragging) drawHoverOverlay(ctx, handleX, handleY, handleW, hh, false);
    drawGripDots(ctx, handleX, handleY, handleW, hh, this._dragging);

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#262626";
    roundRectPath(ctx, tableX, yy, tableW, hh, 7);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 1;
    roundRectPath(ctx, tableX, yy, tableW, hh, 7);
    ctx.stroke();

    if (this._hover === "edit") drawHoverOverlay(ctx, tableX, yy, tableW, hh, false);

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;

    const prevFont = ctx.font;
    const prevAlign = ctx.textAlign;
    const prevBase = ctx.textBaseline;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const mid = yy + hh / 2;

    ctx.save();
    ctx.globalAlpha = 0.80;
    ctx.fillText("Additional prompt:", tableX + 10, mid - 9);
    ctx.restore();

    const raw = String(this.value.text ?? "").replace(/\r/g, "");
    const firstLine = (raw.split("\n")[0] ?? "").trim();
    const preview = firstLine || "(click to edit)";

    ctx.save();
    ctx.globalAlpha = 0.95;
    const maxW = Math.max(0, tableW - 20);
    ctx.fillText(ellipsizeToWidth(ctx, preview, maxW), tableX + 10, mid + 9);
    ctx.restore();

    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBase;

    ctx.restore();

    if (!ghost) {
      this._bounds.drag = [handleX, handleY, handleW, hh];
      this._bounds.edit = [tableX, yy, tableW, hh];
    }
  }

  draw(ctx, node, _width, y) {
    const d = node?._vslinxDrag;
    if (d?.row === this && this._dragging) {
      this._rowY = y;
      return;
    }
    this._render(ctx, node, _width, y, { ghost: false });
  }

  mouse(event, pos, node) {
    const t = event?.type || "";
    const isDown = (t === "pointerdown" || t === "mousedown");
    const isMove = (t === "pointermove" || t === "mousemove");
    const isUp = (
      t === "pointerup" || t === "mouseup" ||
      t === "pointercancel" || t === "mouseleave" || t === "pointerleave"
    );

    if (this._dragging) {
      if (isMove) {
        const buttons = typeof event?.buttons === "number" ? event.buttons : 1;
        if ((buttons & 1) === 0) {
          endDrag(node, false);
          return true;
        }

        const d = node._vslinxDrag;
        if (!d) return true;

        const pointerY = pos?.[1];
        if (typeof pointerY === "number") {
          d.ghostY = pointerY - d.offsetY;

          const probeY = d.ghostY + ROW_HEIGHT * DRAG_SNAP_FRACTION;
          const lastProbeY = (typeof d.lastProbeY === "number") ? d.lastProbeY : probeY;
          const dirY = probeY - lastProbeY;
          d.lastProbeY = probeY;

          const targetIndex = computeTargetIndex(node, probeY, this, dirY);
          const rows = getRowsInOrder(node);
          const currentIndex = rows.indexOf(this);
          const clampedTarget = Math.max(0, Math.min(targetIndex, rows.length - 1));
          if (clampedTarget !== currentIndex) {
            reorderDraggedRow(node, this, clampedTarget);
          }

          node.setDirtyCanvas(true, true);
        }

        this._hover = "drag";
        setCanvasCursor("grabbing");
        return true;
      }

      if (isUp) {
        endDrag(node, true);
        return true;
      }

      return true;
    }

    if (!isDown) return false;
    if (event.button !== 0) return false;

    const part = this._hitPart(pos);

    if (part === "drag") {
      const rows = getRowsInOrder(node);
      const startIndex = rows.indexOf(this);

      this._dragging = true;
      this._hover = "drag";

      const pointerY = pos?.[1] ?? 0;
      const rowTop = typeof this._rowY === "number" ? this._rowY : pointerY;
      const offsetY = pointerY - rowTop;

      node._vslinxDrag = {
        row: this,
        offsetY,
        ghostY: rowTop,
        originalRows: rows.slice(),
        startIndex,
        lastProbeY: rowTop + ROW_HEIGHT * DRAG_SNAP_FRACTION,
      };

      vslinxDragNode = node;

      setCanvasCursor("grabbing");
      node.setDirtyCanvas(true, true);

      return true;
    }

    if (part === "edit") {
      showAdditionalPromptModal(this.value.text || "").then((txt) => {
        if (txt === null) return;
        this.value.text = String(txt ?? "");
        layoutWidgets(node);
        node.setDirtyCanvas(true, true);
      });
      return true;
    }

    return false;
  }
}

function ensureExtraPromptRow(node) {
  const existing = (node.widgets || []).find(isExtraPromptRow);
  if (existing) return existing;

  const w = new ExtraPromptWidget(EXTRA_PROMPT_NAME);
  w._vslinx_id = EXTRA_PROMPT_ID;
  node.addCustomWidget(w);

  layoutWidgets(node);
  return w;
}

class CsvRowWidget {
  constructor(name) {
    this.name = name;
    this.type = "custom";
    this.value = { type: "CsvRowWidget", file: "", key: "(None)", keys: [], order: 0 };
    this._labels = [];
    this._map = {};
    this._hover = null;
    this._rowY = null;
    this._dragging = false;
    this._bounds = {
      drag: [0, 0, 0, 0],
      file: [0, 0, 0, 0],
      remove: [0, 0, 0, 0],
      sel: [0, 0, 0, 0],
      out: [0, 0, 0, 0],
    };
  }

  computeSize() { return [0, ROW_HEIGHT]; }

  async setFile(filename) {
    this.value.file = filename;
    this.value.key = "(None)";
    this.value.keys = [];
    const data = await readPromptFile(filename);
    this._labels = ["(None)", "Random", ...(data.labels || [])];
    this._map = data.map || {};
  }

  serializeValue() { return this.value; }

  _getKeysEffective() {
    if (Array.isArray(this.value.key)) {
      return this.value.key.map(String).filter((s) => s && s !== "(None)");
    }

    const keys = Array.isArray(this.value.keys) ? this.value.keys.map(String).filter(Boolean) : [];
    if (keys.length) return keys.filter((s) => s !== "(None)");

    const k = String(this.value.key ?? "");
    if (!k || k === "(None)") return [];
    return [k];
  }

  _getSelPreviewText() {
    const keys = this._getKeysEffective();
    if (!keys.length) return "(None)";
    if (keys.length === 1) return keys[0];
    return `${keys.length} selected`;
  }

  _getOutPreview() {
    const keys = this._getKeysEffective();
    if (!keys.length) return "";

    const outs = [];
    for (const k of keys) {
      if (!k || k === "(None)") continue;
      if (k === "Random") {
        outs.push("(random pick at runtime)");
        continue;
      }
      const v = this._map[k];
      if (v) outs.push(v);
    }
    if (!outs.length) return "";
    return outs.join(" | ");
  }

  async _handlePickFile(node) {
    try {
      const files = await listPromptFiles();
      if (!files.length) {
        toast("warn", "No files", "No .csv files found in input/csv", 3500);
        return;
      }

      const picked = await showFilePickerModal(files, this.value.file || "");
      if (!picked) return;

      if (hasRowForFilename(node, picked, this)) {
        const idx = node.widgets.indexOf(this);
        if (idx !== -1) node.widgets.splice(idx, 1);

        layoutWidgets(node);
        recomputeNodeSize(node);
        node.setDirtyCanvas(true, true);

        toast("warn", "Duplicate entry", "That file is already in the list – removed this entry.", 3500);
        return;
      }

      await this.setFile(picked);
      layoutWidgets(node);
      recomputeNodeSize(node);
      node.setDirtyCanvas(true, true);
    } catch (e) {
      console.error(e);
      toast("error", "File Picker", String(e?.message || e), 4500);
    }
  }

  _handleRemove(node) {
    const idx = node.widgets.indexOf(this);
    if (idx !== -1) node.widgets.splice(idx, 1);
    layoutWidgets(node);
    recomputeNodeSize(node);
    node.setDirtyCanvas(true, true);
  }

  _hitPart(pos) {
    const x = pos[0];
    const y = pos[1];
    const inRect = (r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

    if (inRect(this._bounds.drag)) return "drag";
    if (inRect(this._bounds.remove)) return "remove";
    if (inRect(this._bounds.file)) return "file";
    if (inRect(this._bounds.sel)) return "sel";
    return null;
  }

  _render(ctx, node, _width, y, { ghost = false } = {}) {
    if (!ghost) this._rowY = y;

    const height = ROW_HEIGHT;
    const x = LIST_SIDE_MARGIN;
    const w = Math.max(0, (node?.size?.[0] ?? _width) - LIST_SIDE_MARGIN * 2);

    const innerPadY = 2;
    const yy = y + innerPadY;
    const hh = Math.max(0, height - innerPadY * 2);

    const handleW = DRAG_HANDLE_W;
    const gap = DRAG_HANDLE_GAP;

    const handleX = x;
    const handleY = yy;
    const handleH = hh;

    const tableX = x + handleW + gap;
    const tableW = Math.max(0, w - handleW - gap);

    const topH = Math.floor(hh * 0.52);
    const botH = hh - topH;

    const topY = yy;
    const botY = yy + topH;

    const removeW = Math.max(28, Math.floor(tableW * 0.06));
    const fileW = Math.max(0, tableW - removeW);

    const fileX = tableX;
    const remX = tableX + fileW;

    const selW = Math.floor(tableW / 2);
    const outW = tableW - selW;
    const selX = tableX;
    const outX = tableX + selW;

    ctx.save();

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#232323";
    roundRectPath(ctx, handleX, handleY, handleW, handleH, 7);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 1;
    roundRectPath(ctx, handleX, handleY, handleW, handleH, 7);
    ctx.stroke();

    if (this._hover === "drag" || this._dragging) drawHoverOverlay(ctx, handleX, handleY, handleW, handleH, false);
    drawGripDots(ctx, handleX, handleY, handleW, handleH, this._dragging);

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#262626";
    roundRectPath(ctx, tableX, yy, tableW, hh, 7);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 1;
    roundRectPath(ctx, tableX, yy, tableW, hh, 7);
    ctx.stroke();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.moveTo(tableX + 6, botY);
    ctx.lineTo(tableX + tableW - 6, botY);
    ctx.moveTo(remX, topY + 3);
    ctx.lineTo(remX, topY + topH - 3);
    ctx.moveTo(outX, botY + 3);
    ctx.lineTo(outX, botY + botH - 3);
    ctx.stroke();

    if (this._hover === "file") drawHoverOverlay(ctx, fileX, topY, fileW, topH, false);
    else if (this._hover === "remove") drawHoverOverlay(ctx, remX, topY, removeW, topH, true);
    else if (this._hover === "sel") drawHoverOverlay(ctx, selX, botY, selW, botH, false);

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;

    const prevFont = ctx.font;
    const prevAlign = ctx.textAlign;
    const prevBase = ctx.textBaseline;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = prevFont;

    const fileMid = topY + topH / 2;
    drawClippedText(ctx, this.value.file || "(click to choose file)", fileX, fileMid, fileW, topH);

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#2a1e1e";
    roundRectPath(ctx, remX + 4, topY + 4, removeW - 8, topH - 8, 7);
    ctx.fill();
    ctx.restore();
    drawSmallX(ctx, remX + 4, topY + 4, removeW - 8, topH - 8, "#e05555");

    const botMid = botY + botH / 2;

    const selText = this._getSelPreviewText();
    drawClippedText(ctx, selText, selX, botMid, selW, botH);

    const outVal = this._getOutPreview();
    drawClippedText(ctx, outVal, outX, botMid, outW, botH);

    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBase;

    ctx.restore();

    if (!ghost) {
      this._bounds.drag = [handleX, handleY, handleW, handleH];
      this._bounds.file = [fileX, topY, fileW, topH];
      this._bounds.remove = [remX, topY, removeW, topH];
      this._bounds.sel = [selX, botY, selW, botH];
      this._bounds.out = [outX, botY, outW, botH];
    }
  }

  draw(ctx, node, _width, y) {
    const d = node?._vslinxDrag;
    if (d?.row === this && this._dragging) {
      this._rowY = y;
      return;
    }
    this._render(ctx, node, _width, y, { ghost: false });
  }

  mouse(event, pos, node) {
    const t = event?.type || "";
    const isDown = (t === "pointerdown" || t === "mousedown");
    const isMove = (t === "pointermove" || t === "mousemove");
    const isUp = (
      t === "pointerup" || t === "mouseup" ||
      t === "pointercancel" || t === "mouseleave" || t === "pointerleave"
    );

    if (this._dragging) {
      if (isMove) {
        const buttons = typeof event?.buttons === "number" ? event.buttons : 1;
        if ((buttons & 1) === 0) {
          endDrag(node, false);
          return true;
        }

        const d = node._vslinxDrag;
        if (!d) return true;

        const pointerY = pos?.[1];
        if (typeof pointerY === "number") {
          d.ghostY = pointerY - d.offsetY;

          const probeY = d.ghostY + ROW_HEIGHT * DRAG_SNAP_FRACTION;

          const lastProbeY = (typeof d.lastProbeY === "number") ? d.lastProbeY : probeY;
          const dirY = probeY - lastProbeY;
          d.lastProbeY = probeY;

          const targetIndex = computeTargetIndex(node, probeY, this, dirY);

          const rows = getRowsInOrder(node);
          const currentIndex = rows.indexOf(this);
          const clampedTarget = Math.max(0, Math.min(targetIndex, rows.length - 1));
          if (clampedTarget !== currentIndex) {
            reorderDraggedRow(node, this, clampedTarget);
          }

          node.setDirtyCanvas(true, true);
        }

        this._hover = "drag";
        setCanvasCursor("grabbing");
        return true;
      }

      if (isUp) {
        endDrag(node, true);
        return true;
      }

      return true;
    }

    if (!isDown) return false;
    if (event.button !== 0) return false;

    const part = this._hitPart(pos);

    if (part === "drag") {
      const rows = getRowsInOrder(node);
      const startIndex = rows.indexOf(this);

      this._dragging = true;
      this._hover = "drag";

      const pointerY = pos?.[1] ?? 0;
      const rowTop = typeof this._rowY === "number" ? this._rowY : pointerY;
      const offsetY = pointerY - rowTop;

      node._vslinxDrag = {
        row: this,
        offsetY,
        ghostY: rowTop,
        originalRows: rows.slice(),
        startIndex,
        lastProbeY: rowTop + ROW_HEIGHT * DRAG_SNAP_FRACTION,
      };

      vslinxDragNode = node;

      setCanvasCursor("grabbing");
      node.setDirtyCanvas(true, true);

      return true;
    }

    if (part === "remove") {
      this._handleRemove(node);
      return true;
    }

    if (part === "file") {
      this._handlePickFile(node);
      return true;
    }

    if (part === "sel") {
      if (!this.value.file) return true;

      const items = (this._labels || []).map((label) => ({
        content: label,
        callback: () => {
          this.value.key = label;
          this.value.keys = [];
          node.setDirtyCanvas(true, true);
        },
      }));

      const preselected =
        Array.isArray(this.value.key) ? this.value.key :
          (Array.isArray(this.value.keys) && this.value.keys.length)
            ? this.value.keys
            : (this.value.key && this.value.key !== "(None)" ? [String(this.value.key)] : []);

      showKeyPickerMenu(items, event, "Selection", { selected: preselected }).then((result) => {
        if (!result) return;

        if (result.mode === "single") {
          const picked = String(result.picked?.content ?? "");
          if (!picked || picked === "(None)") {
            this.value.key = "(None)";
            this.value.keys = [];
          } else {
            this.value.key = picked;
            this.value.keys = [];
          }
          node.setDirtyCanvas(true, true);
          return;
        }

        if (result.mode === "clear") {
          this.value.key = "(None)";
          this.value.keys = [];
          node.setDirtyCanvas(true, true);
          return;
        }

        if (result.mode === "multi") {
          const chosen = Array.isArray(result.selected) ? result.selected : [];
          const cleaned = chosen.map(String).filter((s) => s && s !== "(None)");

          if (cleaned.length <= 1) {
            const one = cleaned[0] || "(None)";
            this.value.key = one;
            this.value.keys = [];
          } else {
            this.value.key = cleaned.slice();
            this.value.keys = cleaned.slice();
          }

          node.setDirtyCanvas(true, true);
          return;
        }
      });

      return true;
    }

    return false;
  }
}

app.registerExtension({
  name: "vslinx.multilang_csv_prompt_picker",
  async nodeCreated(node) {
    if (node.comfyClass !== NODE_NAME) return;

    node.serialize_widgets = true;

    const origOnDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
      origOnDrawForeground?.call(this, ctx);

      const d = this._vslinxDrag;
      if (!d?.row || !d.row._dragging) return;

      const slotY = d.row?._rowY;
      drawDropPlaceholderAt(ctx, this, slotY);
      drawGhostRow(ctx, this, d.row, d.ghostY);
    };

    if (!app.canvas._vslinxProcessMouseMovePatched) {
      app.canvas._vslinxProcessMouseMovePatched = true;

      const orig = app.canvas.processMouseMove.bind(app.canvas);
      app.canvas.processMouseMove = function (e) {
        const r = orig(e);

        if (isDragging()) {
          setCanvasCursor("grabbing");
          return r;
        }

        if (vslinxHoverNode) {
          const over = this.node_over;
          if (over !== vslinxHoverNode) {
            clearHoverOnNode(vslinxHoverNode);
            vslinxHoverNode = null;
            setCanvasCursor("");
          }
        }

        return r;
      };
    }

    if (!app.canvas._vslinxMouseLeaveBound) {
      app.canvas._vslinxMouseLeaveBound = true;
      const c = app?.canvas?.canvas;

      const cancelAll = () => {
        if (vslinxDragNode?._vslinxDrag?.row?._dragging) {
          endDrag(vslinxDragNode, false);
        }

        if (vslinxHoverNode) {
          clearHoverOnNode(vslinxHoverNode);
          vslinxHoverNode = null;
        }

        setCanvasCursor("");
      };

      const commitAll = () => {
        if (vslinxDragNode?._vslinxDrag?.row?._dragging) {
          endDrag(vslinxDragNode, true);
        }
        setCanvasCursor("");
      };

      if (c) {
        c.addEventListener("mouseleave", cancelAll);
        c.addEventListener("pointerleave", cancelAll);
      }

      window.addEventListener("blur", cancelAll, true);
      window.addEventListener("pointercancel", cancelAll, true);

      window.addEventListener("mouseup", commitAll, true);
      window.addEventListener("pointerup", commitAll, true);
    }

    const origOnMouseMove = node.onMouseMove;
    node.onMouseMove = function (e, pos, canvas) {
      origOnMouseMove?.call(this, e, pos, canvas);

      vslinxHoverNode = this;

      const rows = getRowWidgets(this);
      if (rows.some((r) => r?._dragging)) {
        setCanvasCursor("grabbing");
        return;
      }

      let cursor = "";
      let didAnyChange = false;

      for (const row of rows) {
        const rowY = row._rowY;
        if (typeof rowY !== "number") continue;

        const inThisRow = pos[1] >= rowY && pos[1] <= rowY + ROW_HEIGHT;

        if (!inThisRow) {
          if (row._hover) {
            row._hover = null;
            didAnyChange = true;
          }
          continue;
        }

        const part = row._hitPart(pos);
        if (row._hover !== part) {
          row._hover = part;
          didAnyChange = true;
        }

        if (part === "drag") cursor = "grab";
        else if (part) cursor = "pointer";
      }

      if (didAnyChange) this.setDirtyCanvas(true, true);
      setCanvasCursor(cursor);
    };

    const origConfigure = node.configure;
    node.configure = function (info) {
      origConfigure?.call(node, info);

      if (vslinxDragNode === node && node._vslinxDrag?.row?._dragging) {
        endDrag(node, false);
      }

      removeAllVslinxUiWidgets(node);

      ensureListTopSpacer(node, 10);
      ensureButtonSpacer(node, 10);
      ensureSelectButton(node);

      const vals = info?.widgets_values || [];

      const savedExtra = vals.find((v) => v && v.type === "ExtraPromptWidget");
      const extra = ensureExtraPromptRow(node);
      if (savedExtra && typeof savedExtra === "object") {
        extra.value = { ...extra.value, ...savedExtra };
      }

      const savedRows = vals.filter((v) => v && v.type === "CsvRowWidget" && v.file);

      node._csvRowCounter = 0;
      for (const v of savedRows) {
        node._csvRowCounter += 1;
        const row = new CsvRowWidget("csv_" + node._csvRowCounter);
        node.addCustomWidget(row);

        const merged = { ...row.value, ...v };
        if (!Array.isArray(merged.keys)) merged.keys = [];

        if (Array.isArray(merged.key)) {
          merged.keys = merged.key.slice();
        }

        row.value = merged;

        row.setFile(v.file).then(() => {
          row.value.key = v.key ?? "(None)";
          if (Array.isArray(v.key)) row.value.keys = v.key.slice();
          if (Array.isArray(v.keys) && v.keys.length && !Array.isArray(row.value.key)) row.value.keys = v.keys.slice();

          layoutWidgets(node);
          node.setDirtyCanvas(true, true);
        });
      }

      node._vslinxDrag = null;

      const rows = getRowWidgets(node).slice();
      rows.sort((a, b) => {
        const ao = Number.isFinite(a?.value?.order) ? a.value.order : 0;
        const bo = Number.isFinite(b?.value?.order) ? b.value.order : 0;
        if (ao !== bo) return ao - bo;
        return 0;
      });
      const nonRows = (node.widgets || []).filter((w) => !isRowWidget(w));
      node.widgets = [...nonRows, ...rows];
      layoutWidgets(node);

      recomputeNodeSize(node);
      node.setDirtyCanvas(true, true);
    };

    removeAllVslinxUiWidgets(node);
    ensureListTopSpacer(node, 10);
    ensureButtonSpacer(node, 10);
    ensureSelectButton(node);
    ensureExtraPromptRow(node);

    node._vslinxDrag = null;

    layoutWidgets(node);
    recomputeNodeSize(node);
  },
});
