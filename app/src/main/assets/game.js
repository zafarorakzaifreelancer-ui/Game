/* Forest Stick Survival
 * Walk through an endless forest with your stick and your dog Buddy.
 * After every 10 seconds of animal-free walking, 1 or 2 wild animals appear.
 *  - Fox:       runs away after it gets hit
 *  - Wild Cat:  backs off a few steps after each hit, then attacks again
 *  - Boar:      backs off after each hit, and charges from a distance
 *  - Wolf:      never runs away
 *  - Bear:      never runs away, very strong (appears later)
 * Eat fruit from fruit trees to recover health.
 */
(() => {
'use strict';

const TAU = Math.PI * 2;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  S = Math.min(W, H) / 330;           // css px per world unit
}
window.addEventListener('resize', resize);
resize();

// ---------- helpers ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function turnTo(cur, target, maxStep) { const d = angDiff(cur, target); return cur + clamp(d, -maxStep, maxStep); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return h ^ h >>> 16;
}
function ellipse(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- storage (best score) ----------
let best = 0;
try { best = parseInt(localStorage.getItem('fss_best') || '0', 10) || 0; } catch (e) { best = 0; }
function saveBest() { try { localStorage.setItem('fss_best', String(best)); } catch (e) { /* ignore */ } }

// ---------- sound (synthesised, no files) ----------
let AC = null;
function audioInit() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { AC = null; }
}
function tone(freq, dur, type, vol, slide) {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq) {
  if (!AC) return;
  const len = Math.max(1, Math.floor(AC.sampleRate * dur));
  const b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = AC.createBufferSource(); s.buffer = b;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1000;
  const g = AC.createGain(); g.gain.value = vol || 0.2;
  s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
}
const SFX = {
  swing() { noise(0.12, 0.25, 1800); },
  hit() { tone(150, 0.12, 'square', 0.13, -70); noise(0.08, 0.3, 600); },
  hurt() { tone(220, 0.25, 'sawtooth', 0.12, -120); },
  bark() { tone(560, 0.07, 'square', 0.09, -250); setTimeout(() => tone(500, 0.08, 'square', 0.09, -250), 120); },
  yelp() { tone(900, 0.15, 'triangle', 0.09, 300); },
  eat() { noise(0.06, 0.3, 2500); setTimeout(() => noise(0.06, 0.3, 2100), 130); setTimeout(() => tone(660, 0.18, 'sine', 0.12, 260), 280); },
  growl() { tone(85, 0.5, 'sawtooth', 0.09, -25); },
  die() { tone(320, 0.35, 'triangle', 0.14, -230); },
  flee() { tone(700, 0.22, 'triangle', 0.08, 500); },
  level() { tone(523, 0.12, 'square', 0.08); setTimeout(() => tone(659, 0.12, 'square', 0.08), 120); setTimeout(() => tone(784, 0.2, 'square', 0.08), 240); },
};

// ---------- world (endless, generated in chunks) ----------
const CS = 480;
const chunks = new Map();
const fruitState = new Map();
let seed = 1;
const FRUITS = [
  { name: 'apple', c: '#e53935' }, { name: 'orange', c: '#fb8c00' },
  { name: 'pear', c: '#c0ca33' }, { name: 'plum', c: '#8e24aa' },
];
const FRUIT_MAX = 3, FRUIT_REGROW = 35, FRUIT_HEAL = 25;

function getChunk(cx, cy) {
  const k = cx + ',' + cy;
  let c = chunks.get(k);
  if (!c) { c = genChunk(cx, cy); chunks.set(k, c); }
  return c;
}
function genChunk(cx, cy) {
  const r = mulberry32(hash2(cx, cy, seed));
  const ox = cx * CS, oy = cy * CS;
  const trees = [], rocks = [], bushes = [], deco = [], patches = [];
  const nT = 4 + Math.floor(r() * 4);
  for (let i = 0; i < nT * 4 && trees.length < nT; i++) {
    const x = ox + 30 + r() * (CS - 60), y = oy + 30 + r() * (CS - 60);
    if (Math.hypot(x, y) < 150) continue;
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < 135)) continue;
    const fruit = r() < 0.36;
    const t = {
      id: cx + ',' + cy + ',' + i, x, y, r: 13, canopy: 40 + r() * 20, fruit,
      fc: fruit ? FRUITS[Math.floor(r() * FRUITS.length)] : null,
      pine: !fruit && r() < 0.35, shade: r(), fp: [],
    };
    for (let f = 0; f < FRUIT_MAX; f++) {
      const a = r() * TAU, d = t.canopy * (0.25 + r() * 0.45);
      t.fp.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8 });
    }
    if (fruit && !fruitState.has(t.id)) fruitState.set(t.id, { n: FRUIT_MAX, regrow: 0 });
    trees.push(t);
  }
  const nR = Math.floor(r() * 3);
  for (let i = 0; i < nR; i++) {
    const x = ox + r() * CS, y = oy + r() * CS, rr = 10 + r() * 10;
    if (Math.hypot(x, y) < 150 || trees.some(t => Math.hypot(t.x - x, t.y - y) < 60)) continue;
    rocks.push({ x, y, r: rr, s: r() });
  }
  const nB = 3 + Math.floor(r() * 4);
  for (let i = 0; i < nB; i++) {
    const x = ox + r() * CS, y = oy + r() * CS;
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < 50)) continue;
    bushes.push({ x, y, s: 14 + r() * 12, berries: r() < 0.3, k: r() });
  }
  for (let i = 0; i < 7; i++) patches.push({ x: ox + r() * CS, y: oy + r() * CS, rx: 40 + r() * 90, ry: 25 + r() * 50, c: r() < 0.5 ? 'rgba(255,255,200,0.05)' : 'rgba(0,40,0,0.08)' });
  const flowerCols = ['#fff59d', '#f8bbd0', '#ffffff', '#b39ddb', '#ffcc80'];
  for (let i = 0; i < 55; i++) {
    const k = r() < 0.78 ? 0 : 1;
    deco.push({ x: ox + r() * CS, y: oy + r() * CS, k, c: flowerCols[Math.floor(r() * flowerCols.length)], s: 0.7 + r() * 0.6 });
  }
  return { cx, cy, trees, rocks, bushes, deco, patches, solids: trees.concat(rocks) };
}
function forNearby(x, y, fn) {
  const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) fn(getChunk(cx + i, cy + j));
}
function collide(e) {
  forNearby(e.x, e.y, c => {
    for (const o of c.solids) {
      const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), m = o.r + e.r * 0.75;
      if (d < m && d > 0.001) { e.x = o.x + dx / d * m; e.y = o.y + dy / d * m; }
    }
  });
}
function blocked(x, y, rr) {
  let b = false;
  forNearby(x, y, c => { for (const o of c.solids) if (Math.hypot(x - o.x, y - o.y) < o.r + rr) b = true; });
  return b;
}

// ---------- animals ----------
const DEFS = {
  fox:     { name: 'Fox',      hp: 3,  spd: 125, dmg: 7,  r: 13, beh: 'flee',    fleeAt: 2, score: 10, len: 30, wid: 14, body: '#e8772e', belly: '#fff3e0', dark: '#4a230b' },
  wildcat: { name: 'Wild Cat', hp: 4,  spd: 140, dmg: 8,  r: 12, beh: 'retreat',            score: 15, len: 28, wid: 13, body: '#a1887f', belly: '#d7ccc8', dark: '#3e2723' },
  wolf:    { name: 'Wolf',     hp: 5,  spd: 128, dmg: 10, r: 15, beh: 'fight',              score: 20, len: 36, wid: 16, body: '#78909c', belly: '#cfd8dc', dark: '#263238' },
  boar:    { name: 'Boar',     hp: 6,  spd: 108, dmg: 12, r: 17, beh: 'retreat', charge: true, score: 25, len: 38, wid: 22, body: '#5d4037', belly: '#8d6e63', dark: '#21140f' },
  bear:    { name: 'Bear',     hp: 12, spd: 86,  dmg: 20, r: 24, beh: 'fight',              score: 50, len: 52, wid: 34, body: '#4e342e', belly: '#795548', dark: '#140b08' },
};
const POOL = [
  { k: 'fox', w: 3, lv: 1 }, { k: 'wildcat', w: 2, lv: 1 }, { k: 'wolf', w: 2, lv: 1 },
  { k: 'boar', w: 2, lv: 2 }, { k: 'bear', w: 1, lv: 3 },
];
const DOG_DEF = { len: 30, wid: 14, body: '#c68642', belly: '#f1d3a8', dark: '#6d3f16' };
const CALM_TIME = 10; // seconds of animal-free walking before the next encounter

function pickType() {
  const opts = POOL.filter(p => p.lv <= G.level);
  let tot = 0; for (const o of opts) tot += o.w;
  let x = Math.random() * tot;
  for (const o of opts) { x -= o.w; if (x <= 0) return o.k; }
  return opts[0].k;
}
function makeAnimal(k, x, y) {
  const d = DEFS[k], lvl = G.level - 1;
  const hp = Math.round(d.hp * (1 + lvl * 0.1));
  return {
    k, d, x, y, r: d.r, hp, max: hp, dmg: d.dmg * (1 + lvl * 0.06),
    face: Math.atan2(G.player.y - y, G.player.x - x), state: 'approach', t: 0,
    flash: 0, kx: 0, ky: 0, walk: Math.random() * 10, rage: 0, dead: 0, chargeCd: 1.5,
    hitDone: false, ldir: 0, next: 'approach', gone: false,
  };
}
function spawnWave() {
  const p = G.player;
  const two = Math.random() < Math.min(0.6, 0.3 + G.level * 0.05);
  const n = two ? 2 : 1;
  const vr = Math.hypot(W, H) / 2 / S + 40;
  const base = p.moving ? p.face : Math.random() * TAU;
  const names = [];
  for (let i = 0; i < n; i++) {
    const k = pickType();
    let ang = base + rand(-1, 1) + (i ? rand(0.9, 1.6) * (Math.random() < 0.5 ? -1 : 1) : 0);
    let x, y, tries = 0;
    do { x = p.x + Math.cos(ang) * vr; y = p.y + Math.sin(ang) * vr; ang += 0.35; tries++; }
    while (blocked(x, y, DEFS[k].r + 4) && tries < 15);
    G.animals.push(makeAnimal(k, x, y));
    names.push(DEFS[k].name);
  }
  const an = w => (/^[AEIOU]/.test(w) ? 'An ' : 'A ') + w;
  showMsg(n === 2 ? (names[0] === names[1] ? 'Two ' + names[0] + (names[0].endsWith('x') ? 'es' : 's') + ' appear!' : an(names[0]) + ' and ' + an(names[1]).toLowerCase() + ' appear!') : an(names[0]) + ' appears!', '#ffcdd2');
  G.dog.barkT = 1.3; SFX.growl(); setTimeout(SFX.bark, 250);
  addText(G.dog.x, G.dog.y - 26, 'Woof!', '#fff');
}

// ---------- game state ----------
let state = 'title';   // title | play | paused | over
let G = null;
let overT = 0;

function newGame() {
  seed = (Math.random() * 1e9) | 0;
  chunks.clear(); fruitState.clear();
  G = {
    t: 0,
    player: { x: 0, y: 0, r: 14, hp: 100, max: 100, face: -Math.PI / 2, cd: 0, swing: 0, swingDir: 0, inv: 0, eat: 0, eatTree: null, walk: 0, moving: false, kx: 0, ky: 0 },
    dog: { x: -40, y: 30, r: 11, hp: 60, max: 60, face: 0, down: 0, bite: 0, biteAnim: 0, walk: 0, barkT: 0, kx: 0, ky: 0, flash: 0 },
    animals: [], parts: [], texts: [],
    calm: 0, defeated: 0, scared: 0, enc: 0, score: 0, dist: 0, level: 1,
    shake: 0, msg: '', msgC: '#fff', msgT: 0, cam: { x: 0, y: 0 }, nearTree: null,
  };
}
function showMsg(m, c) { G.msg = m; G.msgC = c || '#fff'; G.msgT = 2.8; }
function addText(x, y, txt, c, big) { G.texts.push({ x, y, txt, c: c || '#fff', life: 1.1, max: 1.1, big: !!big }); }
function burst(x, y, c, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = rand(0.3, 1) * (spd || 140);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, c, s: rand(2, 4.5) });
  }
}
function totalScore() { return G.score + Math.floor(G.dist / 30); }
function checkLevel() {
  const lv = Math.min(10, 1 + Math.floor(G.enc / 5));
  if (lv > G.level) { G.level = lv; showMsg('Level ' + lv + ' - the forest gets wilder!', '#fff59d'); SFX.level(); }
}

// ---------- combat ----------
function alive(a) { return a.state !== 'dead' && a.state !== 'flee' && !a.gone; }

function hitAnimal(a, dmg, src) {
  if (!alive(a)) return false;
  const D = a.d;
  a.hp -= dmg; a.flash = 0.15;
  const ang = Math.atan2(a.y - src.y, a.x - src.x);
  const kb = (src === G.player ? 300 : 150) * (16 / a.r);
  a.kx = Math.cos(ang) * kb; a.ky = Math.sin(ang) * kb;
  burst(a.x, a.y, '#fff8e1', 6, 160); SFX.hit();
  if (a.hp <= 0) {
    a.state = 'dead'; a.dead = 0;
    G.defeated++; G.enc++; G.score += D.score;
    addText(a.x, a.y - 30, D.name + ' defeated!', '#c8e6c9');
    SFX.die(); burst(a.x, a.y, D.body, 14, 200); checkLevel();
    return true;
  }
  if (D.beh === 'flee' && a.hp <= D.fleeAt) {
    a.state = 'flee'; G.scared++; G.enc++; G.score += Math.floor(D.score / 2);
    addText(a.x, a.y - 30, 'Runs away!', '#fff59d'); SFX.flee(); checkLevel();
  } else if (D.beh === 'retreat') {
    a.state = 'retreat'; a.t = rand(0.7, 1.1);
    addText(a.x, a.y - 30, 'Backs off...', '#ffe0b2');
  } else {
    a.state = 'stagger'; a.t = 0.15; a.next = 'approach';
  }
  return true;
}

function hurt(tg, dmg, a) {
  const p = G.player, dog = G.dog;
  if (tg === p) {
    if (p.inv > 0 || state !== 'play') return;
    p.hp -= dmg; p.inv = 0.7; p.eat = 0; G.shake = 0.3;
    const ang = Math.atan2(p.y - a.y, p.x - a.x);
    p.kx = Math.cos(ang) * 260; p.ky = Math.sin(ang) * 260;
    addText(p.x, p.y - 30, '-' + Math.round(dmg), '#ff5252', true);
    burst(p.x, p.y, '#e53935', 8, 140); SFX.hurt();
    if (p.hp <= 0) { p.hp = 0; gameOver(); }
  } else {
    if (dog.down > 0) return;
    dog.hp -= dmg * 0.8; dog.flash = 0.15;
    const ang = Math.atan2(dog.y - a.y, dog.x - a.x);
    dog.kx = Math.cos(ang) * 220; dog.ky = Math.sin(ang) * 220;
    addText(dog.x, dog.y - 24, '-' + Math.round(dmg * 0.8), '#ffab91');
    SFX.yelp();
    if (dog.hp <= 0) {
      dog.hp = 0; dog.down = 12;
      showMsg('Buddy is hurt and needs a rest...', '#ffccbc');
    }
  }
}

function attack() {
  const p = G.player;
  p.cd = 0.4; p.swing = 0.22;
  let bestA = null, bd = 135;
  for (const a of G.animals) { if (!alive(a)) continue; const d = dist(a, p); if (d < bd) { bd = d; bestA = a; } }
  if (bestA) p.face = Math.atan2(bestA.y - p.y, bestA.x - p.x);
  p.swingDir = p.face;
  SFX.swing();
  let any = false;
  for (const a of G.animals) {
    if (!alive(a)) continue;
    const d = dist(a, p), ang = Math.atan2(a.y - p.y, a.x - p.x);
    if (d < 64 + a.r && Math.abs(angDiff(p.face, ang)) < 1.3) { hitAnimal(a, 1, p); any = true; }
  }
  if (any) G.shake = Math.max(G.shake, 0.12);
}

function startEat() {
  const p = G.player, t = G.nearTree;
  if (!t || p.eat > 0) return;
  const st = fruitState.get(t.id);
  if (!st || st.n <= 0) return;
  p.eat = 0.8; p.eatTree = t;
}
function finishEat() {
  const p = G.player, t = p.eatTree; p.eatTree = null;
  if (!t) return;
  const st = fruitState.get(t.id);
  if (!st || st.n <= 0) return;
  st.n--; if (!st.regrow) st.regrow = G.t + FRUIT_REGROW;
  const heal = Math.min(FRUIT_HEAL, p.max - p.hp);
  p.hp = Math.min(p.max, p.hp + FRUIT_HEAL);
  addText(p.x, p.y - 32, '+' + Math.round(heal) + ' ' + t.fc.name, '#b9f6ca', true);
  burst(p.x, p.y - 10, t.fc.c, 10, 110); SFX.eat();
  const dog = G.dog;
  if (dog.down <= 0 && dist(dog, p) < 120 && dog.hp < dog.max) {
    dog.hp = Math.min(dog.max, dog.hp + 15); addText(dog.x, dog.y - 22, '+15', '#b9f6ca');
  }
}

function gameOver() {
  state = 'over'; overT = 0;
  const sc = totalScore();
  if (sc > best) { best = sc; saveBest(); G.newBest = true; }
  SFX.die();
}

// ---------- input ----------
const keys = {};
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
let attackHeld = false, attackPointer = null;

function layout() {
  const R = clamp(Math.min(W, H) * 0.12, 40, 72);
  return {
    R,
    atk: { x: W - R * 1.5 - 12, y: H - R * 1.5 - 12, r: R },
    eat: { x: W - R * 3.9 - 12, y: H - R * 1.1 - 12, r: R * 0.78 },
    pause: { x: W - 34, y: 34, r: 22 },
    joyHome: { x: R * 1.9 + 10, y: H - R * 1.9 - 10 },
  };
}
const inCircle = (x, y, c, extra) => Math.hypot(x - c.x, y - c.y) < c.r + (extra || 0);

cv.addEventListener('pointerdown', e => {
  e.preventDefault(); audioInit();
  const x = e.clientX, y = e.clientY, L = layout();
  if (state === 'title') { newGame(); state = 'play'; return; }
  if (state === 'over') { if (overT > 1) { newGame(); state = 'play'; } return; }
  if (state === 'paused') { state = 'play'; return; }
  if (inCircle(x, y, L.pause, 10)) { state = 'paused'; return; }
  if (inCircle(x, y, L.atk, 16)) { attackHeld = true; attackPointer = e.pointerId; return; }
  if (G.nearTree && inCircle(x, y, L.eat, 10)) { startEat(); return; }
  if (x < W * 0.55 && joy.id === null) {
    joy.id = e.pointerId; joy.ox = x; joy.oy = y; joy.x = x; joy.y = y; joy.active = true;
  } else if (x >= W * 0.55) { attackHeld = true; attackPointer = e.pointerId; }
}, { passive: false });
cv.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; }
}, { passive: true });
function endPointer(e) {
  if (e.pointerId === joy.id) { joy.id = null; joy.active = false; }
  if (e.pointerId === attackPointer) { attackHeld = false; attackPointer = null; }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  keys[e.code] = true; audioInit();
  if (state === 'title' && (e.code === 'Space' || e.code === 'Enter')) { newGame(); state = 'play'; return; }
  if (state === 'over' && overT > 1 && (e.code === 'Space' || e.code === 'Enter')) { newGame(); state = 'play'; return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; }
  if (state === 'play' && e.code === 'KeyE') startEat();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') state = 'paused'; });
// Called by the Android app
window.pauseGame = () => { if (state === 'play') state = 'paused'; };
window.handleBack = () => {
  if (state === 'play') { state = 'paused'; return true; }
  if (state === 'paused' || state === 'over') { state = 'title'; return true; }
  return false; // on title: let the app close
};

function getInput() {
  let x = 0, y = 0;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1;
  if (keys.KeyS || keys.ArrowDown) y += 1;
  if (joy.active) {
    const maxR = layout().R;
    let dx = joy.x - joy.ox, dy = joy.y - joy.oy; const d = Math.hypot(dx, dy);
    if (d > maxR) { joy.ox = joy.x - dx / d * maxR; joy.oy = joy.y - dy / d * maxR; dx = joy.x - joy.ox; dy = joy.y - joy.oy; }
    x += dx / maxR; y += dy / maxR;
  }
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y, m: Math.min(1, m) };
}

// ---------- update ----------
function update(dt) {
  if (state === 'over') { overT += dt; }
  if (state !== 'play') { if (G) updateFx(dt); return; }
  G.t += dt;
  updPlayer(dt);
  updDog(dt);
  for (const a of G.animals) updAnimal(a, dt);
  // keep animals apart from each other and from the player
  const p = G.player;
  for (let i = 0; i < G.animals.length; i++) {
    const a = G.animals[i]; if (a.state === 'dead') continue;
    for (let j = i + 1; j < G.animals.length; j++) {
      const b = G.animals[j]; if (b.state === 'dead') continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d < m && d > 0.01) { const push = (m - d) / 2; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; }
    }
    const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy), m = a.r + p.r - 2;
    if (d < m && d > 0.01) { a.x = p.x + dx / d * m; a.y = p.y + dy / d * m; }
  }
  G.animals = G.animals.filter(a => !a.gone && !(a.state === 'dead' && a.dead > 0.9));

  // encounter timer: counts while walking with no animals around
  const threats = G.animals.some(alive);
  if (!threats) {
    if (p.moving) G.calm += dt;
    if (G.calm >= CALM_TIME) { G.calm = 0; spawnWave(); }
  } else G.calm = 0;

  // fruit regrowth
  if (Math.floor(G.t * 2) !== Math.floor((G.t - dt) * 2)) {
    for (const st of fruitState.values()) {
      if (st.n < FRUIT_MAX && st.regrow && G.t >= st.regrow) { st.n++; st.regrow = st.n < FRUIT_MAX ? G.t + FRUIT_REGROW : 0; }
    }
  }
  // free memory from far away chunks (fruit state is kept separately)
  if (chunks.size > 80) {
    const pcx = Math.floor(p.x / CS), pcy = Math.floor(p.y / CS);
    for (const [k, c] of chunks) if (Math.abs(c.cx - pcx) > 4 || Math.abs(c.cy - pcy) > 4) chunks.delete(k);
  }
  updateFx(dt);
}

function updateFx(dt) {
  for (const q of G.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9; q.life -= dt; }
  G.parts = G.parts.filter(q => q.life > 0);
  for (const t of G.texts) { t.y -= 28 * dt; t.life -= dt; }
  G.texts = G.texts.filter(t => t.life > 0);
  G.msgT = Math.max(0, G.msgT - dt);
  G.shake = Math.max(0, G.shake - dt);
  const p = G.player, k = 1 - Math.exp(-6 * dt);
  G.cam.x += (p.x - G.cam.x) * k; G.cam.y += (p.y - G.cam.y) * k;
}

function updPlayer(dt) {
  const p = G.player;
  p.inv -= dt; p.cd -= dt; p.swing = Math.max(0, p.swing - dt);
  p.x += p.kx * dt; p.y += p.ky * dt; const kd = Math.exp(-10 * dt); p.kx *= kd; p.ky *= kd;
  const inp = getInput();
  p.moving = false;
  if (p.eat > 0) {
    p.eat -= dt; if (p.eat <= 0) { p.eat = 0; finishEat(); }
  } else if (inp.m > 0.12) {
    const spd = 145 * inp.m;
    const ox = p.x, oy = p.y;
    p.x += inp.x * spd * dt; p.y += inp.y * spd * dt;
    collide(p);
    G.dist += Math.hypot(p.x - ox, p.y - oy);
    if (p.swing <= 0) p.face = Math.atan2(inp.y, inp.x);
    p.walk += dt * spd / 14;
    p.moving = true;
  }
  collide(p);
  if ((attackHeld || keys.Space || keys.KeyJ) && p.cd <= 0 && p.eat <= 0) attack();

  // nearest fruit tree with fruit
  G.nearTree = null; let bd = 80;
  forNearby(p.x, p.y, c => {
    for (const t of c.trees) {
      if (!t.fruit) continue;
      const st = fruitState.get(t.id); if (!st || st.n <= 0) continue;
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bd) { bd = d; G.nearTree = t; }
    }
  });
}

function updDog(dt) {
  const dog = G.dog, p = G.player;
  dog.flash = Math.max(0, dog.flash - dt); dog.biteAnim = Math.max(0, dog.biteAnim - dt); dog.barkT -= dt;
  dog.x += dog.kx * dt; dog.y += dog.ky * dt; const kd = Math.exp(-10 * dt); dog.kx *= kd; dog.ky *= kd;
  if (dog.down > 0) {
    dog.down -= dt;
    if (dog.down <= 0) { dog.down = 0; dog.hp = dog.max * 0.5; addText(dog.x, dog.y - 24, 'Woof! Back to help!', '#fff'); SFX.bark(); }
    collide(dog);
    return;
  }
  dog.bite -= dt;
  let tgt = null, bd = 300;
  for (const a of G.animals) { if (!alive(a)) continue; const d = dist(a, p); if (d < bd) { bd = d; tgt = a; } }
  let mvx = 0, mvy = 0;
  if (tgt) {
    const dx = tgt.x - dog.x, dy = tgt.y - dog.y, d = Math.hypot(dx, dy) || 1;
    dog.face = turnTo(dog.face, Math.atan2(dy, dx), 10 * dt);
    if (d > dog.r + tgt.r + 6) { mvx = dx / d * 175; mvy = dy / d * 175; }
    else if (dog.bite <= 0) {
      dog.bite = 1.1; dog.biteAnim = 0.2;
      hitAnimal(tgt, 1, dog);
      if (Math.random() < 0.4) SFX.bark();
    }
  } else {
    const fx = p.x - Math.cos(p.face) * 44 + Math.cos(p.face + Math.PI / 2) * 24;
    const fy = p.y - Math.sin(p.face) * 44 + Math.sin(p.face + Math.PI / 2) * 24;
    const dx = fx - dog.x, dy = fy - dog.y, d = Math.hypot(dx, dy);
    if (d > 16) {
      const spd = Math.min(200, d * 3.2);
      mvx = dx / d * spd; mvy = dy / d * spd;
      dog.face = turnTo(dog.face, Math.atan2(dy, dx), 8 * dt);
    } else {
      dog.face = turnTo(dog.face, Math.atan2(p.y - dog.y, p.x - dog.x), 3 * dt);
    }
    if (dog.hp < dog.max) dog.hp = Math.min(dog.max, dog.hp + 1.5 * dt);
  }
  dog.x += mvx * dt; dog.y += mvy * dt;
  if (mvx || mvy) dog.walk += dt * Math.hypot(mvx, mvy) / 12;
  collide(dog);
  if (dist(dog, p) > 650) { dog.x = p.x - 30; dog.y = p.y + 30; }
}

function updAnimal(a, dt) {
  const p = G.player, dog = G.dog, D = a.d;
  a.flash = Math.max(0, a.flash - dt); a.rage = Math.max(0, a.rage - dt); a.t -= dt; a.chargeCd -= dt;
  a.x += a.kx * dt; a.y += a.ky * dt; const kd = Math.exp(-9 * dt); a.kx *= kd; a.ky *= kd;
  if (a.state === 'dead') { a.dead += dt; return; }

  // target: usually you, but they go for Buddy if he is much closer
  let tg = p;
  if (dog.down <= 0 && dist(a, dog) < dist(a, p) * 0.45) tg = dog;
  const dx = tg.x - a.x, dy = tg.y - a.y, d = Math.hypot(dx, dy) || 1;
  const toT = Math.atan2(dy, dx);
  const reach = a.r + tg.r + 10;
  const spd = D.spd * (a.rage > 0 ? 1.35 : 1);
  const lvlFast = Math.min(0.12, (G.level - 1) * 0.015);
  let mvx = 0, mvy = 0;

  switch (a.state) {
    case 'approach':
      a.face = turnTo(a.face, toT, 8 * dt);
      if (D.charge && a.chargeCd <= 0 && d > 110 && d < 260) { a.state = 'chargeWind'; a.t = 0.65; break; }
      if (d < reach) { a.state = 'windup'; a.t = 0.38 - lvlFast; }
      else { mvx = dx / d * spd; mvy = dy / d * spd; }
      break;
    case 'windup':
      a.face = turnTo(a.face, toT, 6 * dt);
      if (a.t <= 0) { a.state = 'lunge'; a.t = 0.16; a.hitDone = false; a.ldir = a.face; }
      break;
    case 'lunge':
      mvx = Math.cos(a.ldir) * spd * 2.4; mvy = Math.sin(a.ldir) * spd * 2.4;
      if (!a.hitDone && d < reach + 4) { a.hitDone = true; hurt(tg, a.dmg, a); }
      if (a.t <= 0) { a.state = 'recover'; a.t = rand(0.45, 0.8); }
      break;
    case 'recover':
      mvx = -Math.cos(a.face) * spd * 0.25; mvy = -Math.sin(a.face) * spd * 0.25;
      if (a.t <= 0) a.state = 'approach';
      break;
    case 'chargeWind':
      a.face = turnTo(a.face, toT, 5 * dt);
      if (a.t <= 0) { a.state = 'charge'; a.t = 0.75; a.hitDone = false; a.ldir = a.face; SFX.growl(); }
      break;
    case 'charge':
      mvx = Math.cos(a.ldir) * spd * 3; mvy = Math.sin(a.ldir) * spd * 3;
      if (!a.hitDone && d < reach + 6) { a.hitDone = true; hurt(tg, a.dmg * 1.3, a); a.t = Math.min(a.t, 0.1); }
      if (a.t <= 0) { a.state = 'recover'; a.t = 0.8; a.chargeCd = rand(3, 5); }
      break;
    case 'retreat': {
      const ax = a.x - p.x, ay = a.y - p.y, ad = Math.hypot(ax, ay) || 1;
      mvx = ax / ad * spd * 0.95; mvy = ay / ad * spd * 0.95;
      a.face = turnTo(a.face, Math.atan2(ay, ax), 10 * dt);
      if (a.t <= 0) { a.state = 'approach'; a.rage = 1.6; addText(a.x, a.y - 30, 'Grrr!', '#ff8a80'); SFX.growl(); }
      break;
    }
    case 'flee': {
      const ax = a.x - p.x, ay = a.y - p.y, ad = Math.hypot(ax, ay) || 1;
      mvx = ax / ad * spd * 1.6; mvy = ay / ad * spd * 1.6;
      a.face = turnTo(a.face, Math.atan2(ay, ax), 10 * dt);
      if (ad > 900) a.gone = true;
      break;
    }
    case 'stagger':
      if (a.t <= 0) a.state = a.next || 'approach';
      break;
  }
  a.x += mvx * dt; a.y += mvy * dt;
  if (mvx || mvy) a.walk += dt * Math.hypot(mvx, mvy) / 14;
  collide(a);
}

// ---------- drawing ----------
function drawGround(x0, y0, x1, y1) {
  ctx.fillStyle = '#4c7f35';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const cx0 = Math.floor(x0 / CS), cx1 = Math.floor(x1 / CS), cy0 = Math.floor(y0 / CS), cy1 = Math.floor(y1 / CS);
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const c = getChunk(cx, cy);
    for (const q of c.patches) ellipse(q.x, q.y, q.rx, q.ry, q.c);
  }
  ctx.lineCap = 'round';
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const c = getChunk(cx, cy);
    for (const q of c.deco) {
      if (q.x < x0 - 10 || q.x > x1 + 10 || q.y < y0 - 10 || q.y > y1 + 10) continue;
      if (q.k === 0) {
        ctx.strokeStyle = '#3d6b2a'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(q.x - 3 * q.s, q.y); ctx.lineTo(q.x - 5 * q.s, q.y - 6 * q.s);
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 8 * q.s);
        ctx.moveTo(q.x + 3 * q.s, q.y); ctx.lineTo(q.x + 5 * q.s, q.y - 6 * q.s);
        ctx.stroke();
      } else {
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; circle(q.x + Math.cos(a) * 2.6, q.y + Math.sin(a) * 2.6, 2, q.c); }
        circle(q.x, q.y, 1.6, '#fbc02d');
      }
    }
  }
}

function drawTree(t) {
  const p = G.player;
  ellipse(t.x + 12, t.y + 4, t.canopy * 0.95, t.canopy * 0.42, 'rgba(0,0,0,0.22)');
  // trunk
  ctx.fillStyle = '#5d4037'; roundRect(t.x - 8, t.y - 34, 16, 38, 5); ctx.fill();
  ctx.fillStyle = '#4e342e'; ctx.fillRect(t.x - 2, t.y - 30, 3, 28);
  const cy = t.y - 34 - t.canopy * 0.55, cr = t.canopy;
  const hidden = e => Math.hypot(e.x - t.x, e.y - cy) < cr * 1.05 && e.y < t.y + 6;
  const under = hidden(p) || (G.dog && hidden(G.dog)) || G.animals.some(a => a.state !== 'dead' && hidden(a));
  ctx.save();
  if (under) ctx.globalAlpha = 0.5;
  const g = t.shade;
  if (t.pine) {
    const cols = ['#1f4d2b', '#28603a', '#317348'];
    for (let i = 0; i < 3; i++) {
      const w = cr * (1.05 - i * 0.25), top = t.y - 30 - cr * (0.9 + i * 0.55), base = t.y - 22 - i * cr * 0.5;
      ctx.beginPath(); ctx.moveTo(t.x, top - cr * 0.4); ctx.lineTo(t.x + w, base); ctx.lineTo(t.x - w, base); ctx.closePath();
      ctx.fillStyle = cols[i]; ctx.fill();
    }
  } else {
    const dark = g < 0.5 ? '#2e6b2f' : '#2b6332', mid = g < 0.5 ? '#3c8a3b' : '#3a7f3f', light = g < 0.5 ? '#55a84e' : '#4f9b55';
    circle(t.x, cy + cr * 0.1, cr, dark);
    circle(t.x - cr * 0.45, cy - cr * 0.05, cr * 0.62, mid);
    circle(t.x + cr * 0.45, cy + cr * 0.05, cr * 0.6, mid);
    circle(t.x - cr * 0.1, cy - cr * 0.35, cr * 0.6, mid);
    circle(t.x - cr * 0.25, cy - cr * 0.45, cr * 0.3, light);
    if (t.fruit) {
      const st = fruitState.get(t.id), n = st ? st.n : 0;
      for (let i = 0; i < n; i++) {
        const f = t.fp[i];
        circle(t.x + f.x, cy + f.y, 6, t.fc.c);
        circle(t.x + f.x - 2, cy + f.y - 2, 2, 'rgba(255,255,255,0.6)');
        ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(t.x + f.x, cy + f.y - 5); ctx.lineTo(t.x + f.x + 1, cy + f.y - 9); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawRock(o) {
  ellipse(o.x + 4, o.y + 4, o.r * 1.1, o.r * 0.6, 'rgba(0,0,0,0.25)');
  ellipse(o.x, o.y - o.r * 0.2, o.r * 1.1, o.r * 0.8, '#8d8d8d');
  ellipse(o.x - o.r * 0.25, o.y - o.r * 0.45, o.r * 0.5, o.r * 0.3, '#b0b0b0');
}
function drawBush(b) {
  ellipse(b.x + 3, b.y + 3, b.s, b.s * 0.45, 'rgba(0,0,0,0.2)');
  const c1 = b.k < 0.5 ? '#2f6e2c' : '#356f33', c2 = b.k < 0.5 ? '#43913d' : '#4a8f44';
  circle(b.x - b.s * 0.45, b.y - b.s * 0.3, b.s * 0.55, c1);
  circle(b.x + b.s * 0.45, b.y - b.s * 0.3, b.s * 0.55, c1);
  circle(b.x, b.y - b.s * 0.55, b.s * 0.65, c2);
  if (b.berries) for (let i = 0; i < 4; i++) circle(b.x - b.s * 0.5 + i * b.s * 0.33, b.y - b.s * (0.3 + (i % 2) * 0.35), 2.2, '#3949ab');
}

function drawBeast(e, D, kind, flash, alpha) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalAlpha = alpha;
  const L = D.len, Wd = D.wid;
  ellipse(2, 5, L * 0.6, Wd * 0.6, 'rgba(0,0,0,0.25)');
  ctx.rotate(e.face);
  const body = flash ? '#ffffff' : D.body, dark = flash ? '#eeeeee' : D.dark, belly = flash ? '#ffffff' : D.belly;
  const ph = Math.sin(e.walk), legOff = L * 0.09;
  // legs
  const legR = Math.max(3, Wd * 0.2);
  ellipse(L * 0.28 + ph * legOff, -Wd * 0.45, legR * 1.2, legR, dark);
  ellipse(L * 0.28 - ph * legOff, Wd * 0.45, legR * 1.2, legR, dark);
  ellipse(-L * 0.28 - ph * legOff, -Wd * 0.45, legR * 1.2, legR, dark);
  ellipse(-L * 0.28 + ph * legOff, Wd * 0.45, legR * 1.2, legR, dark);
  // tail
  const wag = Math.sin(G.t * (kind === 'dog' ? 16 : 6) + e.walk) * 0.35;
  ctx.save(); ctx.translate(-L * 0.45, 0); ctx.rotate(Math.PI + wag);
  if (kind === 'fox') { ellipse(L * 0.3, 0, L * 0.32, Wd * 0.28, body); ellipse(L * 0.55, 0, L * 0.1, Wd * 0.18, '#fff'); }
  else if (kind === 'wolf') ellipse(L * 0.25, 0, L * 0.28, Wd * 0.22, body);
  else if (kind === 'wildcat') { ctx.strokeStyle = body; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.25, 6, L * 0.45, 0); ctx.stroke(); }
  else if (kind === 'dog') { ctx.strokeStyle = body; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.2, -6, L * 0.32, -2); ctx.stroke(); }
  else if (kind === 'boar') { ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.18, 3); ctx.stroke(); }
  else circle(L * 0.05, 0, Wd * 0.15, body);
  ctx.restore();
  // body
  ellipse(0, 0, L * 0.5, Wd * 0.5, body);
  ellipse(-L * 0.05, 0, L * 0.35, Wd * 0.18, kind === 'boar' ? dark : 'rgba(0,0,0,0.12)');
  if (kind === 'wildcat') { ctx.strokeStyle = dark; ctx.lineWidth = 2; for (let i = -2; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * L * 0.12, -Wd * 0.4); ctx.lineTo(i * L * 0.12 + 2, Wd * 0.4); ctx.stroke(); } }
  if (kind === 'dog') { ctx.fillStyle = '#d32f2f'; ctx.fillRect(L * 0.3, -Wd * 0.38, 3, Wd * 0.76); }
  // head
  const hx = L * 0.46, hr = Wd * (kind === 'bear' ? 0.45 : 0.42);
  // ears
  if (kind === 'fox' || kind === 'wolf' || kind === 'wildcat') {
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(hx - hr * 0.2, s * hr * 0.4); ctx.lineTo(hx - hr * 1.0, s * hr * 1.05); ctx.lineTo(hx + hr * 0.25, s * hr * 0.95); ctx.closePath();
      ctx.fillStyle = dark; ctx.fill();
    }
  } else if (kind === 'dog') {
    for (const s of [-1, 1]) ellipse(hx - hr * 0.25, s * hr * 0.95, hr * 0.55, hr * 0.32, dark);
  } else {
    for (const s of [-1, 1]) circle(hx - hr * 0.35, s * hr * 0.8, hr * 0.35, dark);
  }
  circle(hx, 0, hr, body);
  // snout
  const sl = kind === 'wildcat' ? 0.45 : kind === 'bear' ? 0.6 : 0.8;
  ellipse(hx + hr * 0.75, 0, hr * sl, hr * 0.5, kind === 'wolf' || kind === 'fox' || kind === 'dog' ? belly : body);
  circle(hx + hr * (0.75 + sl * 0.9), 0, Math.max(2, hr * 0.2), '#111');
  if (kind === 'boar') {
    ctx.strokeStyle = '#fffde7'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + hr * 0.9, s * hr * 0.4); ctx.quadraticCurveTo(hx + hr * 1.3, s * hr * 0.9, hx + hr * 1.1, s * hr * 1.05); ctx.stroke(); }
  }
  // eyes
  for (const s of [-1, 1]) {
    circle(hx + hr * 0.35, s * hr * 0.42, Math.max(1.6, hr * 0.16), kind === 'dog' ? '#2b1a0f' : '#111');
    circle(hx + hr * 0.4, s * hr * 0.42 - 0.6, 0.8, '#fff');
  }
  ctx.restore();
}

function drawAnimal(a) {
  const alpha = a.state === 'dead' ? Math.max(0, 1 - a.dead / 0.9) : 1;
  let ox = 0;
  if (a.state === 'windup' || a.state === 'chargeWind') ox = Math.sin(G.t * 60) * 1.5;
  a.x += ox;
  drawBeast(a, a.d, a.k, a.flash > 0, alpha);
  a.x -= ox;
  if (a.state === 'dead') return;
  const top = a.y - a.d.wid * 0.5 - 18;
  if (a.hp < a.max && a.state !== 'flee') {
    const w = Math.max(26, a.r * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(a.x - w / 2 - 1, top - 1, w + 2, 6);
    ctx.fillStyle = '#ef5350'; ctx.fillRect(a.x - w / 2, top, w * Math.max(0, a.hp / a.max), 4);
  }
  if (a.state === 'windup' || a.state === 'chargeWind') {
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText('!', a.x + 1, top - 5);
    ctx.fillStyle = '#ff1744'; ctx.fillText('!', a.x, top - 6);
  }
}

function drawDog() {
  const dog = G.dog;
  if (dog.down > 0) {
    ctx.save(); ctx.globalAlpha = 0.85;
    const f = dog.face; dog.face = Math.PI * 0.1;
    const w = dog.walk; dog.walk = 0;
    drawBeast(dog, DOG_DEF, 'dog', false, 0.75);
    dog.face = f; dog.walk = w;
    ctx.restore();
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e3f2fd';
    ctx.fillText('z z z  ' + Math.ceil(dog.down) + 's', dog.x, dog.y - 20 - Math.sin(G.t * 3) * 3);
    return;
  }
  let ox = 0, oy = 0;
  if (dog.biteAnim > 0) { ox = Math.cos(dog.face) * 6; oy = Math.sin(dog.face) * 6; }
  dog.x += ox; dog.y += oy;
  drawBeast(dog, DOG_DEF, 'dog', dog.flash > 0, 1);
  dog.x -= ox; dog.y -= oy;
}

function drawPlayer() {
  const p = G.player;
  ctx.save();
  if (p.inv > 0 && Math.floor(G.t * 18) % 2 === 0) ctx.globalAlpha = 0.45;
  ctx.translate(p.x, p.y);
  ellipse(2, 6, 16, 9, 'rgba(0,0,0,0.28)');
  // swing trail
  if (p.swing > 0) {
    const k = p.swing / 0.22;
    ctx.save(); ctx.rotate(p.swingDir);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * k) + ')'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(0, 0, 54, -1.2, 1.2); ctx.stroke();
    ctx.restore();
  }
  ctx.rotate(p.face);
  // feet
  const ph = p.moving ? Math.sin(p.walk) * 6 : 0;
  ellipse(ph, -6, 6, 4, '#3e2723');
  ellipse(-ph, 6, 6, 4, '#3e2723');
  // backpack
  ctx.fillStyle = '#795548'; roundRect(-16, -8, 8, 16, 3); ctx.fill();
  // body
  ellipse(0, 0, 10, 15, '#1e88e5');
  // stick: rests forward; swings from right to left
  let sa = 0.55;
  if (p.swing > 0) { const k = 1 - p.swing / 0.22; sa = 1.35 - k * 2.7; }
  ctx.save(); ctx.translate(5, 12); ctx.rotate(sa - 0.3);
  ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(46, 0); ctx.stroke();
  ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(4, -1); ctx.lineTo(42, -1); ctx.stroke();
  circle(30, 2, 2.2, '#5d4037');
  ctx.restore();
  // arms
  circle(5, -13, 4.5, '#f2c094');
  circle(5, 12, 4.5, '#f2c094');
  // head + hat
  circle(1, 0, 9, '#f2c094');
  circle(0, 0, 11, '#8d6e3f');
  circle(-1, 0, 7.5, '#a1824a');
  ctx.fillStyle = '#5d4037'; ctx.fillRect(-1, -7.5, 2.5, 15);
  // eating: fruit in hand
  if (p.eat > 0 && p.eatTree) circle(12, 0, 6, p.eatTree.fc.c);
  ctx.restore();
  if (p.eat > 0) {
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText('nom nom', p.x, p.y - 26 - Math.sin(G.t * 12) * 2);
  }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!G) newGame();
  const sh = G.shake > 0 ? G.shake * 22 : 0;
  const sx = rand(-sh, sh), sy = rand(-sh, sh);
  const cam = G.cam;
  ctx.save();
  ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(S, S); ctx.translate(-cam.x, -cam.y);
  const hw = W / 2 / S, hh = H / 2 / S;
  const x0 = cam.x - hw - 40, x1 = cam.x + hw + 40, y0 = cam.y - hh - 40, y1 = cam.y + hh + 40;
  drawGround(x0, y0, x1, y1);

  // y-sorted objects
  const list = [];
  const cx0 = Math.floor((x0 - 80) / CS), cx1 = Math.floor((x1 + 80) / CS), cy0 = Math.floor((y0 - 20) / CS), cy1 = Math.floor((y1 + 160) / CS);
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const c = getChunk(cx, cy);
    for (const t of c.trees) if (t.x > x0 - 80 && t.x < x1 + 80 && t.y > y0 - 20 && t.y < y1 + 160) list.push({ y: t.y, f: drawTree, o: t });
    for (const o of c.rocks) if (o.x > x0 - 30 && o.x < x1 + 30 && o.y > y0 - 30 && o.y < y1 + 30) list.push({ y: o.y, f: drawRock, o });
    for (const b of c.bushes) if (b.x > x0 - 30 && b.x < x1 + 30 && b.y > y0 - 30 && b.y < y1 + 30) list.push({ y: b.y, f: drawBush, o: b });
  }
  for (const a of G.animals) list.push({ y: a.y, f: drawAnimal, o: a });
  list.push({ y: G.dog.y, f: drawDog, o: null });
  list.push({ y: G.player.y, f: drawPlayer, o: null });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) it.f(it.o);

  // particles + floating texts
  for (const q of G.parts) { ctx.globalAlpha = clamp(q.life / q.max * 1.5, 0, 1); circle(q.x, q.y, q.s, q.c); }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    ctx.globalAlpha = clamp(t.life / t.max * 2, 0, 1);
    ctx.font = 'bold ' + (t.big ? 18 : 14) + 'px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(t.txt, t.x + 1, t.y + 1);
    ctx.fillStyle = t.c; ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (state === 'play' || state === 'paused') { drawIndicators(); drawHUD(); drawControls(); }
  if (state === 'title') drawTitle();
  if (state === 'paused') drawPaused();
  if (state === 'over') drawOver();
}

function drawIndicators() {
  for (const a of G.animals) {
    if (!alive(a)) continue;
    const sx = (a.x - G.cam.x) * S + W / 2, sy = (a.y - G.cam.y) * S + H / 2;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const m = 34, ex = clamp(sx, m, W - m), ey = clamp(sy, m + 50, H - m);
    const ang = Math.atan2(sy - ey, sx - ex);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.globalAlpha = 0.6 + Math.sin(G.t * 10) * 0.3;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath();
    ctx.fillStyle = '#ff1744'; ctx.fill();
    ctx.restore();
  }
}

function bar(x, y, w, h, frac, col, label) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(x - 2, y - 2, w + 4, h + 4, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(x, y, w, h, 4); ctx.fill();
  if (frac > 0) { ctx.fillStyle = col; roundRect(x, y, Math.max(8, w * clamp(frac, 0, 1)), h, 4); ctx.fill(); }
  ctx.font = 'bold ' + Math.round(h * 0.72) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawHUD() {
  const p = G.player, dog = G.dog;
  const bw = clamp(W * 0.26, 140, 240);
  const hf = p.hp / p.max;
  ctx.font = '20px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('❤️', 12, 24);
  bar(42, 13, bw, 22, hf, hf > 0.5 ? '#43a047' : hf > 0.25 ? '#fb8c00' : '#e53935', 'You ' + Math.ceil(p.hp) + ' / ' + p.max);
  ctx.font = '18px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('🐕', 12, 56);
  bar(42, 47, bw * 0.75, 16, dog.down > 0 ? 0 : dog.hp / dog.max, '#ffb74d', dog.down > 0 ? 'Buddy resting ' + Math.ceil(dog.down) + 's' : 'Buddy ' + Math.ceil(dog.hp));
  ctx.textBaseline = 'alphabetic';
  if (hf < 0.35 && Math.floor(G.t * 3) % 2 === 0) {
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffcdd2';
    ctx.fillText('Low health - find a fruit tree!', 14, 86);
  }
  // stats
  ctx.textAlign = 'right'; ctx.font = 'bold 15px sans-serif';
  const lines = ['Level ' + G.level, 'Score ' + totalScore(), Math.floor(G.dist / 30) + ' m  •  ' + G.defeated + ' beaten'];
  lines.forEach((l, i) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(l, W - 70 + 1, 24 + i * 19 + 1);
    ctx.fillStyle = '#fff'; ctx.fillText(l, W - 70, 24 + i * 19);
  });
  // pause button
  const L = layout();
  circle(L.pause.x, L.pause.y, L.pause.r, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = '#fff'; ctx.fillRect(L.pause.x - 7, L.pause.y - 8, 5, 16); ctx.fillRect(L.pause.x + 2, L.pause.y - 8, 5, 16);
  // message banner
  if (G.msgT > 0) {
    ctx.globalAlpha = clamp(G.msgT, 0, 1);
    ctx.font = 'bold ' + Math.round(clamp(W * 0.03, 16, 24)) + 'px sans-serif'; ctx.textAlign = 'center';
    const tw = ctx.measureText(G.msg).width + 30;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(W / 2 - tw / 2, 82, tw, 36, 10); ctx.fill();
    ctx.fillStyle = G.msgC; ctx.fillText(G.msg, W / 2, 107);
    ctx.globalAlpha = 1;
  }
}

function drawControls() {
  const L = layout();
  // joystick
  if (joy.active) {
    circle(joy.ox, joy.oy, L.R, 'rgba(255,255,255,0.15)');
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, L.R, 0, TAU); ctx.stroke();
    circle(joy.x, joy.y, L.R * 0.45, 'rgba(255,255,255,0.5)');
  } else {
    circle(L.joyHome.x, L.joyHome.y, L.R, 'rgba(255,255,255,0.08)');
    circle(L.joyHome.x, L.joyHome.y, L.R * 0.45, 'rgba(255,255,255,0.18)');
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('MOVE', L.joyHome.x, L.joyHome.y + L.R + 16);
  }
  // attack button
  const a = L.atk, pressed = attackHeld;
  circle(a.x, a.y, a.r, pressed ? 'rgba(255,183,77,0.7)' : 'rgba(255,152,0,0.45)');
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.stroke();
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(-0.8);
  ctx.strokeStyle = '#5d4037'; ctx.lineWidth = a.r * 0.16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-a.r * 0.5, 0); ctx.lineTo(a.r * 0.5, 0); ctx.stroke();
  ctx.restore();
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  ctx.fillText('HIT', a.x, a.y + a.r * 0.62);
  // eat button
  if (G.nearTree) {
    const e = L.eat, pulse = 1 + Math.sin(G.t * 6) * 0.05;
    const busy = G.player.eat > 0;
    circle(e.x, e.y, e.r * pulse, busy ? 'rgba(129,199,132,0.4)' : 'rgba(102,187,106,0.7)');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * pulse, 0, TAU); ctx.stroke();
    circle(e.x, e.y - 4, e.r * 0.32, G.nearTree.fc.c);
    circle(e.x - e.r * 0.1, e.y - 4 - e.r * 0.1, e.r * 0.09, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('EAT', e.x, e.y + e.r * 0.62);
  }
}

function overlay(alpha) { ctx.fillStyle = 'rgba(8,20,6,' + alpha + ')'; ctx.fillRect(0, 0, W, H); }
function centerText(txt, y, size, col, weight) {
  ctx.font = (weight || 'bold') + ' ' + size + 'px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(txt, W / 2 + 2, y + 2);
  ctx.fillStyle = col || '#fff'; ctx.fillText(txt, W / 2, y);
}
function drawTitle() {
  overlay(0.68);
  const big = clamp(Math.min(W, H) * 0.1, 28, 60), sm = clamp(Math.min(W, H) * 0.04, 12, 19);
  let y = H * 0.2;
  centerText('Forest Stick Survival', y, big, '#c5e1a5'); y += big * 0.9;
  centerText('Walk the forest with your stick and your dog Buddy', y, sm, '#fff', 'normal'); y += sm * 1.9;
  const rules = [
    'Animals appear after every 10 seconds of quiet walking (1 or 2 at a time)',
    'Fox runs away when hit  •  Wild Cat & Boar back off, then attack again',
    'Wolf & Bear never run away  •  Watch for the red "!" before they bite',
    'Stand under a fruit tree and press EAT to heal',
  ];
  for (const r of rules) { centerText(r, y, sm * 0.9, '#e8f5e9', 'normal'); y += sm * 1.45; }
  y += sm * 0.8;
  if (Math.floor(performance.now() / 500) % 2 === 0) centerText('Tap to start', y + sm, sm * 1.5, '#fff59d');
  if (best > 0) centerText('Best score: ' + best, H - 20, sm, '#ffe082', 'normal');
}
function drawPaused() {
  overlay(0.5);
  centerText('Paused', H * 0.42, 42, '#fff');
  centerText('Tap to continue', H * 0.42 + 44, 20, '#e8f5e9', 'normal');
}
function drawOver() {
  overlay(Math.min(0.7, overT));
  if (overT < 0.3) return;
  const sm = clamp(Math.min(W, H) * 0.045, 14, 22);
  let y = H * 0.25;
  centerText('You collapsed in the forest', y, sm * 2, '#ffcdd2'); y += sm * 2.4;
  centerText('Walked ' + Math.floor(G.dist / 30) + ' m   •   Beaten ' + G.defeated + '   •   Scared off ' + G.scared, y, sm, '#fff', 'normal'); y += sm * 1.8;
  centerText('Score ' + totalScore() + (G.newBest ? '  -  New best!' : '   (best ' + best + ')'), y, sm * 1.3, '#fff59d'); y += sm * 2.6;
  if (overT > 1) centerText('Tap to play again', y, sm * 1.2, '#c5e1a5');
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!G) newGame();
  if (state === 'title') { G.t += dt; G.cam.x += dt * 12; G.player.x = G.cam.x; G.dog.x = G.cam.x - 40; updateFx(0); }
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// test hook (used for automated checks only)
window.__fss = { get G() { return G; }, get state() { return state; }, setState(s) { state = s; }, newGame, spawnWave, DEFS };
})();
