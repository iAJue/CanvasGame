// WebGL 2D 贴图叠加示例：
// - `shared-0-sheet1.png`：人物底图（没有眼睛）
// - `shared-0-sheet3.png`：精灵图（左右眼/眉毛/嘴巴/鼻子/流汗/下眼皮 等）
//
// 核心思路：
// 1) 把精灵图里的“子矩形”转换成 UV（0~1）
// 2) 用一个单位矩形(0..1) + translate/size，在 WebGL 里画到指定像素位置
// 3) 通过“竖向缩放”让眼睛眨动；眉毛/下眼皮跟着一起动

const BASE_IMAGE_URL = "../images/shared-0-sheet1.png";
const ATLAS_IMAGE_URL = "../images/shared-0-sheet3.png";
const COWLICK_IMAGE_URL = "../images/shared-0-sheet5.png";

// 画布上方留白：避免头顶元素（呆毛）甩动时被裁切
const STAGE_PADDING_TOP_PX = 100;

// ===== 1) 精灵图切片坐标（像素坐标：左上角为原点）=====
// - 流汗: 42 142 67 168
// - 嘴巴: 146 172 162 168
// - 鼻子: 165 108 180 123
// - 左下眼皮: 48 38 99 46
// - 右下眼皮: 178 32 219 46
const SPRITES = {
  // 眼睛/眉毛
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

// 呆毛（sheet5）是单独一张图：只需要定义“旋转支点”（围绕左下角甩动）
const COWLICK_PIVOT_PX = { x: 1, y: 62 }; // shared-0-sheet5.png 内部像素坐标：左下角附近

// ===== 2) 数学/缓动工具 =====
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

// ===== 3) UV / 尺寸 / 相对偏移 =====
// 把像素矩形转成 UV（0~1）。
// 关键点：上传纹理时设置 `UNPACK_FLIP_Y_WEBGL=true`，这样 (0,0) 就是“左上角”，UV 的 v 方向也更符合直觉。
function uvFromPxRect(rect, texW, texH) {
  const u0 = rect.x0 / texW;
  const u1 = rect.x1 / texW;
  const v0 = rect.y0 / texH; // top
  const v1 = rect.y1 / texH; // bottom
  return { u0, v0, u1, v1 };
}

function rectSize(rect) {
  return { w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 };
}

// 从“上往下合眼”的裁剪：保持底边不动，把可见区域的顶部 v0 向 v1 推进
function cropUvFromTop(uvRect, openFactor) {
  const t = clamp(openFactor, 0, 1);
  const v0 = lerp(uvRect.v1, uvRect.v0, t); // t=1 全开(原v0)，t=0 全闭(靠近v1)
  return { u0: uvRect.u0, v0, u1: uvRect.u1, v1: uvRect.v1 };
}

// 把部件在精灵图里的左上角，换算成“相对锚点”的偏移（像素）
function offsetFromAnchorPx(partRect, anchorRect) {
  return { x: partRect.x0 - anchorRect.x0, y: partRect.y0 - anchorRect.y0 };
}

// ===== 4) 资源加载 =====
async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

// ===== 5) WebGL 基础封装（编译/链接/贴图）=====
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "";
    gl.deleteShader(shader);
    throw new Error(log);
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
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function createTextureFromImage(gl, img) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // 关键：让纹理的 (0,0) 变成“左上角”，这样我们用像素坐标裁剪的 UV 就不会上下颠倒。
  // gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// ===== 6) UI（目前只提供眼睛位置/缩放/眨眼间隔调参）=====
function bindRangeWithOutput(input, output, fmt = (v) => `${v}`) {
  const sync = () => {
    output.value = fmt(input.value);
  };
  input.addEventListener("input", sync);
  sync();
}

function setupUi(state, canvas, baseSize) {
  const $ = (id) => document.getElementById(id);

  const scale = $("scale");
  const lx = $("lx");
  const ly = $("ly");
  const rx = $("rx");
  const ry = $("ry");
  const blinkEvery = $("blinkEvery");

  lx.max = `${canvas.width}`;
  rx.max = `${canvas.width}`;
  // 这里限制为“底图坐标系”的范围（不含上方留白）
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

// ===== 7) 眨眼时间线 =====
function computeBlinkFactor(nowMs, blink) {
  // 返回“眼睛张开程度”：1=全开，0.05=几乎闭上
  if (!blink.active) return 1;

  const t = (nowMs - blink.startMs) / 1000;
  const closeSec = 0.075; //闭眼用时（越大闭得越慢）
  const holdSec = 0.02; //闭眼停留（越大闭住时间越久）
  const openSec = 0.155; //睁眼用时（越大睁得越慢）
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
  // 随机一些间隔，避免机械感
  const base = clamp(state.blinkEverySec, 0.8, 20);
  const jitter = lerp(0.6, 1.4, Math.random());
  blink.nextAtMs = nowMs + base * jitter * 1000;
}

function startBlink(nowMs, blink) {
  blink.active = true;
  blink.startMs = nowMs;
}

async function main() {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });
  if (!gl) throw new Error("WebGL2 不可用（请换浏览器或开启硬件加速）");

  // 先把图片加载出来：底图 + 精灵图 + 呆毛
  const [baseImg, atlasImg, cowlickImg] = await Promise.all([
    loadImage(BASE_IMAGE_URL),
    loadImage(ATLAS_IMAGE_URL),
    loadImage(COWLICK_IMAGE_URL),
  ]);

  // 画布像素大小：宽度跟底图一致，高度额外加上方留白（给呆毛用）
  const baseSize = { w: baseImg.width, h: baseImg.height };
  canvas.width = baseSize.w;
  canvas.height = baseSize.h + STAGE_PADDING_TOP_PX;
  const stageOffsetPx = { x: 0, y: STAGE_PADDING_TOP_PX }; // 底图左上角在 canvas 里的偏移
  
  // GLSL ES 3.00 的 WebGL2 顶点着色器
  // ===== Shader：用一个单位正方形(0..1) 的顶点，配合 translate/size 拼出屏幕矩形 =====
  const vs = `#version 300 es
precision highp float;
in vec2 a_pos;               // 0..1 的矩形顶点
uniform vec2 u_pivotPx;      // 旋转/放缩支点在 canvas 的像素坐标（canvas 坐标系：x 右，y 下）
uniform vec2 u_sizePx;       // 宽高（像素）
uniform vec2 u_canvasPx;     // canvas 宽高（像素）
uniform vec2 u_pivot01;      // 支点在“局部矩形(0..1)”中的位置：例如左下角是 (0,1)
uniform float u_rot;         // 旋转角（弧度），绕支点旋转
uniform vec4 u_uv;           // (u0, v0, u1, v1) 其中 v0 是 top, v1 是 bottom
out vec2 v_uv;
void main() {
  // 先把顶点从 (0..1) 转成相对于支点的“局部像素坐标”
  vec2 localPx = (a_pos - u_pivot01) * u_sizePx;
  // 围绕支点旋转（二维旋转矩阵）
  float c = cos(u_rot);
  float s = sin(u_rot);
  vec2 rotLocalPx = vec2(c * localPx.x - s * localPx.y, s * localPx.x + c * localPx.y);
  // 把旋转后的局部坐标平移到 canvas 像素空间
  vec2 px = u_pivotPx + rotLocalPx;
  vec2 ndc = vec2((px.x / u_canvasPx.x) * 2.0 - 1.0, 1.0 - (px.y / u_canvasPx.y) * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_uv = vec2(mix(u_uv.x, u_uv.z, a_pos.x), mix(u_uv.y, u_uv.w, a_pos.y));
}`;

  const fs = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv);
}`;

  const program = createProgram(gl, vs, fs);
  const loc = {
    aPos: gl.getAttribLocation(program, "a_pos"),
    uPivotPx: gl.getUniformLocation(program, "u_pivotPx"),
    uSizePx: gl.getUniformLocation(program, "u_sizePx"),
    uCanvasPx: gl.getUniformLocation(program, "u_canvasPx"),
    uPivot01: gl.getUniformLocation(program, "u_pivot01"),
    uRot: gl.getUniformLocation(program, "u_rot"),
    uUv: gl.getUniformLocation(program, "u_uv"),
    uTex: gl.getUniformLocation(program, "u_tex"),
  };

  // 一个矩形（两个三角形），顶点坐标是 0..1
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(loc.aPos);
  gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // 底图贴图 + 精灵图贴图 + 呆毛贴图
  const baseTex = createTextureFromImage(gl, baseImg);
  const atlasTex = createTextureFromImage(gl, atlasImg);
  const cowlickTex = createTextureFromImage(gl, cowlickImg);

  // ===== 把切片坐标转换成 UV，并算出宽高 =====
  const uvBase = { u0: 0, v0: 0, u1: 1, v1: 1 };
  const uv = {
    leftEye: uvFromPxRect(SPRITES.leftEye, atlasImg.width, atlasImg.height),
    rightEye: uvFromPxRect(SPRITES.rightEye, atlasImg.width, atlasImg.height),
    leftBrow: uvFromPxRect(SPRITES.leftBrow, atlasImg.width, atlasImg.height),
    rightBrow: uvFromPxRect(SPRITES.rightBrow, atlasImg.width, atlasImg.height),
    sweat: uvFromPxRect(SPRITES.sweat, atlasImg.width, atlasImg.height),
    mouth: uvFromPxRect(SPRITES.mouth, atlasImg.width, atlasImg.height),
    nose: uvFromPxRect(SPRITES.nose, atlasImg.width, atlasImg.height),
    leftLowerLid: uvFromPxRect(SPRITES.leftLowerLid, atlasImg.width, atlasImg.height),
    rightLowerLid: uvFromPxRect(SPRITES.rightLowerLid, atlasImg.width, atlasImg.height),
  };

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

  // 呆毛：整张图就是一个 sprite（不切片）
  const uvCowlick = { u0: 0, v0: 0, u1: 1, v1: 1 };
  const cowlickSize = { w: cowlickImg.width, h: cowlickImg.height };
  // 支点在局部(0..1)的坐标：围绕“左下角附近”旋转
  const cowlickPivot01 = { x: COWLICK_PIVOT_PX.x / cowlickImg.width, y: COWLICK_PIVOT_PX.y / cowlickImg.height };

  // ===== 锚点与相对偏移 =====
  // 这里用“眼睛左上角”作为锚点，让面部元素跟随眼睛整体移动（方便你用滑条调位置）。
  // 如果你想让嘴巴/鼻子独立于眼睛移动，可以把它们改成“画布绝对坐标”。
  const off = {
    leftBrow: offsetFromAnchorPx(SPRITES.leftBrow, SPRITES.leftEye),
    rightBrow: offsetFromAnchorPx(SPRITES.rightBrow, SPRITES.rightEye),
    leftLowerLid: offsetFromAnchorPx(SPRITES.leftLowerLid, SPRITES.leftEye),
    rightLowerLid: offsetFromAnchorPx(SPRITES.rightLowerLid, SPRITES.rightEye),
    nose: offsetFromAnchorPx(SPRITES.nose, SPRITES.leftEye),
    mouth: offsetFromAnchorPx(SPRITES.mouth, SPRITES.leftEye),
    sweat: offsetFromAnchorPx(SPRITES.sweat, SPRITES.leftEye),
  };

  // ===== 可调参数（用右侧滑条调眼睛位置/缩放/眨眼间隔）=====
  const state = {
    eyeScale: 1.10,
    leftEye: { x: 160, y: 263 },
    rightEye: { x: 305, y: 263 },
    blinkEverySec: 3.2,
    // 呆毛相对左眼锚点的偏移
    cowlickOffset: { x: 80, y: -240 },
    // 呆毛额外缩放
    cowlickScale: 1.0,
  };
  setupUi(state, canvas, baseSize);

  // ===== 眨眼调度 =====
  const blink = { active: false, startMs: 0, nextAtMs: 0 };
  scheduleNextBlink(performance.now(), state, blink);

  // 便于调试：空格键立刻眨一次
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      startBlink(performance.now(), blink);
    }
  });

  // 绘制一个贴图矩形（不旋转）：默认支点在左上角 (0,0)
  function drawSprite(tex, x, y, w, h, uvRect) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 所有元素都在“底图坐标系”里计算，这里统一加 stageOffset 把它们挪到 canvas 正确位置
    gl.uniform2f(loc.uPivotPx, x + stageOffsetPx.x, y + stageOffsetPx.y);
    gl.uniform2f(loc.uSizePx, w, h);
    gl.uniform2f(loc.uPivot01, 0, 0);
    gl.uniform1f(loc.uRot, 0);
    gl.uniform4f(loc.uUv, uvRect.u0, uvRect.v0, uvRect.u1, uvRect.v1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // 绘制一个贴图矩形（可旋转）：围绕 pivot01 / pivotPx 旋转
  function drawSpritePivot(tex, pivotPx, w, h, uvRect, pivot01, rotRad) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(loc.uPivotPx, pivotPx.x + stageOffsetPx.x, pivotPx.y + stageOffsetPx.y);
    gl.uniform2f(loc.uSizePx, w, h);
    gl.uniform2f(loc.uPivot01, pivot01.x, pivot01.y);
    gl.uniform1f(loc.uRot, rotRad);
    gl.uniform4f(loc.uUv, uvRect.u0, uvRect.v0, uvRect.u1, uvRect.v1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform1i(loc.uTex, 0);

  function frame(nowMs) {
    // 1) 到点就触发眨眼
    if (!blink.active && nowMs >= blink.nextAtMs) {
      startBlink(nowMs, blink);
      scheduleNextBlink(nowMs, state, blink);
      if (Math.random() < 0.12) blink.nextAtMs = nowMs + 220; // 偶尔双眨
    }

    // 2) 计算眨眼强度
    const openFactor = computeBlinkFactor(nowMs, blink); // 1=睁开，越小越闭
    const blinkAmt = clamp(1 - openFactor, 0, 1); // 0=睁开，1=闭合

    // 3) 清屏并设置混合（透明叠加必需）
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.uCanvasPx, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);

    // 4) 绘制顺序就是“层级”（后画的会盖在前面）
    // 4.1 底图
    drawSprite(baseTex, 0, 0, baseSize.w, baseSize.h, uvBase);

    // 4.2 计算缩放与锚点位置（所有部件跟着同一套缩放）
    const s = state.eyeScale;
    const leftAnchor = state.leftEye;
    const rightAnchor = state.rightEye;

    // 4.2.1 呆毛：放在头顶附近，并围绕“左下角支点”甩动
    // - pivotPx 是呆毛旋转支点在 canvas 上的位置
    // - 角度用正弦做往复摆动；眨眼时略微加大幅度，更有“甩动”的感觉
    const cowlickS = s * state.cowlickScale;
    const cowlickPivotPx = {
      x: leftAnchor.x + state.cowlickOffset.x * s,
      y: leftAnchor.y + state.cowlickOffset.y * s,
    };
    const baseSwing = Math.sin(nowMs / 260) * (0.18 + 0.08 * blinkAmt); // 弧度
    const spring = Math.sin(nowMs / 90) * 0.03 * (0.2 + 0.8 * blinkAmt);
    const cowlickRot = baseSwing + spring;
    drawSpritePivot(
      cowlickTex,
      cowlickPivotPx,
      cowlickSize.w * cowlickS,
      cowlickSize.h * cowlickS,
      uvCowlick,
      cowlickPivot01,
      cowlickRot,
    );

    // 4.3 鼻子/嘴巴
    const noseX = leftAnchor.x + off.nose.x * s - 20 * s;
    const noseY = leftAnchor.y + off.nose.y * s + 5 * s;
    drawSprite(atlasTex, noseX, noseY, size.nose.w * s, size.nose.h * s, uv.nose);

    const mouthX = leftAnchor.x + (off.mouth.x - 15) * s;
    const mouthY = leftAnchor.y + off.mouth.y * s;
    drawSprite(atlasTex, mouthX, mouthY, size.mouth.w * s, size.mouth.h * s, uv.mouth);

    // 4.4 眼睛：从上往下“合眼”实现眨眼（顶部向下收合，底边基本不动）
    const leftEyeW = size.leftEye.w * s;
    const leftEyeH = size.leftEye.h * s;
    const rightEyeW = size.rightEye.w * s;
    const rightEyeH = size.rightEye.h * s;

    const leftEyeHNow = Math.max(1, leftEyeH * openFactor);
    const rightEyeHNow = Math.max(1, rightEyeH * openFactor);

    // 关键点：底边固定，顶部向下收合
    const leftEyeY = leftAnchor.y + (leftEyeH - leftEyeHNow);
    const rightEyeY = rightAnchor.y + (rightEyeH - rightEyeHNow);
    const leftEyeUv = cropUvFromTop(uv.leftEye, openFactor);
    const rightEyeUv = cropUvFromTop(uv.rightEye, openFactor);

    drawSprite(atlasTex, leftAnchor.x, leftEyeY, leftEyeW, leftEyeHNow, leftEyeUv);
    drawSprite(atlasTex, rightAnchor.x, rightEyeY, rightEyeW, rightEyeHNow, rightEyeUv);

    // 4.5 下眼皮：画在眼睛上面，并在眨眼时略微“向下”
    const lidRisePx = -4 * s;
    const lidRise = smoothstep01(blinkAmt) * lidRisePx;

    const leftLidX = leftAnchor.x + off.leftLowerLid.x * s;
    const leftLidY = leftAnchor.y + off.leftLowerLid.y * s - lidRise;
    drawSprite(atlasTex, leftLidX, leftLidY, size.leftLowerLid.w * s, size.leftLowerLid.h * s, uv.leftLowerLid);

    const rightLidX = rightAnchor.x + off.rightLowerLid.x * s;
    const rightLidY = rightAnchor.y + off.rightLowerLid.y * s - lidRise;
    drawSprite(atlasTex, rightLidX, rightLidY, size.rightLowerLid.w * s, size.rightLowerLid.h * s, uv.rightLowerLid);

    // 4.6 眉毛：你要求“眨眼时眉毛一起眨动” -> 眨眼时整体向下压一点
    const browDropPx = 7 * s;
    const browDrop = smoothstep01(blinkAmt) * browDropPx;

    const leftBrowX = leftAnchor.x + off.leftBrow.x * s;
    const leftBrowY = leftAnchor.y + off.leftBrow.y * s + browDrop;
    drawSprite(atlasTex, leftBrowX, leftBrowY, size.leftBrow.w * s, size.leftBrow.h * s, uv.leftBrow);

    const rightBrowX = rightAnchor.x + off.rightBrow.x * s;
    const rightBrowY = rightAnchor.y + off.rightBrow.y * s + browDrop;
    drawSprite(atlasTex, rightBrowX, rightBrowY, size.rightBrow.w * s, size.rightBrow.h * s, uv.rightBrow);

    // 4.7 流汗：画在最上层，并做一个轻微上下飘动（想静止就把 sweatBob 设为 0）
    const sweatBob = Math.sin(nowMs / 420) * 1.2 * s;
    const sweatX = leftAnchor.x + off.sweat.x * s;
    const sweatY = leftAnchor.y + off.sweat.y * s + sweatBob;
    drawSprite(atlasTex, sweatX, sweatY, size.sweat.w * s, size.sweat.h * s, uv.sweat);

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
