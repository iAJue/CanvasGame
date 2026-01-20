function waitForApi(timeoutMs = 6000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const api = window.__UNDRESSING__;
      if (api) return resolve(api);
      if (performance.now() - started > timeoutMs) {
        return reject(new Error("window.__UNDRESSING__ not found"));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "checked") node.checked = !!v;
    else if (k === "value") node.value = String(v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatLayoutJson(layout) {
  return JSON.stringify(layout, null, 2);
}

function getAllClothes(api) {
  const layout = api.exportClothesLayout();
  layout.sort((a, b) => a.order - b.order);
  return layout;
}

function initDevtools(api) {
  const mount = document.getElementById("devMount");
  if (!mount) throw new Error("Missing #devMount in page");

  const state = {
    enabled: true,
    selectedId: 1,
    visible: new Set(api.getDevVisibleIds?.() || [1, 2, 3]),
    dragging: null,
  };

  api.setDevModeEnabled(true);
  api.setDevOptions?.({ hideRpsOverlay: true, pauseGame: true });
  api.setDevVisibleIds(Array.from(state.visible));

  const panel = el("section", { class: "panel" }, [
    el("div", { class: "panelHeader" }, [
      el("div", { class: "panelTitle", text: "调试 / 配置" }),
      el("div", { class: "muted", text: "拖拽与数值微调" }),
    ]),
    el("div", { class: "panelBody" }, [
      el("div", { class: "devGrid" }, [
        el("div", { class: "btnRow" }, [
          el("button", {
            type: "button",
            class: "ok",
            text: "加载资源",
            onclick: async () => {
              if (!api.texturesLoaded) await api.start();
            },
          }),
          el("button", {
            type: "button",
            text: "复制位置 JSON",
            onclick: async () => {
              const ok = await copyText(formatLayoutJson(api.exportClothesLayout()));
              toast(ok ? "已复制到剪贴板" : "复制失败（请手动复制控制台输出）");
              if (!ok) {
                // eslint-disable-next-line no-console
                console.log(formatLayoutJson(api.exportClothesLayout()));
              }
            },
          }),
        ]),

        el("div", { class: "devHint" }, [
          "拖拽：在画布上按住并拖动选中衣服（需要勾选显示）。",
          document.createElement("br"),
          "数值：以底图 2300×3500 像素坐标为基准。",
        ]),

        el("div", { class: "devList", id: "devList" }),

        el("div", { class: "devForm", id: "devForm" }),
      ]),
    ]),
  ]);

  mount.appendChild(panel);

  const listEl = panel.querySelector("#devList");
  const formEl = panel.querySelector("#devForm");

  let toastTimer = 0;
  const toastEl = el("div", {
    class: "muted",
    style:
      "padding:8px 10px;border:1px dashed rgba(255,255,255,0.14);border-radius:12px;background:rgba(0,0,0,0.16);display:none;",
  });
  panel.querySelector(".devGrid").prepend(toastEl);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.style.display = "none"), 1400);
  }

  function renderList() {
    listEl.innerHTML = "";
    const clothes = getAllClothes(api);
    for (const c of clothes) {
      const checked = state.visible.has(c.id);
      const item = el("div", { class: `devItem${state.selectedId === c.id ? " is-active" : ""}` }, [
        el("input", {
          type: "checkbox",
          checked,
          onchange: (e) => {
            const on = e.target.checked;
            if (on) state.visible.add(c.id);
            else state.visible.delete(c.id);
            api.setDevVisibleIds(Array.from(state.visible));
          },
        }),
        el("div", { class: "devMeta" }, [
          el("b", { text: `${c.id}. ${c.name}` }),
          el("span", { text: `order=${c.order}  z=${c.z}` }),
        ]),
      ]);

      item.addEventListener("click", (e) => {
        if (e.target && e.target.tagName === "INPUT") return;
        state.selectedId = c.id;
        renderList();
        renderForm();
      });

      listEl.appendChild(item);
    }
  }

  function renderForm() {
    formEl.innerHTML = "";
    const c = api.getCloth(state.selectedId);
    if (!c) return;

    const makeNum = (label, value, onInput) =>
      el("label", {}, [
        el("span", { text: label }),
        el("input", {
          type: "number",
          value: String(value),
          step: "1",
          oninput: (e) => onInput(e.target.value),
        }),
      ]);

    const updateX = (v) => api.setClothDest(c.id, { x: clampInt(v, -99999, 99999) });
    const updateY = (v) => api.setClothDest(c.id, { y: clampInt(v, -99999, 99999) });
    const updateW = (v) => api.setClothDest(c.id, { w: clampInt(v, 0, 99999) });
    const updateH = (v) => api.setClothDest(c.id, { h: clampInt(v, 0, 99999) });
    const updateZ = (v) => api.setClothZ(c.id, clampInt(v, -99999, 99999));

    formEl.appendChild(makeNum("x", c.dest.x, updateX));
    formEl.appendChild(makeNum("y", c.dest.y, updateY));
    formEl.appendChild(makeNum("w", c.dest.w, updateW));
    formEl.appendChild(makeNum("h", c.dest.h, updateH));
    formEl.appendChild(makeNum("z", c.z, updateZ));
    formEl.appendChild(
      el("label", {}, [
        el("span", { text: "步长" }),
        el("input", { type: "number", value: "5", step: "1", id: "devStep" }),
      ]),
    );

    formEl.appendChild(
      el("div", { style: "grid-column: 1 / -1; display:flex; gap:8px; flex-wrap:wrap;" }, [
        el("button", {
          type: "button",
          text: "←",
          onclick: () => nudge(-1, 0),
        }),
        el("button", {
          type: "button",
          text: "→",
          onclick: () => nudge(1, 0),
        }),
        el("button", {
          type: "button",
          text: "↑",
          onclick: () => nudge(0, -1),
        }),
        el("button", {
          type: "button",
          text: "↓",
          onclick: () => nudge(0, 1),
        }),
        el("button", {
          type: "button",
          text: "隐藏出拳浮层",
          onclick: () => {
            api.setDevOptions?.({ hideRpsOverlay: true });
            toast("已隐藏舞台出拳浮层");
          },
        }),
      ]),
    );

    function nudge(dx, dy) {
      const step = clampInt(panel.querySelector("#devStep")?.value ?? 5, 1, 1000);
      const current = api.getCloth(state.selectedId);
      if (!current) return;
      api.setClothDest(current.id, {
        x: current.dest.x + dx * step,
        y: current.dest.y + dy * step,
      });
      renderForm();
    }
  }

  function syncFormIfNotEditing() {
    const active = document.activeElement;
    if (active && active.tagName === "INPUT") return;
    renderForm();
  }

  function isPointInRect(p, rect) {
    return p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h;
  }

  function onPointerDown(e) {
    if (!state.enabled) return;
    const c = api.getCloth(state.selectedId);
    if (!c) return;
    if (!state.visible.has(c.id)) return;

    const p = api.clientToBasePx(e.clientX, e.clientY);
    if (!p) return;
    if (!isPointInRect(p, c.dest)) return;

    e.preventDefault();
    ui.canvas.setPointerCapture?.(e.pointerId);
    state.dragging = { id: c.id, ox: p.x - c.dest.x, oy: p.y - c.dest.y };
  }

  function onPointerMove(e) {
    if (!state.dragging) return;
    const p = api.clientToBasePx(e.clientX, e.clientY);
    if (!p) return;
    const x = Math.round(p.x - state.dragging.ox);
    const y = Math.round(p.y - state.dragging.oy);
    api.setClothDest(state.dragging.id, { x, y });
    syncFormIfNotEditing();
  }

  function onPointerUp(e) {
    if (!state.dragging) return;
    ui.canvas.releasePointerCapture?.(e.pointerId);
    state.dragging = null;
    syncFormIfNotEditing();
  }

  renderList();
  renderForm();

  ui.canvas.addEventListener("pointerdown", onPointerDown);
  ui.canvas.addEventListener("pointermove", onPointerMove);
  ui.canvas.addEventListener("pointerup", onPointerUp);
  ui.canvas.addEventListener("pointercancel", onPointerUp);

  if (!api.texturesLoaded) {
    api.start().catch(() => {});
  }

  toast("调试模式已启用");
}

const ui = { canvas: document.getElementById("gl") };

waitForApi()
  .then((api) => initDevtools(api))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
  });
