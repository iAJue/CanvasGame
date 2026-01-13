// 纯 DOM 版本（不使用 Canvas）：用绝对定位叠加图片 + JS 修改样式实现动画。
// 坐标体系说明：
// - “底图坐标系”：以 shared-0-sheet1.png 左上角为 (0,0)，x 向右，y 向下
// - 为了让头顶呆毛甩动不被裁切，会在舞台上方加留白（stagePaddingTop），底图整体下移

const BASE_IMAGE_URL = "../canvas/shared-0-sheet1.png";
const ATLAS_IMAGE_URL = "../canvas/shared-0-sheet3.png";
const COWLICK_IMAGE_URL = "../canvas/shared-0-sheet5.png";

// 画布上方留白：避免头顶元素（呆毛）甩动时被裁切
const STAGE_PADDING_TOP_PX = 140;

// 呆毛甩动支点（在 shared-0-sheet5.png 内部的像素坐标：左下角附近）
const COWLICK_PIVOT_PX = { x: 1, y: 62 };

// 精灵图切片坐标（像素坐标：左上角为原点）
const SPRITES = {
  leftEye: { x0: 12, y0: 49, x1: 110, y1: 103 },
  rightEye: { x0: 166, y0: 49, x1: 242, y1: 99 },
  leftBrow: { x0: 33, y0: 11, x1: 115, y1: 28 },
  rightBrow: { x0: 174, y0: 4, x1: 233, y1: 26 },
  sweat: { x0: 42, y0: 142, x1: 67, y1: 168 },
  mouth: { x0: 146, y0: 172, x1: 182, y1: 188 },
  nose: { x0: 165, y0: 108, x1: 180, y1: 123 },
  leftLowerLid: { x0: 48, y0: 38, x1: 99, y1: 46 },
  rightLowerLid: { x0: 178, y0: 32, x1: 219, y1: 46 },
};

function rectSize(rect) {
  return { w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 };
}

function offsetFromAnchorPx(partRect, anchorRect) {
  return { x: partRect.x0 - anchorRect.x0, y: partRect.y0 - anchorRect.y0 };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep01(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t) {
  t = clamp(t, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function bindRangeWithOutput(input, output, fmt = (v) => `${v}`) {
  const sync = () => {
    output.value = fmt(input.value);
  };
  input.addEventListener("input", sync);
  sync();
}

function setupUi(state, baseSize) {
  const $ = (id) => document.getElementById(id);

  const scale = $("scale");
  const lx = $("lx");
  const ly = $("ly");
  const rx = $("rx");
  const ry = $("ry");
  const blinkEvery = $("blinkEvery");

  lx.max = `${baseSize.w}`;
  rx.max = `${baseSize.w}`;
  ly.max = `${baseSize.h}`;
  ry.max = `${baseSize.h}`;

  scale.value = `${state.eyeScale}`;
  lx.value = `${state.leftEye.x}`;
  ly.value = `${state.leftEye.y}`;
  rx.value = `${state.rightEye.x}`;
  ry.value = `${state.rightEye.y}`;
  blinkEvery.value = `${state.blinkEverySec}`;

  bindRangeWithOutput(scale, $("scaleOut"), (v) => Number(v).toFixed(2));
  bindRangeWithOutput(lx, $("lxOut"), (v) => `${v}px`);
  bindRangeWithOutput(ly, $("lyOut"), (v) => `${v}px`);
  bindRangeWithOutput(rx, $("rxOut"), (v) => `${v}px`);
  bindRangeWithOutput(ry, $("ryOut"), (v) => `${v}px`);
  bindRangeWithOutput(blinkEvery, $("blinkEveryOut"), (v) => Number(v).toFixed(1));

  const onChange = () => {
    state.eyeScale = Number(scale.value);
    state.leftEye.x = Number(lx.value);
    state.leftEye.y = Number(ly.value);
    state.rightEye.x = Number(rx.value);
    state.rightEye.y = Number(ry.value);
    state.blinkEverySec = Number(blinkEvery.value);
  };
  for (const el of [scale, lx, ly, rx, ry, blinkEvery]) el.addEventListener("input", onChange);
  onChange();
}

function computeBlinkFactor(nowMs, blink) {
  // 返回“眼睛张开程度”：1=全开，0.05=几乎闭上
  if (!blink.active) return 1;

  const t = (nowMs - blink.startMs) / 1000;
  // 眨眼动作时长（想调速度就改这里）
  const closeSec = 0.075;
  const holdSec = 0.02;
  const openSec = 0.105;
  const total = closeSec + holdSec + openSec;

  if (t >= total) {
    blink.active = false;
    return 1;
  }

  const minOpen = 0.05;
  if (t <= closeSec) return lerp(1, minOpen, easeOutCubic(t / closeSec));
  if (t <= closeSec + holdSec) return minOpen;
  return lerp(minOpen, 1, smoothstep01((t - closeSec - holdSec) / openSec));
}

function scheduleNextBlink(nowMs, state, blink) {
  const base = clamp(state.blinkEverySec, 0.8, 20);
  const jitter = lerp(0.6, 1.4, Math.random());
  blink.nextAtMs = nowMs + base * jitter * 1000;
}

function startBlink(nowMs, blink) {
  blink.active = true;
  blink.startMs = nowMs;
}

// 用 background-position 显示 atlas 的子矩形
function applyAtlasSpriteStyle(el, atlasUrl, atlasW, atlasH, rect, s) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  el.style.backgroundImage = `url(${atlasUrl})`;
  el.style.backgroundSize = `${atlasW * s}px ${atlasH * s}px`;
  el.style.backgroundPosition = `${-rect.x0 * s}px ${-rect.y0 * s}px`;
  el.style.width = `${w * s}px`;
  el.style.height = `${h * s}px`;
}

function setPos(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function setSize(el, w, h) {
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

function ensureEl(parent, className) {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

async function main() {
  const stageOuter = document.getElementById("stageOuter");
  const stageInner = document.getElementById("stageInner");

  const [baseImg, atlasImg, cowlickImg] = await Promise.all([
    loadImage(BASE_IMAGE_URL),
    loadImage(ATLAS_IMAGE_URL),
    loadImage(COWLICK_IMAGE_URL),
  ]);

  // 舞台尺寸：宽度=底图宽度，高度=底图高度+留白
  const baseSize = { w: baseImg.width, h: baseImg.height };
  const stageSize = { w: baseSize.w, h: baseSize.h + STAGE_PADDING_TOP_PX };

  stageOuter.style.width = `${stageSize.w}px`;
  stageOuter.style.height = `${stageSize.h}px`;
  stageInner.style.width = `${stageSize.w}px`;
  stageInner.style.height = `${stageSize.h}px`;

  // 让舞台在窄屏下自适应缩放（不影响内部坐标计算）
  function syncScale() {
    const parent = stageOuter.parentElement;
    if (!parent) return;
    const maxW = parent.clientWidth;
    const scale = Math.min(1, maxW / stageSize.w);
    stageOuter.style.transform = `scale(${scale})`;
  }
  window.addEventListener("resize", syncScale);
  syncScale();

  // 底图
  const baseEl = document.createElement("img");
  baseEl.className = "base";
  baseEl.src = baseImg.src;
  baseEl.style.left = "0px";
  baseEl.style.top = `${STAGE_PADDING_TOP_PX}px`;
  baseEl.style.width = `${baseSize.w}px`;
  baseEl.style.height = `${baseSize.h}px`;
  stageInner.appendChild(baseEl);

  // 用于渲染 atlas 的元素们
  const browL = ensureEl(stageInner, "sprite");
  const browR = ensureEl(stageInner, "sprite");
  const lidL = ensureEl(stageInner, "sprite");
  const lidR = ensureEl(stageInner, "sprite");
  const nose = ensureEl(stageInner, "sprite");
  const mouth = ensureEl(stageInner, "sprite");
  const sweat = ensureEl(stageInner, "sprite");

  // 眼睛：mask + sprite
  const eyeMaskL = ensureEl(stageInner, "eyeMask");
  const eyeSpriteL = ensureEl(eyeMaskL, "eyeSprite");
  const eyeMaskR = ensureEl(stageInner, "eyeMask");
  const eyeSpriteR = ensureEl(eyeMaskR, "eyeSprite");

  // 呆毛：用 img，方便做 transform-origin
  const cowlick = document.createElement("img");
  cowlick.className = "cowlick";
  cowlick.src = cowlickImg.src;
  stageInner.appendChild(cowlick);

  // 预计算尺寸/偏移（基于精灵图切片坐标）
  const size = Object.fromEntries(Object.entries(SPRITES).map(([k, r]) => [k, rectSize(r)]));
  const off = {
    leftBrow: offsetFromAnchorPx(SPRITES.leftBrow, SPRITES.leftEye),
    rightBrow: offsetFromAnchorPx(SPRITES.rightBrow, SPRITES.rightEye),
    leftLowerLid: offsetFromAnchorPx(SPRITES.leftLowerLid, SPRITES.leftEye),
    rightLowerLid: offsetFromAnchorPx(SPRITES.rightLowerLid, SPRITES.rightEye),
    nose: offsetFromAnchorPx(SPRITES.nose, SPRITES.leftEye),
    mouth: offsetFromAnchorPx(SPRITES.mouth, SPRITES.leftEye),
    sweat: offsetFromAnchorPx(SPRITES.sweat, SPRITES.leftEye),
  };

  // 可调参数（目前只提供眼睛位置/缩放）
  const state = {
    eyeScale: 1.1,
    leftEye: { x: 160, y: 263 },
    rightEye: { x: 305, y: 263 },
    blinkEverySec: 3.2,
    // 呆毛位置：相对左眼锚点的偏移（改它把呆毛挪到头上）
    cowlickOffset: { x: 80, y: -240 },
    cowlickScale: 1.0,
  };
  setupUi(state, baseSize);

  // 眨眼调度
  const blink = { active: false, startMs: 0, nextAtMs: 0 };
  scheduleNextBlink(performance.now(), state, blink);

  // 空格键立刻眨一次
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      startBlink(performance.now(), blink);
    }
  });

  // 一次性设置不变的 class（方便调试）
  browL.dataset.name = "leftBrow";
  browR.dataset.name = "rightBrow";
  lidL.dataset.name = "leftLowerLid";
  lidR.dataset.name = "rightLowerLid";
  nose.dataset.name = "nose";
  mouth.dataset.name = "mouth";
  sweat.dataset.name = "sweat";
  eyeMaskL.dataset.name = "leftEyeMask";
  eyeMaskR.dataset.name = "rightEyeMask";
  cowlick.dataset.name = "cowlick";

  function frame(nowMs) {
    if (!blink.active && nowMs >= blink.nextAtMs) {
      startBlink(nowMs, blink);
      scheduleNextBlink(nowMs, state, blink);
      if (Math.random() < 0.12) blink.nextAtMs = nowMs + 220;
    }

    const openFactor = computeBlinkFactor(nowMs, blink); // 1=睁开，越小越闭
    const blinkAmt = clamp(1 - openFactor, 0, 1); // 0=睁开，1=闭合
    const s = state.eyeScale;

    // 统一把“底图坐标系”的 y 加上留白偏移
    const y0 = STAGE_PADDING_TOP_PX;

    // 先把 atlas sprite 的背景/尺寸更新到最新缩放
    applyAtlasSpriteStyle(browL, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.leftBrow, s);
    applyAtlasSpriteStyle(browR, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.rightBrow, s);
    applyAtlasSpriteStyle(lidL, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.leftLowerLid, s);
    applyAtlasSpriteStyle(lidR, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.rightLowerLid, s);
    applyAtlasSpriteStyle(nose, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.nose, s);
    applyAtlasSpriteStyle(mouth, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.mouth, s);
    applyAtlasSpriteStyle(sweat, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.sweat, s);
    applyAtlasSpriteStyle(eyeSpriteL, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.leftEye, s);
    applyAtlasSpriteStyle(eyeSpriteR, atlasImg.src, atlasImg.width, atlasImg.height, SPRITES.rightEye, s);

    // 鼻子/嘴巴（位置偏移可以按需改这里）
    setPos(nose, state.leftEye.x + off.nose.x * s - 20 * s, y0 + state.leftEye.y + off.nose.y * s + 5 * s);
    setPos(mouth, state.leftEye.x + off.mouth.x * s - 5 * s, y0 + state.leftEye.y + off.mouth.y * s);

    // 眼睛：从上往下合眼（mask 高度变小，sprite 贴底）
    const leftEyeW = size.leftEye.w * s;
    const leftEyeH = size.leftEye.h * s;
    const rightEyeW = size.rightEye.w * s;
    const rightEyeH = size.rightEye.h * s;

    const leftVisH = Math.max(1, leftEyeH * openFactor);
    const rightVisH = Math.max(1, rightEyeH * openFactor);

    setSize(eyeMaskL, leftEyeW, leftVisH);
    setPos(eyeMaskL, state.leftEye.x, y0 + state.leftEye.y + (leftEyeH - leftVisH));
    setSize(eyeSpriteL, leftEyeW, leftEyeH);

    setSize(eyeMaskR, rightEyeW, rightVisH);
    setPos(eyeMaskR, state.rightEye.x, y0 + state.rightEye.y + (rightEyeH - rightVisH));
    setSize(eyeSpriteR, rightEyeW, rightEyeH);

    // 下眼皮：眨眼时略微下抬
    const lidRise = smoothstep01(blinkAmt) * (-4 * s);
    setPos(lidL, state.leftEye.x + off.leftLowerLid.x * s, y0 + state.leftEye.y + off.leftLowerLid.y * s - lidRise);
    setPos(
      lidR,
      state.rightEye.x + off.rightLowerLid.x * s,
      y0 + state.rightEye.y + off.rightLowerLid.y * s - lidRise,
    );

    // 眉毛：眨眼时一起向下压
    const browDrop = smoothstep01(blinkAmt) * (7 * s);
    setPos(browL, state.leftEye.x + off.leftBrow.x * s, y0 + state.leftEye.y + off.leftBrow.y * s + browDrop);
    setPos(browR, state.rightEye.x + off.rightBrow.x * s, y0 + state.rightEye.y + off.rightBrow.y * s + browDrop);

    // 流汗：最上层 + 轻微上下飘动
    const sweatBob = Math.sin(nowMs / 420) * 1.2 * s;
    setPos(sweat, state.leftEye.x + off.sweat.x * s , y0 + state.leftEye.y + off.sweat.y * s + sweatBob);

    // 呆毛：围绕左下角支点甩动
    const cowlickS = s * state.cowlickScale;
    const pivot01 = { x: COWLICK_PIVOT_PX.x / cowlickImg.width, y: COWLICK_PIVOT_PX.y / cowlickImg.height };
    const originPx = { x: pivot01.x * cowlickImg.width * cowlickS, y: pivot01.y * cowlickImg.height * cowlickS };
    const pivotTarget = {
      x: state.leftEye.x + state.cowlickOffset.x * s,
      y: y0 + state.leftEye.y + state.cowlickOffset.y * s,
    };
    const baseSwing = Math.sin(nowMs / 260) * (0.18 + 0.08 * blinkAmt);
    const spring = Math.sin(nowMs / 90) * 0.03 * (0.2 + 0.8 * blinkAmt);
    const rot = baseSwing + spring;

    cowlick.style.width = `${cowlickImg.width * cowlickS}px`;
    cowlick.style.height = `${cowlickImg.height * cowlickS}px`;
    cowlick.style.transformOrigin = `${originPx.x}px ${originPx.y}px`;
    cowlick.style.transform = `rotate(${rot}rad)`;
    setPos(cowlick, pivotTarget.x - originPx.x, pivotTarget.y - originPx.y);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  pre.textContent = String(err?.stack || err);
  pre.style.whiteSpace = "pre-wrap";
  pre.style.margin = "16px";
  document.body.appendChild(pre);
});

