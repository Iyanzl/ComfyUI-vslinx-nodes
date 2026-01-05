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
  return (node.widgets || []).filter((w) => w?.value?.type === "CsvRowWidget");
}

function hasRowForFilename(node, filename, excludeWidget = null) {
  return getRowWidgets(node).some((w) => w !== excludeWidget && w?.value?.file === filename);
}

function removeRowsForFilename(node, filename) {
  const rows = getRowWidgets(node);
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
  } catch (_) {}
}

const LIST_TOP_SPACER_ID = "vslinx_list_top_spacer";
const BUTTON_SPACER_ID = "vslinx_select_csv_spacer";
const BUTTON_ID = "vslinx_select_csv_button";
const BUTTON_LABEL = "Select CSV File";
const LIST_SIDE_MARGIN = (globalThis?.LiteGraph?.NODE_WIDGET_MARGIN ?? 10);
const ROW_HEIGHT = 54;

function isRowWidget(w) {
  return w?.value?.type === "CsvRowWidget";
}
function isListTopSpacer(w) {
  return w?._vslinx_id === LIST_TOP_SPACER_ID;
}
function isButtonSpacer(w) {
  return w?._vslinx_id === BUTTON_SPACER_ID;
}
function isBottomButton(w) {
  return w?._vslinx_id === BUTTON_ID;
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
    draw() {},
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
    draw() {},
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
}

function removeAllVslinxUiWidgets(node) {
  node.widgets = (node.widgets || []).filter((w) => {
    if (isRowWidget(w)) return false;
    if (isListTopSpacer(w)) return false;
    if (isButtonSpacer(w)) return false;
    if (isBottomButton(w)) return false;
    if (w?._vslinx_id === LIST_TOP_SPACER_ID) return false;
    if (w?._vslinx_id === BUTTON_SPACER_ID) return false;
    if (w?._vslinx_id === BUTTON_ID) return false;
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

class CsvRowWidget {
  constructor(name) {
    this.name = name;
    this.type = "custom";
    this.value = { type: "CsvRowWidget", file: "", key: "(None)" };
    this._labels = [];
    this._map = {};
    this._bounds = {
      file: [0, 0, 0, 0],
      remove: [0, 0, 0, 0],
      sel: [0, 0, 0, 0],
      out: [0, 0, 0, 0],
    };
  }

  computeSize() {
    return [0, ROW_HEIGHT];
  }

  async setFile(filename) {
    this.value.file = filename;
    this.value.key = "(None)";
    const data = await readPromptFile(filename);
    this._labels = ["(None)", "Random", ...(data.labels || [])];
    this._map = data.map || {};
  }

  serializeValue() {
    return this.value;
  }

  _getOutPreview() {
    if (!this.value.key || this.value.key === "(None)") return "";
    if (this.value.key === "Random") return "(random pick at runtime)";
    return this._map[this.value.key] ?? "";
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

  draw(ctx, node, _width, y) {
    const height = ROW_HEIGHT;

    const x = LIST_SIDE_MARGIN;
    const w = Math.max(0, (node?.size?.[0] ?? _width) - LIST_SIDE_MARGIN * 2);

    const innerPadY = 2;
    const yy = y + innerPadY;
    const hh = Math.max(0, height - innerPadY * 2);

    const topH = Math.floor(hh * 0.52);
    const botH = hh - topH;

    const topY = yy;
    const botY = yy + topH;

    const removeW = Math.max(28, Math.floor(w * 0.06));
    const fileW = Math.max(0, w - removeW);

    const fileX = x;
    const remX = x + fileW;

    const selW = Math.floor(w / 2);
    const outW = w - selW;
    const selX = x;
    const outX = x + selW;

    ctx.save();

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#262626";
    roundRectPath(ctx, x, yy, w, hh, 7);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#3f3f3f";
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, yy, w, hh, 7);
    ctx.stroke();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.moveTo(x + 6, botY);
    ctx.lineTo(x + w - 6, botY);
    ctx.moveTo(remX, topY + 3);
    ctx.lineTo(remX, topY + topH - 3);
    ctx.moveTo(outX, botY + 3);
    ctx.lineTo(outX, botY + botH - 3);
    ctx.stroke();

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
    const selText = this.value.key ?? "(None)";
    drawClippedText(ctx, selText, selX, botMid, selW, botH);

    const outVal = this._getOutPreview();
    drawClippedText(ctx, outVal, outX, botMid, outW, botH);

    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBase;

    ctx.restore();

    this._bounds.file = [fileX, topY, fileW, topH];
    this._bounds.remove = [remX, topY, removeW, topH];
    this._bounds.sel = [selX, botY, selW, botH];
    this._bounds.out = [outX, botY, outW, botH];
  }

  mouse(event, pos, node) {
    const isLeftClick = event.type === "pointerdown" && event.button === 0;
    if (!isLeftClick) return false;

    const x = pos[0];
    const y = pos[1];
    const inRect = (r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

    if (inRect(this._bounds.remove)) {
      this._handleRemove(node);
      return true;
    }

    if (inRect(this._bounds.file)) {
      this._handlePickFile(node);
      return true;
    }

    if (inRect(this._bounds.sel)) {
      if (!this.value.file) return true;

      const items = (this._labels || []).map((label) => ({
        content: label,
        callback: () => {
          this.value.key = label;
          node.setDirtyCanvas(true, true);
        },
      }));

      new LiteGraph.ContextMenu(items, { event, title: "Selection" });
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

    const origConfigure = node.configure;
    node.configure = function (info) {
      origConfigure?.call(node, info);

      removeAllVslinxUiWidgets(node);

      ensureListTopSpacer(node, 10);
      ensureButtonSpacer(node, 10);
      ensureSelectButton(node);

      const vals = info?.widgets_values || [];
      const savedRows = vals.filter((v) => v && v.type === "CsvRowWidget" && v.file);

      node._csvRowCounter = 0;
      for (const v of savedRows) {
        node._csvRowCounter += 1;
        const row = new CsvRowWidget("csv_" + node._csvRowCounter);
        node.addCustomWidget(row);
        row.value = { ...v };
        row.setFile(v.file).then(() => {
          row.value.key = v.key ?? "(None)";
          layoutWidgets(node);
          node.setDirtyCanvas(true, true);
        });
      }

      layoutWidgets(node);
      recomputeNodeSize(node);
      node.setDirtyCanvas(true, true);
    };

    removeAllVslinxUiWidgets(node);
    ensureListTopSpacer(node, 10);
    ensureButtonSpacer(node, 10);
    ensureSelectButton(node);

    layoutWidgets(node);
    recomputeNodeSize(node);
  },
});