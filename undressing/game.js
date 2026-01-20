const KEY = "CanvasGame-undressing-key-v1";
const MAGIC = "CBM1";

const BASE_W = 2300;
const BASE_H = 3500;

const MOVE = Object.freeze({
  SCISSORS: 0,
  ROCK: 1,
  PAPER: 2,
});

const MOVE_NAME = Object.freeze({
  [MOVE.SCISSORS]: "剪刀",
  [MOVE.ROCK]: "石头",
  [MOVE.PAPER]: "布",
});

const RPS_SPRITES = Object.freeze({
  [MOVE.SCISSORS]: { x: 0, y: 0, w: 128, h: 106 },
  [MOVE.ROCK]: { x: 171, y: 34, w: 269 - 171, h: 125 - 34 },
  [MOVE.PAPER]: { x: 25, y: 117, w: 175 - 25, h: 241 - 117 },
});

const RPS_SHEET = Object.freeze({
  w: 269,
  h: 241,
  path: "./Rock-paper-scissors.png",
});

const DEV_STATE = {
  enabled: false,
  visibleIds: new Set(),
  hideRpsOverlay: true,
  pauseGame: true,
};

let lastBaseRect = null;

const CLOTHES = [
  {
    id: 10,
    name: "泳装衣服",
    order: 10,
    z: 100,
    src: { x: 0, y: 0, w: 758, h: 383 },
    reveals: [],
    dest: { x: 776, y: 987, w: 758, h: 383 },
  },
  {
    id: 9,
    name: "泳装裙子",
    order: 9,
    z: 90,
    src: { x: 0, y: 564, w: 875, h: 406 },
    reveals: [],
    dest: { x: 748, y: 1936, w: 875, h: 406 },
  },
  {
    id: 8,
    name: "JK衣服",
    order: 8,
    z: 80,
    src: { x: 40, y: 1117, w: 1345, h: 971 },
    reveals: [10],
    dest: { x: 617, y: 895, w: 1345, h: 971 },
  },
  {
    id: 7,
    name: "JK裙子",
    order: 7,
    z: 70,
    src: { x: 0, y: 2269, w: 1137, h: 750 },
    reveals: [9],
    dest: { x: 570, y: 1882, w: 1137, h: 750 },
  },
  {
    id: 6,
    name: "睡衣衣服",
    order: 6,
    z: 60,
    src: { x: 1445, y: 0, w: 1840, h: 1860 },
    reveals: [7, 8],
    dest: { x: 288, y: 641, w: 1840, h: 1860 },
  },
  {
    id: 5,
    name: "左白丝",
    order: 5,
    z: 50,
    src: { x: 1397, y: 1951, w: 989, h: 636 },
    reveals: [],
    dest: { x: 510, y: 2585, w: 989, h: 636 },
  },
  {
    id: 4,
    name: "右白丝",
    order: 4,
    z: 40,
    src: { x: 1962, y: 2617, w: 1167, h: 613 },
    reveals: [],
    dest: { x: 1071, y: 2635, w: 1167, h: 613 },
  },
  {
    id: 3,
    name: "睡衣衣服2",
    order: 3,
    z: 30,
    src: { x: 3345, y: 27, w: 1862, h: 1802 },
    reveals: [6],
    dest: { x: 279, y: 630, w: 1862, h: 1802 },
  },
  {
    id: 2,
    name: "睡衣裤子2",
    order: 2,
    z: 20,
    src: { x: 3389, y: 1917, w: 1247, h: 1162 },
    reveals: [4, 5],
    dest: { x: 530, y: 2066, w: 1247, h: 1162 },
  },
  {
    id: 1,
    name: "睡衣袜子2",
    order: 1,
    z: 10,
    src: { x: 4766, y: 2215, w: 522, h: 372 },
    reveals: [],
    dest: { x: 1725, y: 2761, w: 522, h: 372 },
  },
];

const CLOTHES_BY_ID = new Map(CLOTHES.map((c) => [c.id, c]));

const ui = {
  canvas: document.getElementById("gl"),
  log: document.getElementById("log"),
  statusText: document.getElementById("statusText"),
  pillPhase: document.getElementById("pillPhase"),
  pillClothes: document.getElementById("pillClothes"),
  pillScore: document.getElementById("pillScore"),
  btnStart: document.getElementById("btnStart"),
  btnReset: document.getElementById("btnReset"),
  btnMovesWrap: document.getElementById("btnMoves"),
  gameOverBanner: document.getElementById("gameOverBanner"),
  btnScissors: document.getElementById("btnScissors"),
  btnRock: document.getElementById("btnRock"),
  btnPaper: document.getElementById("btnPaper"),
};

function log(line) {
  ui.log.textContent =
    (ui.log.textContent ? ui.log.textContent + "\n" : "") + line;
}

function setPhase(text, kind = "warn") {
  ui.pillPhase.textContent = text;
  ui.pillPhase.classList.remove("ok", "warn", "danger");
  ui.pillPhase.classList.add(kind);
}

function nowMs() {
  return performance.now();
}

function xorBytes(cipherBytes, keyBytes) {
  const plain = new Uint8Array(cipherBytes.length);
  for (let i = 0; i < cipherBytes.length; i++) {
    plain[i] = cipherBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return plain;
}

async function fetchBytes(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function decodeEncryptedPng(path) {
  const encrypted = await fetchBytes(path);
  if (encrypted.length < 8)
    throw new Error("Invalid encrypted file: too small");
  const magic = new TextDecoder("ascii").decode(encrypted.slice(0, 4));
  if (magic !== MAGIC)
    throw new Error(`Invalid encrypted file: bad magic (${magic})`);

  const lenView = new DataView(encrypted.buffer, encrypted.byteOffset + 4, 4);
  const plainLen = lenView.getUint32(0, true);
  const cipher = encrypted.slice(8);
  if (cipher.length !== plainLen) {
    log(
      `警告：长度不一致（header=${plainLen}, actual=${cipher.length}），仍尝试解密`
    );
  }

  const keyBytes = new TextEncoder().encode(KEY);
  const pngBytes = xorBytes(cipher, keyBytes);
  const blob = new Blob([pngBytes], { type: "image/png" });
  return await createImageBitmap(blob);
}

function loadImageBitmap(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        resolve(await createImageBitmap(img));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    img.src = path;
  });
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "unknown";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "unknown";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${info}`);
  }
  return program;
}

function createTextureFromBitmap(gl, bitmap) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

class SpriteRenderer {
  constructor(gl) {
    this.gl = gl;
    const vs = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      uniform vec2 u_resolution;
      varying vec2 v_texCoord;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clip = zeroToTwo - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;
    const fs = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_tex;
      uniform vec4 u_color;
      void main() {
        vec4 c = texture2D(u_tex, v_texCoord);
        gl_FragColor = c * u_color;
      }
    `;
    this.program = createProgram(gl, vs, fs);
    this.a_position = gl.getAttribLocation(this.program, "a_position");
    this.a_texCoord = gl.getAttribLocation(this.program, "a_texCoord");
    this.u_resolution = gl.getUniformLocation(this.program, "u_resolution");
    this.u_color = gl.getUniformLocation(this.program, "u_color");
    this.u_tex = gl.getUniformLocation(this.program, "u_tex");
    this.buffer = gl.createBuffer();
  }

  begin() {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.a_position);
    gl.enableVertexAttribArray(this.a_texCoord);
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.a_texCoord, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(this.u_resolution, gl.canvas.width, gl.canvas.height);
    gl.uniform1i(this.u_tex, 0);
  }

  draw(texture, srcPx, texSize, dstPx, color = [1, 1, 1, 1]) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(this.u_color, color[0], color[1], color[2], color[3]);

    const u0 = srcPx.x / texSize.w;
    const v0 = srcPx.y / texSize.h;
    const u1 = (srcPx.x + srcPx.w) / texSize.w;
    const v1 = (srcPx.y + srcPx.h) / texSize.h;

    const x0 = dstPx.x;
    const y0 = dstPx.y;
    const x1 = dstPx.x + dstPx.w;
    const y1 = dstPx.y + dstPx.h;

    const data = new Float32Array([
      x0,
      y0,
      u0,
      v0,
      x1,
      y0,
      u1,
      v0,
      x0,
      y1,
      u0,
      v1,
      x0,
      y1,
      u0,
      v1,
      x1,
      y0,
      u1,
      v0,
      x1,
      y1,
      u1,
      v1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function fitRect(containerW, containerH, contentW, contentH) {
  const scale = Math.min(containerW / contentW, containerH / contentH);
  const w = contentW * scale;
  const h = contentH * scale;
  const x = (containerW - w) / 2;
  const y = (containerH - h) / 2;
  return { x, y, w, h, scale };
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(2, Math.floor(rect.width * dpr));
  const h = Math.max(2, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function outcome(playerMove, computerMove) {
  if (playerMove === computerMove) return "draw";
  if (playerMove === MOVE.ROCK && computerMove === MOVE.SCISSORS) return "win";
  if (playerMove === MOVE.SCISSORS && computerMove === MOVE.PAPER) return "win";
  if (playerMove === MOVE.PAPER && computerMove === MOVE.ROCK) return "win";
  return "lose";
}

class Game {
  constructor() {
    this.visibleReasons = new Map();
    this.removed = new Set();
    this.removedStack = [];
    this.phase = "idle"; // idle | loading | ready | cycling | resolving | anim | gameover
    this.round = null;
    this.anim = null;
    this.stats = { win: 0, lose: 0, draw: 0 };
    this.resetClothes();
  }

  resetClothes() {
    this.visibleReasons.clear();
    this.removed.clear();
    this.removedStack = [];
    this.addVisible(1);
    this.addVisible(2);
    this.addVisible(3);
  }

  addVisible(id, n = 1) {
    this.visibleReasons.set(id, (this.visibleReasons.get(id) || 0) + n);
  }

  removeVisibleReason(id, n = 1) {
    const next = (this.visibleReasons.get(id) || 0) - n;
    if (next <= 0) this.visibleReasons.delete(id);
    else this.visibleReasons.set(id, next);
  }

  isDrawableCloth(id) {
    return this.visibleReasons.has(id) && !this.removed.has(id);
  }

  getDrawableClothesSorted() {
    const list = [];
    for (const c of CLOTHES) {
      if (this.isDrawableCloth(c.id)) list.push(c);
    }
    list.sort((a, b) => a.z - b.z);
    return list;
  }

  getNextRemovableId() {
    const candidates = CLOTHES.filter((c) => this.isDrawableCloth(c.id)).sort(
      (a, b) => a.order - b.order
    );
    return candidates.length ? candidates[0].id : null;
  }

  isGameOver() {
    return this.removed.size >= CLOTHES.length;
  }

  bumpStats(result) {
    if (result === "win") this.stats.win++;
    else if (result === "lose") this.stats.lose++;
    else if (result === "draw") this.stats.draw++;
  }

  startRound(playerMove) {
    if (this.phase !== "ready") return;
    if (this.isGameOver()) return;
    this.round = {
      playerMove,
      computerMove: null,
      result: null,
      startedAt: nowMs(),
      revealedAt: null,
    };
    this.phase = "cycling";
  }

  tick() {
    if (!this.round) return;
    const t = nowMs();

    if (this.phase === "cycling") {
      if (t - this.round.startedAt >= 1100) {
        this.round.computerMove = Math.floor(Math.random() * 3);
        this.round.result = outcome(
          this.round.playerMove,
          this.round.computerMove
        );
        this.round.revealedAt = t;
        this.phase = "resolving";
      }
      return;
    }

    if (this.phase === "resolving") {
      if (t - this.round.revealedAt < 450) return;
      if (this.round.result === "win") this.beginStrip();
      else if (this.round.result === "lose") this.beginWearBack();
      else this.finishRound();
      return;
    }

    if (this.phase === "anim") {
      if (this.anim && t >= this.anim.endAt) this.finishAnim();
    }
  }

  finishRound() {
    this.bumpStats(this.round?.result);
    this.round = null;
    if (this.isGameOver()) this.phase = "gameover";
    else this.phase = "ready";
  }

  beginStrip() {
    const id = this.getNextRemovableId();
    if (!id) {
      this.finishRound();
      return;
    }
    const t = nowMs();
    this.anim = { type: "strip", id, startAt: t, endAt: t + 520 };
    this.phase = "anim";
  }

  beginWearBack() {
    const id = this.removedStack.length
      ? this.removedStack[this.removedStack.length - 1]
      : null;
    if (!id) {
      this.finishRound();
      return;
    }
    const t = nowMs();
    this.anim = { type: "wear", id, startAt: t, endAt: t + 520 };
    this.phase = "anim";
  }

  finishAnim() {
    const anim = this.anim;
    this.anim = null;
    if (!anim) {
      this.finishRound();
      return;
    }

    const cloth = CLOTHES_BY_ID.get(anim.id);
    if (!cloth) {
      this.finishRound();
      return;
    }

    if (anim.type === "strip") {
      if (!this.removed.has(cloth.id)) {
        this.removed.add(cloth.id);
        this.removedStack.push(cloth.id);
        for (const rid of cloth.reveals) this.addVisible(rid);
      }
    } else if (anim.type === "wear") {
      if (this.removed.has(cloth.id)) {
        this.removed.delete(cloth.id);
        if (
          this.removedStack.length &&
          this.removedStack[this.removedStack.length - 1] === cloth.id
        ) {
          this.removedStack.pop();
        } else {
          const idx = this.removedStack.lastIndexOf(cloth.id);
          if (idx >= 0) this.removedStack.splice(idx, 1);
        }
        for (const rid of cloth.reveals) this.removeVisibleReason(rid);
      }
    }

    this.finishRound();
  }
}

function updateHud(game) {
  const phaseText = {
    idle: ["未开始", "warn"],
    loading: ["加载中", "warn"],
    ready: ["出拳中", "ok"],
    cycling: ["出拳动画", "warn"],
    resolving: ["判定中", "warn"],
    anim: ["换衣动画", "warn"],
    dev: ["调试模式", "ok"],
    gameover: ["游戏结束", "danger"],
  }[game.phase];
  if (phaseText) setPhase(phaseText[0], phaseText[1]);

  const visibleIds = (() => {
    if (DEV_STATE.enabled || game.phase === "dev") return getDevVisibleIds();
    return CLOTHES.filter(
      (c) => game.visibleReasons.has(c.id) && !game.removed.has(c.id)
    )
      .sort((a, b) => a.order - b.order)
      .map((c) => c.id);
  })();
  ui.pillClothes.textContent = `衣服：${
    visibleIds.length ? visibleIds.join(",") : "-"
  }`;
  ui.pillScore.textContent = `战绩：${game.stats.win}W ${game.stats.lose}L ${game.stats.draw}D`;

  if (game.phase === "gameover") {
    ui.statusText.textContent = "全部脱完：游戏结束。";
  } else if (game.phase === "dev") {
    ui.statusText.textContent =
      "调试模式：在右侧面板勾选衣服并调整位置（可拖拽）。";
  } else if (game.phase === "ready") {
    ui.statusText.textContent = "请选择剪刀 / 石头 / 布。";
  } else if (game.phase === "cycling") {
    ui.statusText.textContent = "出拳动画中...";
  } else if (game.phase === "resolving") {
    if (game.round) {
      const you = MOVE_NAME[game.round.playerMove];
      const ai = MOVE_NAME[game.round.computerMove];
      const res =
        game.round.result === "win"
          ? "你赢了"
          : game.round.result === "lose"
          ? "你输了"
          : "平局";
      ui.statusText.textContent = `你：${you}，电脑：${ai} → ${res}`;
    } else {
      ui.statusText.textContent = "判定中...";
    }
  } else if (game.phase === "anim") {
    ui.statusText.textContent = "换衣动画中...";
  } else if (game.phase === "loading") {
    ui.statusText.textContent = "加载资源中...";
  } else if (game.phase === "idle") {
    ui.statusText.textContent = "点击“开始游戏”加载资源(22.0MB)。";
  }

  const disableMoves = game.phase !== "ready";
  ui.btnMovesWrap
    .querySelectorAll("button")
    .forEach((b) => (b.disabled = disableMoves));

  if (ui.gameOverBanner) {
    const showOver = game.phase === "gameover";
    ui.btnMovesWrap.style.display = showOver ? "none" : "";
    ui.gameOverBanner.hidden = !showOver;
  } else {
    ui.btnMovesWrap.style.display = game.phase === "gameover" ? "none" : "";
  }
}

function drawScene(gl, renderer, game, tex, baseRect) {
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  renderer.begin();

  const smoothstep01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  renderer.draw(
    tex.basemapTex,
    { x: 0, y: 0, w: tex.basemapSize.w, h: tex.basemapSize.h },
    tex.basemapSize,
    { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h },
    [1, 1, 1, 1]
  );

  const sx = baseRect.w / BASE_W;
  const sy = baseRect.h / BASE_H;
  const t = nowMs();
  const anim = game.anim;
  const wearP =
    anim && anim.type === "wear"
      ? Math.min(1, Math.max(0, (t - anim.startAt) / (anim.endAt - anim.startAt)))
      : null;
  const wearCloth = anim && anim.type === "wear" ? CLOTHES_BY_ID.get(anim.id) : null;

  const clothesToDraw = (() => {
    if (DEV_STATE.enabled) {
      const list = [];
      for (const id of DEV_STATE.visibleIds) {
        const c = CLOTHES_BY_ID.get(id);
        if (c) list.push(c);
      }
      list.sort((a, b) => a.z - b.z);
      return list.map((cloth) => ({ cloth, sortZ: cloth.z }));
    }

    const list = game.getDrawableClothesSorted().slice();
    const previewIds = new Set();
    const hideIds = new Set();
    const outgoingZ =
      anim && anim.type === "strip" ? CLOTHES_BY_ID.get(anim.id)?.z ?? null : null;
    if (anim && anim.type === "wear") {
      const c = CLOTHES_BY_ID.get(anim.id);
      if (c) {
        list.push(c);
        for (const rid of c.reveals || []) {
          if (game.removed.has(rid)) continue;
          const count = game.visibleReasons.get(rid) || 0;
          if (count <= 1) hideIds.add(rid);
        }
      }
    }
    if (anim && anim.type === "strip") {
      const animCloth = CLOTHES_BY_ID.get(anim.id);
      const reveals = animCloth?.reveals || [];
      for (const rid of reveals) {
        if (game.removed.has(rid)) continue;
        if (game.visibleReasons.has(rid)) continue;
        const c = CLOTHES_BY_ID.get(rid);
        if (c) {
          previewIds.add(rid);
          list.push(c);
        }
      }
    }
    const seen = new Set();
    const deduped = [];
    const wearZ =
      anim && anim.type === "wear" ? CLOTHES_BY_ID.get(anim.id)?.z ?? null : null;
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const isPreview = previewIds.has(c.id);
      const isHide = hideIds.has(c.id);
      let sortZ = c.z;
      if (isPreview && outgoingZ !== null) sortZ = Math.min(sortZ, outgoingZ - 0.001);
      if (isHide && wearZ !== null) sortZ = Math.min(sortZ, wearZ - 0.001);
      deduped.push({ cloth: c, sortZ });
    }
    deduped.sort((a, b) => a.sortZ - b.sortZ);
    return deduped;
  })();

  for (const item of clothesToDraw) {
    const cloth = item.cloth;
    let alpha = 1;
    let dx = 0;
    let dy = 0;
    let scale = 1;

    if (anim && anim.id === cloth.id) {
      const p = Math.min(
        1,
        Math.max(0, (t - anim.startAt) / (anim.endAt - anim.startAt))
      );
      if (anim.type === "strip") {
        const reveals = CLOTHES_BY_ID.get(cloth.id)?.reveals || [];
        const hasNext = reveals.length > 0;

        if (hasNext) {
          const fadeStart = 0.86;
          const q = (p - fadeStart) / (1 - fadeStart);
          const ease = smoothstep01(q);
          alpha = 1 - ease;
          dy = -18 * smoothstep01(p);
          scale = 1 + 0.012 * smoothstep01(p);
        } else {
          const ease = smoothstep01(p);
          alpha = 1 - ease;
          dy = -32 * ease;
          scale = 1 + 0.02 * ease;
        }
      } else if (anim.type === "wear") {
        const q = Math.min(1, p / 0.38);
        const ease = smoothstep01(q);
        alpha = ease;
        dy = 18 * (1 - ease);
        scale = 0.985 + 0.015 * ease;
      }
    }

    if (wearP !== null && wearCloth && cloth.id !== wearCloth.id) {
      const shouldHide =
        (wearCloth.reveals || []).includes(cloth.id) &&
        !game.removed.has(cloth.id) &&
        (game.visibleReasons.get(cloth.id) || 0) <= 1;
      if (shouldHide) {
        const q = Math.min(1, wearP / 0.35);
        const fade = 1 - smoothstep01(q);
        alpha *= fade;
      }
    }

    const dst = {
      x: baseRect.x + cloth.dest.x * sx + dx,
      y: baseRect.y + cloth.dest.y * sy + dy,
      w: cloth.dest.w * sx * scale,
      h: cloth.dest.h * sy * scale,
    };
    renderer.draw(tex.elfTex, cloth.src, tex.elfSize, dst, [1, 1, 1, alpha]);
  }

  if (game.phase === "idle" || game.phase === "loading") return;
  if (DEV_STATE.enabled && DEV_STATE.hideRpsOverlay) return;

  const centerX = gl.canvas.width / 2;
  const topY = gl.canvas.height * 0.12;

  let showPlayer = true;
  if (game.phase === "gameover") showPlayer = false;

  let playerMove = game.round?.playerMove ?? null;
  let compMove = game.round?.computerMove ?? null;

  if (game.phase === "cycling" && game.round) {
    const elapsed = nowMs() - game.round.startedAt;
    compMove = Math.floor(elapsed / 90) % 3;
  }

  if (showPlayer && playerMove != null) {
    const s = RPS_SPRITES[playerMove];
    renderer.draw(
      tex.rpsTex,
      s,
      tex.rpsSize,
      { x: centerX + 60, y: topY, w: 150, h: 150 },
      [1, 1, 1, 0.95]
    );
  }

  if (compMove != null) {
    const s = RPS_SPRITES[compMove];
    renderer.draw(
      tex.rpsTex,
      s,
      tex.rpsSize,
      { x: centerX - 210, y: topY, w: 150, h: 150 },
      [1, 1, 1, 0.95]
    );
  }
}

let gl = null;
let renderer = null;
let textures = null;
let game = new Game();
let rafId = 0;

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function applyRpsButtonSprites() {
  const scale = 0.62;
  const sheetW = RPS_SHEET.w * scale;
  const sheetH = RPS_SHEET.h * scale;
  const defs = [
    { btn: ui.btnScissors, move: MOVE.SCISSORS },
    { btn: ui.btnRock, move: MOVE.ROCK },
    { btn: ui.btnPaper, move: MOVE.PAPER },
  ];
  for (const d of defs) {
    const icon = d.btn?.querySelector?.(".moveIcon");
    const rect = RPS_SPRITES[d.move];
    if (!icon || !rect) continue;
    icon.style.width = `${Math.max(1, Math.round(rect.w * scale))}px`;
    icon.style.height = `${Math.max(1, Math.round(rect.h * scale))}px`;
    icon.style.backgroundImage = `url('${RPS_SHEET.path}')`;
    icon.style.backgroundRepeat = "no-repeat";
    icon.style.backgroundSize = `${sheetW}px ${sheetH}px`;
    icon.style.backgroundPosition = `${Math.round(
      -rect.x * scale
    )}px ${Math.round(-rect.y * scale)}px`;
  }
}

function animatePress(btn) {
  if (!btn || btn.disabled) return;
  btn.classList.add("is-pressed");
  window.setTimeout(() => btn.classList.remove("is-pressed"), 160);
}

function startLoop() {
  stopLoop();
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    if (!gl || !renderer || !textures) return;
    resizeCanvasToDisplaySize(ui.canvas);
    const baseRect = fitRect(gl.canvas.width, gl.canvas.height, BASE_W, BASE_H);
    lastBaseRect = baseRect;
    if (!(DEV_STATE.enabled && DEV_STATE.pauseGame)) game.tick();
    updateHud(game);
    drawScene(gl, renderer, game, textures, baseRect);
  };
  loop();
}

function setButtonsEnabled(startEnabled, resetEnabled) {
  ui.btnStart.disabled = !startEnabled;
  ui.btnReset.disabled = !resetEnabled;
}

async function start() {
  ui.log.textContent = "";
  game.phase = "loading";
  updateHud(game);
  setButtonsEnabled(false, false);

  try {
    gl = ui.canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL not supported");

    renderer = new SpriteRenderer(gl);

    log("解密 Basemap.enc ...");
    const basemapBmp = await decodeEncryptedPng("./Basemap.enc");
    log(`Basemap: ${basemapBmp.width}x${basemapBmp.height}`);

    log("加载 ElfMap.png ...");
    const elfBmp = await loadImageBitmap("./ElfMap.png");
    log(`ElfMap: ${elfBmp.width}x${elfBmp.height}`);

    log("加载 Rock-paper-scissors.png ...");
    const rpsBmp = await loadImageBitmap("./Rock-paper-scissors.png");
    log(`RPS: ${rpsBmp.width}x${rpsBmp.height}`);

    textures = {
      basemapTex: createTextureFromBitmap(gl, basemapBmp),
      basemapSize: { w: basemapBmp.width, h: basemapBmp.height },
      elfTex: createTextureFromBitmap(gl, elfBmp),
      elfSize: { w: elfBmp.width, h: elfBmp.height },
      rpsTex: createTextureFromBitmap(gl, rpsBmp),
      rpsSize: { w: rpsBmp.width, h: rpsBmp.height },
    };

    basemapBmp.close?.();
    elfBmp.close?.();
    rpsBmp.close?.();

    game.resetClothes();
    game.stats = { win: 0, lose: 0, draw: 0 };
    game.round = null;
    game.anim = null;
    game.phase = DEV_STATE.enabled ? "dev" : "ready";
    setButtonsEnabled(false, true);
    startLoop();
  } catch (e) {
    log(`错误：${e.message}`);
    log("提示：请用本地静态服务器打开目录（不要用 file://）。");
    game.phase = "idle";
    updateHud(game);
    setButtonsEnabled(true, true);
  }
}

function resetAll() {
  ui.log.textContent = "";
  log("已重置。");
  game.resetClothes();
  game.stats = { win: 0, lose: 0, draw: 0 };
  game.round = null;
  game.anim = null;
  game.phase = DEV_STATE.enabled ? "dev" : textures ? "ready" : "idle";
  updateHud(game);
}

ui.btnStart.addEventListener("click", () => start());
ui.btnReset.addEventListener("click", () => resetAll());

ui.btnScissors.addEventListener("click", () => {
  animatePress(ui.btnScissors);
  game.startRound(MOVE.SCISSORS);
});
ui.btnRock.addEventListener("click", () => {
  animatePress(ui.btnRock);
  game.startRound(MOVE.ROCK);
});
ui.btnPaper.addEventListener("click", () => {
  animatePress(ui.btnPaper);
  game.startRound(MOVE.PAPER);
});

setButtonsEnabled(true, false);
updateHud(game);
applyRpsButtonSprites();

function setDevModeEnabled(enabled) {
  DEV_STATE.enabled = !!enabled;
  if (DEV_STATE.enabled) {
    game.round = null;
    game.anim = null;
    game.phase = "dev";
    if (!DEV_STATE.visibleIds.size) DEV_STATE.visibleIds = new Set([1, 2, 3]);
  } else {
    game.phase = textures ? "ready" : "idle";
  }
  updateHud(game);
}

function setDevVisibleIds(ids) {
  DEV_STATE.visibleIds = new Set(
    (ids || []).map((v) => Number(v)).filter((n) => Number.isFinite(n))
  );
}

function setDevOptions(opts) {
  if (!opts || typeof opts !== "object") return;
  if (Object.prototype.hasOwnProperty.call(opts, "hideRpsOverlay")) {
    DEV_STATE.hideRpsOverlay = !!opts.hideRpsOverlay;
  }
  if (Object.prototype.hasOwnProperty.call(opts, "pauseGame")) {
    DEV_STATE.pauseGame = !!opts.pauseGame;
  }
}

function getDevVisibleIds() {
  return Array.from(DEV_STATE.visibleIds.values()).sort((a, b) => a - b);
}

function setClothDest(id, dest) {
  const cloth = CLOTHES_BY_ID.get(Number(id));
  if (!cloth) return false;
  if (!cloth.dest) cloth.dest = { x: 0, y: 0, w: 0, h: 0 };
  const next = {
    x: Number(dest?.x ?? cloth.dest.x),
    y: Number(dest?.y ?? cloth.dest.y),
    w: Number(dest?.w ?? cloth.dest.w),
    h: Number(dest?.h ?? cloth.dest.h),
  };
  if (![next.x, next.y, next.w, next.h].every((n) => Number.isFinite(n)))
    return false;
  cloth.dest.x = next.x;
  cloth.dest.y = next.y;
  cloth.dest.w = next.w;
  cloth.dest.h = next.h;
  return true;
}

function getCloth(id) {
  const c = CLOTHES_BY_ID.get(Number(id));
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    order: c.order,
    z: c.z,
    src: { ...c.src },
    reveals: [...c.reveals],
    dest: { ...c.dest },
  };
}

function setClothZ(id, z) {
  const cloth = CLOTHES_BY_ID.get(Number(id));
  const nz = Number(z);
  if (!cloth || !Number.isFinite(nz)) return false;
  cloth.z = nz;
  return true;
}

function clientToCanvasPx(clientX, clientY) {
  const rect = ui.canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (ui.canvas.width / rect.width);
  const y = (clientY - rect.top) * (ui.canvas.height / rect.height);
  return { x, y };
}

function clientToBasePx(clientX, clientY) {
  if (!lastBaseRect) return null;
  const p = clientToCanvasPx(clientX, clientY);
  const sx = lastBaseRect.w / BASE_W;
  const sy = lastBaseRect.h / BASE_H;
  return { x: (p.x - lastBaseRect.x) / sx, y: (p.y - lastBaseRect.y) / sy };
}

function exportClothesLayout() {
  return CLOTHES.map((c) => ({
    id: c.id,
    name: c.name,
    order: c.order,
    z: c.z,
    src: { ...c.src },
    reveals: [...c.reveals],
    dest: { ...c.dest },
  }));
}

window.__UNDRESSING__ = {
  start,
  resetAll,
  setDevModeEnabled,
  setDevVisibleIds,
  setDevOptions,
  getDevVisibleIds,
  getCloth,
  setClothDest,
  setClothZ,
  exportClothesLayout,
  clientToBasePx,
  get baseSize() {
    return { w: BASE_W, h: BASE_H };
  },
  get texturesLoaded() {
    return !!textures;
  },
  get devState() {
    return { ...DEV_STATE, visibleIds: getDevVisibleIds() };
  },
};
