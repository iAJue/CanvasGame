// Canvas 2D 版本：不使用 WebGL，全部用 drawImage + transform 实现叠加与动画。

const BASE_IMAGE_URL = "../images/shared-0-sheet1.png";
const ATLAS_IMAGE_URL = "../images/shared-0-sheet3.png";
const COWLICK_IMAGE_URL = "../images/shared-0-sheet5.png";

// 画布上方留白：避免头顶元素（呆毛）甩动时被裁切
const STAGE_PADDING_TOP_PX = 100;

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
  if (!blink.active) return 1;

  const t = (nowMs - blink.startMs) / 1000;
  // 眨眼动作时长（你想调速度就改这里）
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

function drawSprite(ctx, img, srcRect, dstX, dstY, dstW, dstH) {
  ctx.drawImage(img, srcRect.x0, srcRect.y0, srcRect.x1 - srcRect.x0, srcRect.y1 - srcRect.y0, dstX, dstY, dstW, dstH);
}

// 从上往下合眼：保持底边不动，顶部向下收合（同时裁剪源图顶部）
function drawEyeCloseFromTop(ctx, atlasImg, srcRect, x, y, w, h, openFactor) {
  const t = clamp(openFactor, 0, 1);
  const visibleH = Math.max(1, h * t);
  const cropTopPx = (1 - t) * (srcRect.y1 - srcRect.y0);
  const sy = srcRect.y0 + cropTopPx;
  const sh = (srcRect.y1 - srcRect.y0) - cropTopPx;

  // 目标位置：底边固定 => y 增加 (h - visibleH)
  const dy = y + (h - visibleH);
  ctx.drawImage(atlasImg, srcRect.x0, sy, srcRect.x1 - srcRect.x0, sh, x, dy, w, visibleH);
}

function drawCowlickSwing(ctx, cowlickImg, pivotPx, scale, rotRad, stageOffsetPx) {
  const w = cowlickImg.width * scale;
  const h = cowlickImg.height * scale;
  const pivot01 = { x: COWLICK_PIVOT_PX.x / cowlickImg.width, y: COWLICK_PIVOT_PX.y / cowlickImg.height };

  // pivotPx 是“底图坐标系”里的旋转支点；这里统一加 stageOffset 变成画布坐标
  ctx.save();
  ctx.translate(pivotPx.x + stageOffsetPx.x, pivotPx.y + stageOffsetPx.y);
  ctx.rotate(rotRad);
  ctx.translate(-pivot01.x * w, -pivot01.y * h);
  ctx.drawImage(cowlickImg, 0, 0, w, h);
  ctx.restore();
}

async function main() {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("c2d");
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 不可用");

  const [baseImg, atlasImg, cowlickImg] = await Promise.all([
    loadImage(BASE_IMAGE_URL),
    loadImage(ATLAS_IMAGE_URL),
    loadImage(COWLICK_IMAGE_URL),
  ]);

  const baseSize = { w: baseImg.width, h: baseImg.height };
  const stageOffsetPx = { x: 0, y: STAGE_PADDING_TOP_PX };

  // 适配 DPR：避免高分屏发糊
  const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  canvas.width = Math.round(baseSize.w * dpr);
  canvas.height = Math.round((baseSize.h + STAGE_PADDING_TOP_PX) * dpr);
  canvas.style.width = `${baseSize.w}px`;
  canvas.style.height = `${baseSize.h + STAGE_PADDING_TOP_PX}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const size = {
    leftEye: rectSize(SPRITES.leftEye),
    rightEye: rectSize(SPRITES.rightEye),
    leftBrow: rectSize(SPRITES.leftBrow),
    rightBrow: rectSize(SPRITES.rightBrow),
    sweat: rectSize(SPRITES.sweat),
    mouth: rectSize(SPRITES.mouth),
    nose: rectSize(SPRITES.nose),
    leftLowerLid: rectSize(SPRITES.leftLowerLid),
    rightLowerLid: rectSize(SPRITES.rightLowerLid),
  };

  const off = {
    leftBrow: offsetFromAnchorPx(SPRITES.leftBrow, SPRITES.leftEye),
    rightBrow: offsetFromAnchorPx(SPRITES.rightBrow, SPRITES.rightEye),
    leftLowerLid: offsetFromAnchorPx(SPRITES.leftLowerLid, SPRITES.leftEye),
    rightLowerLid: offsetFromAnchorPx(SPRITES.rightLowerLid, SPRITES.rightEye),
    nose: offsetFromAnchorPx(SPRITES.nose, SPRITES.leftEye),
    mouth: offsetFromAnchorPx(SPRITES.mouth, SPRITES.leftEye),
    sweat: offsetFromAnchorPx(SPRITES.sweat, SPRITES.leftEye),
  };

  const state = {
    eyeScale: 1.1,
    leftEye: { x: 160, y: 263 },
    rightEye: { x: 305, y: 263 },
    blinkEverySec: 3.2,
    cowlickOffset: { x: 80, y: -240 },
    cowlickScale: 1.0,
  };

  setupUi(state, baseSize);

  const blink = { active: false, startMs: 0, nextAtMs: 0 };
  scheduleNextBlink(performance.now(), state, blink);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      startBlink(performance.now(), blink);
    }
  });

  function frame(nowMs) {
    if (!blink.active && nowMs >= blink.nextAtMs) {
      startBlink(nowMs, blink);
      scheduleNextBlink(nowMs, state, blink);
      if (Math.random() < 0.12) blink.nextAtMs = nowMs + 220;
    }

    const openFactor = computeBlinkFactor(nowMs, blink);
    const blinkAmt = clamp(1 - openFactor, 0, 1);
    const s = state.eyeScale;
    const leftAnchor = state.leftEye;
    const rightAnchor = state.rightEye;

    // 清屏
    ctx.clearRect(0, 0, baseSize.w, baseSize.h + STAGE_PADDING_TOP_PX);

    // 底图（整体下移到留白下方）
    ctx.drawImage(baseImg, 0, stageOffsetPx.y);

    // 呆毛：围绕左下角支点甩动
    const cowlickS = s * state.cowlickScale;
    const cowlickPivotPx = {
      x: leftAnchor.x + state.cowlickOffset.x * s,
      y: leftAnchor.y + state.cowlickOffset.y * s,
    };
    const baseSwing = Math.sin(nowMs / 260) * (0.18 + 0.08 * blinkAmt);
    const spring = Math.sin(nowMs / 90) * 0.03 * (0.2 + 0.8 * blinkAmt);
    drawCowlickSwing(ctx, cowlickImg, cowlickPivotPx, cowlickS, baseSwing + spring, stageOffsetPx);

    // 鼻子/嘴巴
    const noseX = leftAnchor.x + off.nose.x * s - 20 * s;
    const noseY = leftAnchor.y + off.nose.y * s + 5 * s;
    drawSprite(ctx, atlasImg, SPRITES.nose, noseX, noseY + stageOffsetPx.y, size.nose.w * s, size.nose.h * s);

    const mouthX = leftAnchor.x + (off.mouth.x - 15) * s;
    const mouthY = leftAnchor.y + off.mouth.y * s;
    drawSprite(ctx, atlasImg, SPRITES.mouth, mouthX, mouthY + stageOffsetPx.y, size.mouth.w * s, size.mouth.h * s);

    // 眼睛：从上往下合眼（底边固定）
    const leftEyeW = size.leftEye.w * s;
    const leftEyeH = size.leftEye.h * s;
    const rightEyeW = size.rightEye.w * s;
    const rightEyeH = size.rightEye.h * s;

    drawEyeCloseFromTop(
      ctx,
      atlasImg,
      SPRITES.leftEye,
      leftAnchor.x,
      leftAnchor.y + stageOffsetPx.y,
      leftEyeW,
      leftEyeH,
      openFactor,
    );
    drawEyeCloseFromTop(
      ctx,
      atlasImg,
      SPRITES.rightEye,
      rightAnchor.x,
      rightAnchor.y + stageOffsetPx.y,
      rightEyeW,
      rightEyeH,
      openFactor,
    );

    // 下眼皮：眨眼时略微下抬
    const lidRise = smoothstep01(blinkAmt) * (-4 * s);
    const leftLidX = leftAnchor.x + off.leftLowerLid.x * s;
    const leftLidY = leftAnchor.y + off.leftLowerLid.y * s - lidRise;
    drawSprite(
      ctx,
      atlasImg,
      SPRITES.leftLowerLid,
      leftLidX,
      leftLidY + stageOffsetPx.y,
      size.leftLowerLid.w * s,
      size.leftLowerLid.h * s,
    );

    const rightLidX = rightAnchor.x + off.rightLowerLid.x * s;
    const rightLidY = rightAnchor.y + off.rightLowerLid.y * s - lidRise;
    drawSprite(
      ctx,
      atlasImg,
      SPRITES.rightLowerLid,
      rightLidX,
      rightLidY + stageOffsetPx.y,
      size.rightLowerLid.w * s,
      size.rightLowerLid.h * s,
    );

    // 眉毛：眨眼时一起向下压
    const browDrop = smoothstep01(blinkAmt) * (7 * s);
    const leftBrowX = leftAnchor.x + off.leftBrow.x * s;
    const leftBrowY = leftAnchor.y + off.leftBrow.y * s + browDrop;
    drawSprite(ctx, atlasImg, SPRITES.leftBrow, leftBrowX, leftBrowY + stageOffsetPx.y, size.leftBrow.w * s, size.leftBrow.h * s);

    const rightBrowX = rightAnchor.x + off.rightBrow.x * s;
    const rightBrowY = rightAnchor.y + off.rightBrow.y * s + browDrop;
    drawSprite(
      ctx,
      atlasImg,
      SPRITES.rightBrow,
      rightBrowX,
      rightBrowY + stageOffsetPx.y,
      size.rightBrow.w * s,
      size.rightBrow.h * s,
    );

    // 流汗：最上层 + 轻微上下飘动
    const sweatBob = Math.sin(nowMs / 420) * 1.2 * s;
    const sweatX = leftAnchor.x + off.sweat.x * s;
    const sweatY = leftAnchor.y + off.sweat.y * s + sweatBob;
    drawSprite(ctx, atlasImg, SPRITES.sweat, sweatX, sweatY + stageOffsetPx.y, size.sweat.w * s, size.sweat.h * s);

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

