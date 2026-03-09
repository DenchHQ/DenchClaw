---
name: app-builder
description: Build and manage DenchClaw apps — self-contained web applications that run inside the workspace with access to DuckDB data and the DenchClaw bridge API. Covers static HTML apps, 2D games with p5.js, 3D experiences with Three.js, data dashboards, interactive tools, and more.
metadata: { "openclaw": { "inject": true, "always": true, "emoji": "🔨" } }
---

# App Builder

You can build **Dench Apps** — self-contained web applications that run inside DenchClaw's workspace. Apps appear in the sidebar with their own icon and name, and open as tabs in the main content area. They run in a sandboxed iframe with `allow-same-origin allow-scripts allow-popups allow-forms`.

---

## Table of Contents

1. [App Structure](#app-structure)
2. [Manifest Reference](#manifest-reference)
3. [Bridge API Reference](#bridge-api-reference)
4. [Theme & Styling System](#theme--styling-system)
5. [Loading External Libraries via CDN](#loading-external-libraries-via-cdn)
6. [2D Games with p5.js](#2d-games-with-p5js)
7. [3D Games & Experiences with Three.js](#3d-games--experiences-with-threejs)
8. [Data Dashboards & Visualization](#data-dashboards--visualization)
9. [Interactive Tools & Utilities](#interactive-tools--utilities)
10. [Multi-File App Organization](#multi-file-app-organization)
11. [Asset Management](#asset-management)
12. [Performance & Best Practices](#performance--best-practices)
13. [Error Handling Patterns](#error-handling-patterns)
14. [Full Example Apps](#full-example-apps)

---

## App Structure

Every app is a folder ending in `.dench.app/`. The default location is `{{WORKSPACE_PATH}}/apps/`, but apps can live anywhere in the workspace.

```
apps/
  my-app.dench.app/
    .dench.yaml          # Required manifest
    index.html           # Entry point
    style.css            # Styles (optional, can inline)
    app.js               # Logic (optional, can inline)
    assets/              # Images, sounds, models, etc.
      sprite.png
      bg-music.mp3
    lib/                 # Vendored libraries (optional)
      p5.min.js
```

### Critical Rules

- The folder name MUST end with `.dench.app`
- The `.dench.yaml` manifest is REQUIRED inside every `.dench.app` folder
- The entry HTML file gets the bridge SDK (`window.dench`) auto-injected before `</head>`
- All file paths within the app are relative to the `.dench.app` folder root
- The app is served at `/api/apps/serve/<appPath>/<filePath>` — relative references (CSS, JS, images) resolve correctly
- Apps run in an iframe sandbox: `allow-same-origin allow-scripts allow-popups allow-forms`

---

## Manifest Reference

Every `.dench.app` folder MUST contain a `.dench.yaml` manifest.

### Full Schema

```yaml
name: "My App"                    # Required. Display name shown in sidebar and tab bar
description: "What this app does" # Optional. Shown in tooltips and app info
icon: "gamepad-2"                 # Optional. Lucide icon name OR relative path to image
version: "1.0.0"                  # Optional. Shown as badge in app header
author: "agent"                   # Optional. Creator attribution
entry: "index.html"               # Optional. Main entry point (default: index.html)
runtime: "static"                 # Optional. static | esbuild | build (default: static)

permissions:                      # Optional. List of bridge API permissions
  - database                      # Can query workspace DuckDB via window.dench.db
  - files                         # Can read workspace files via window.dench.files
```

### Runtime Modes

| Mode | When to Use | How It Works |
|------|-------------|--------------|
| `static` | Vanilla HTML/CSS/JS apps, CDN-loaded libraries, games, dashboards | Serves files directly. **Use this by default for everything.** |
| `esbuild` | React/TSX apps without npm dependencies | Server-side esbuild transpiles JSX/TSX on load. Requires `esbuild.entry` and `esbuild.jsx` fields. |
| `build` | Complex apps with npm dependencies (rare) | Runs `build.install` then `build.command`. Serves from `build.output` directory. |

**Always default to `static` runtime.** It handles p5.js, Three.js, D3.js, Chart.js, and any CDN-loaded library perfectly. Only use `esbuild` or `build` when the user explicitly asks for React/TSX or npm-based tooling.

### Icon Support

The `icon` field accepts:

1. **A Lucide icon name** (string): `"gamepad-2"`, `"bar-chart-3"`, `"users"`, `"rocket"`, `"calculator"`, `"box"`, `"palette"`
2. **A relative path** to a square image file: `"icon.png"`, `"assets/logo.svg"`

Supported image formats: PNG, SVG, JPG, JPEG, WebP. Use square aspect ratio (128x128px or larger).

### Choosing Permissions

| Permission | Grants | Use When |
|------------|--------|----------|
| `database` | `window.dench.db.query()` and `window.dench.db.execute()` | App reads/writes workspace DuckDB data |
| `files` | `window.dench.files.read()` and `window.dench.files.list()` | App reads workspace files or directory tree |

Only request what you need. A game with no data access needs no permissions at all.

---

## Bridge API Reference

The bridge SDK is auto-injected into every app's HTML. It provides `window.dench` with the following methods. All methods return Promises with a 30-second timeout.

### Database Access (`database` permission required)

```javascript
// Run a SELECT query — returns { rows: [...], columns: [...] }
const result = await window.dench.db.query("SELECT * FROM objects");
console.log(result.rows);    // Array of row objects
console.log(result.columns); // Array of column name strings

// Run a mutation (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
await window.dench.db.execute("INSERT INTO ...");

// Parameterized-style queries (use string interpolation carefully)
const objectName = "people";
const entries = await window.dench.db.query(
  `SELECT * FROM entries WHERE object_id = (SELECT id FROM objects WHERE name = '${objectName}')`
);
```

### File Access (`files` permission required)

```javascript
// Read a workspace file by relative path
const fileContent = await window.dench.files.read("path/to/file.md");

// List the workspace directory tree
const tree = await window.dench.files.list();
// Returns nested tree structure: { name, path, type, children? }[]
```

### App Utilities (no permission required)

```javascript
// Get the app's own parsed manifest
const manifest = await window.dench.app.getManifest();
// Returns: { name, description, icon, version, author, entry, runtime, permissions }

// Get current DenchClaw UI theme
const theme = await window.dench.app.getTheme();
// Returns: "dark" or "light"
```

### Agent Communication (no permission required)

```javascript
// Send a message to the DenchClaw agent (triggers a chat message)
await window.dench.agent.send("Analyze the data in the people table");
```

### Waiting for Bridge Readiness

The bridge script is injected into `<head>`, so it's available by the time your scripts run. However, if you use `defer` or `type="module"` scripts, you can safely access `window.dench` immediately since module scripts run after the document is parsed.

```javascript
// Safe pattern for any script loading order
function whenDenchReady(fn) {
  if (window.dench) return fn();
  const check = setInterval(() => {
    if (window.dench) { clearInterval(check); fn(); }
  }, 50);
}

whenDenchReady(async () => {
  const theme = await window.dench.app.getTheme();
  document.body.className = theme;
});
```

---

## Theme & Styling System

Apps should respect the DenchClaw theme. The bridge provides the current theme ("dark" or "light"). Build your CSS to support both.

### Recommended Base Styles

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color 0.2s, color 0.2s;
}

body.dark {
  --app-bg: #0f0f1a;
  --app-surface: #1a1a2e;
  --app-surface-hover: #252540;
  --app-border: #2a2a45;
  --app-text: #e8e8f0;
  --app-text-muted: #8888a8;
  --app-accent: #6366f1;
  --app-accent-hover: #818cf8;
  --app-success: #22c55e;
  --app-warning: #f59e0b;
  --app-error: #ef4444;
  background: var(--app-bg);
  color: var(--app-text);
}

body.light {
  --app-bg: #ffffff;
  --app-surface: #f8f9fa;
  --app-surface-hover: #f0f1f3;
  --app-border: #e2e4e8;
  --app-text: #1a1a2e;
  --app-text-muted: #6b7280;
  --app-accent: #6366f1;
  --app-accent-hover: #4f46e5;
  --app-success: #16a34a;
  --app-warning: #d97706;
  --app-error: #dc2626;
  background: var(--app-bg);
  color: var(--app-text);
}
```

### Theme Initialization

Always apply the theme as the first action in your app:

```javascript
async function initTheme() {
  try {
    const theme = await window.dench.app.getTheme();
    document.body.className = theme;
  } catch {
    document.body.className = 'dark';
  }
}
initTheme();
```

### Canvas-Based Apps (Games)

For p5.js, Three.js, or any canvas-based app, set the canvas background based on theme and make sure the body has no scrollbars:

```css
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
}

canvas {
  display: block;
}
```

---

## Loading External Libraries via CDN

Since apps use `runtime: "static"`, load libraries via CDN `<script>` tags. The app iframe allows external script loading.

### Recommended CDNs

Use **unpkg** or **cdnjs** for reliability:

```html
<!-- p5.js -->
<script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>

<!-- Three.js -->
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.170/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
  }
}
</script>

<!-- D3.js -->
<script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>

<!-- Chart.js -->
<script src="https://unpkg.com/chart.js@4/dist/chart.umd.min.js"></script>

<!-- Tone.js (audio) -->
<script src="https://unpkg.com/tone@15/build/Tone.js"></script>

<!-- Matter.js (2D physics) -->
<script src="https://unpkg.com/matter-js@0.20/build/matter.min.js"></script>

<!-- cannon-es (3D physics) -->
<script type="module">
import * as CANNON from 'https://unpkg.com/cannon-es@0.20/dist/cannon-es.js';
</script>

<!-- GSAP (animation) -->
<script src="https://unpkg.com/gsap@3/dist/gsap.min.js"></script>

<!-- Howler.js (audio) -->
<script src="https://unpkg.com/howler@2/dist/howler.min.js"></script>
```

### Import Maps for ES Modules

For Three.js and other module-based libraries, use import maps:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.170/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
  }
}
</script>
<script type="module" src="app.js"></script>
```

---

## 2D Games with p5.js

**Always use p5.js for 2D games, simulations, generative art, and interactive 2D experiences.** p5.js is the default choice for anything 2D unless the user specifically requests something else.

### When to Use p5.js

- 2D games (platformer, puzzle, arcade, card games, board games)
- Generative art and creative coding
- Physics simulations and particle systems
- Interactive data visualizations with animation
- Educational simulations and demonstrations
- Drawing and painting tools
- Any 2D canvas-based interactive experience

### p5.js App Template

```
apps/my-game.dench.app/
  .dench.yaml
  index.html
  sketch.js
  assets/           # sprites, sounds, fonts
```

**`.dench.yaml`:**
```yaml
name: "My Game"
description: "A fun 2D game built with p5.js"
icon: "gamepad-2"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

No permissions needed unless the game reads/writes workspace data.

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Game</title>
  <script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { display: flex; align-items: center; justify-content: center; background: #0f0f1a; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script src="sketch.js"></script>
</body>
</html>
```

**`sketch.js` (game loop skeleton):**
```javascript
let isDark = true;

function setup() {
  createCanvas(windowWidth, windowHeight);

  // Detect theme from DenchClaw
  if (window.dench) {
    window.dench.app.getTheme().then(theme => {
      isDark = theme === 'dark';
    }).catch(() => {});
  }
}

function draw() {
  background(isDark ? 15 : 245);

  // Game rendering goes here
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

### p5.js Instance Mode (Recommended for Complex Apps)

Use instance mode to avoid global namespace pollution. This is especially important for multi-file apps:

```javascript
const sketch = (p) => {
  let isDark = true;
  let player;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    player = { x: p.width / 2, y: p.height / 2, size: 30, speed: 4 };

    if (window.dench) {
      window.dench.app.getTheme().then(theme => { isDark = theme === 'dark'; }).catch(() => {});
    }
  };

  p.draw = () => {
    p.background(isDark ? 15 : 245);

    // Input handling
    if (p.keyIsDown(p.LEFT_ARROW) || p.keyIsDown(65))  player.x -= player.speed;
    if (p.keyIsDown(p.RIGHT_ARROW) || p.keyIsDown(68)) player.x += player.speed;
    if (p.keyIsDown(p.UP_ARROW) || p.keyIsDown(87))    player.y -= player.speed;
    if (p.keyIsDown(p.DOWN_ARROW) || p.keyIsDown(83))   player.y += player.speed;

    // Keep in bounds
    player.x = p.constrain(player.x, 0, p.width);
    player.y = p.constrain(player.y, 0, p.height);

    // Draw player
    p.fill(isDark ? '#6366f1' : '#4f46e5');
    p.noStroke();
    p.ellipse(player.x, player.y, player.size);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
};

new p5(sketch);
```

### p5.js Game Architecture Patterns

#### Game State Machine

```javascript
const GameState = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'gameover' };
let state = GameState.MENU;
let score = 0;
let highScore = 0;

function draw() {
  switch (state) {
    case GameState.MENU:     drawMenu(); break;
    case GameState.PLAYING:  drawGame(); break;
    case GameState.PAUSED:   drawPause(); break;
    case GameState.GAME_OVER: drawGameOver(); break;
  }
}

function keyPressed() {
  if (state === GameState.MENU && (key === ' ' || key === 'Enter')) {
    state = GameState.PLAYING;
    resetGame();
  } else if (state === GameState.PLAYING && key === 'Escape') {
    state = GameState.PAUSED;
  } else if (state === GameState.PAUSED && key === 'Escape') {
    state = GameState.PLAYING;
  } else if (state === GameState.GAME_OVER && (key === ' ' || key === 'Enter')) {
    state = GameState.PLAYING;
    resetGame();
  }
}

function drawMenu() {
  background(15);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(48);
  text('MY GAME', width / 2, height / 2 - 60);
  textSize(18);
  fill(150);
  text('Press SPACE or ENTER to start', width / 2, height / 2 + 20);
  if (highScore > 0) {
    textSize(14);
    text('High Score: ' + highScore, width / 2, height / 2 + 60);
  }
}

function drawGameOver() {
  background(15);
  fill('#ef4444');
  textAlign(CENTER, CENTER);
  textSize(48);
  text('GAME OVER', width / 2, height / 2 - 60);
  fill(255);
  textSize(24);
  text('Score: ' + score, width / 2, height / 2);
  textSize(16);
  fill(150);
  text('Press SPACE to play again', width / 2, height / 2 + 50);
}
```

#### Sprite Management

```javascript
class Sprite {
  constructor(x, y, w, h) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.w = w;
    this.h = h;
    this.alive = true;
  }

  update() {
    this.pos.add(this.vel);
  }

  draw() {
    rectMode(CENTER);
    rect(this.pos.x, this.pos.y, this.w, this.h);
  }

  collidesWith(other) {
    return (
      this.pos.x - this.w / 2 < other.pos.x + other.w / 2 &&
      this.pos.x + this.w / 2 > other.pos.x - other.w / 2 &&
      this.pos.y - this.h / 2 < other.pos.y + other.h / 2 &&
      this.pos.y + this.h / 2 > other.pos.y - other.h / 2
    );
  }

  isOffscreen() {
    return (
      this.pos.x < -this.w || this.pos.x > width + this.w ||
      this.pos.y < -this.h || this.pos.y > height + this.h
    );
  }
}
```

#### Particle System

```javascript
class Particle {
  constructor(x, y, color) {
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(random(1, 5));
    this.acc = createVector(0, 0.1);
    this.color = color;
    this.alpha = 255;
    this.size = random(3, 8);
    this.life = 1.0;
    this.decay = random(0.01, 0.04);
  }

  update() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.life -= this.decay;
    this.alpha = this.life * 255;
  }

  draw() {
    noStroke();
    fill(red(this.color), green(this.color), blue(this.color), this.alpha);
    ellipse(this.pos.x, this.pos.y, this.size);
  }

  isDead() {
    return this.life <= 0;
  }
}

let particles = [];

function spawnExplosion(x, y, col, count = 30) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, col));
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if (particles[i].isDead()) particles.splice(i, 1);
  }
}
```

#### Camera / Scrolling

```javascript
let camera = { x: 0, y: 0 };

function draw() {
  background(15);

  // Follow player
  camera.x = lerp(camera.x, player.x - width / 2, 0.1);
  camera.y = lerp(camera.y, player.y - height / 2, 0.1);

  push();
  translate(-camera.x, -camera.y);

  // Draw world (in world coordinates)
  drawWorld();
  drawPlayer();
  drawEnemies();

  pop();

  // Draw HUD (in screen coordinates)
  drawHUD();
}
```

#### Tilemap Rendering

```javascript
const TILE_SIZE = 32;
const tilemap = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 2, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 3, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
];

const TILE_COLORS = {
  0: null,       // empty
  1: '#4a4a6a',  // wall
  2: '#22c55e',  // item
  3: '#ef4444',  // enemy
};

function drawTilemap() {
  for (let row = 0; row < tilemap.length; row++) {
    for (let col = 0; col < tilemap[row].length; col++) {
      const tile = tilemap[row][col];
      if (TILE_COLORS[tile]) {
        fill(TILE_COLORS[tile]);
        noStroke();
        rect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
```

#### Sound Effects (using p5.sound or Howler.js)

For sound, prefer Howler.js since p5.sound adds significant bundle size:

```html
<script src="https://unpkg.com/howler@2/dist/howler.min.js"></script>
```

```javascript
const sounds = {
  jump: new Howl({ src: ['assets/jump.wav'], volume: 0.5 }),
  hit: new Howl({ src: ['assets/hit.wav'], volume: 0.7 }),
  coin: new Howl({ src: ['assets/coin.wav'], volume: 0.4 }),
  music: new Howl({ src: ['assets/music.mp3'], loop: true, volume: 0.3 }),
};
```

If no sound assets are available, generate simple audio with Tone.js or the Web Audio API:

```javascript
function playBeep(freq = 440, duration = 0.1) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}
```

### p5.js with Physics (Matter.js)

For games needing realistic 2D physics (platformers, ragdoll, pinball):

```html
<script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
<script src="https://unpkg.com/matter-js@0.20/build/matter.min.js"></script>
```

```javascript
const { Engine, World, Bodies, Body, Events } = Matter;

let engine, world;
let ground, player;

function setup() {
  createCanvas(windowWidth, windowHeight);
  engine = Engine.create();
  world = engine.world;

  ground = Bodies.rectangle(width / 2, height - 20, width, 40, { isStatic: true });
  player = Bodies.circle(width / 2, height / 2, 20, { restitution: 0.5 });

  World.add(world, [ground, player]);
}

function draw() {
  Engine.update(engine);
  background(15);

  // Draw ground
  fill('#4a4a6a');
  rectMode(CENTER);
  rect(ground.position.x, ground.position.y, width, 40);

  // Draw player
  fill('#6366f1');
  ellipse(player.position.x, player.position.y, 40);
}

function keyPressed() {
  if (key === ' ') {
    Body.applyForce(player, player.position, { x: 0, y: -0.05 });
  }
}
```

### p5.js Responsive Canvas

Always handle window resizing and use the full viewport:

```javascript
function setup() {
  createCanvas(windowWidth, windowHeight);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

For fixed-aspect-ratio games (e.g., retro pixel games), scale the canvas:

```javascript
const GAME_W = 320;
const GAME_H = 240;
let scaleFactor;

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noSmooth();
  calcScale();
}

function calcScale() {
  scaleFactor = min(windowWidth / GAME_W, windowHeight / GAME_H);
}

function draw() {
  background(0);
  push();
  translate((width - GAME_W * scaleFactor) / 2, (height - GAME_H * scaleFactor) / 2);
  scale(scaleFactor);

  // All game drawing at GAME_W x GAME_H logical resolution
  drawGameWorld();

  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  calcScale();
}
```

### Touch / Mobile Input for p5.js Games

```javascript
let touchActive = false;
let touchX = 0, touchY = 0;

function touchStarted() {
  touchActive = true;
  touchX = mouseX;
  touchY = mouseY;
  return false; // prevent default
}

function touchMoved() {
  touchX = mouseX;
  touchY = mouseY;
  return false;
}

function touchEnded() {
  touchActive = false;
  return false;
}

// Unified input: works for both mouse and touch
function getInputX() { return mouseX; }
function getInputY() { return mouseY; }
function isInputActive() { return mouseIsPressed || touchActive; }
```

### p5.js High Score Persistence with DuckDB

If the game has a `database` permission, persist high scores:

```javascript
async function loadHighScore() {
  try {
    await window.dench.db.execute(`
      CREATE TABLE IF NOT EXISTS game_scores (
        game TEXT, score INTEGER, played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await window.dench.db.query(
      `SELECT MAX(score) as high_score FROM game_scores WHERE game = 'my-game'`
    );
    return result.rows?.[0]?.high_score || 0;
  } catch { return 0; }
}

async function saveScore(score) {
  try {
    await window.dench.db.execute(
      `INSERT INTO game_scores (game, score) VALUES ('my-game', ${score})`
    );
  } catch {}
}
```

---

## 3D Games & Experiences with Three.js

**Always use Three.js for 3D games, visualizations, and interactive 3D experiences.** Three.js is the default choice for anything 3D.

### When to Use Three.js

- 3D games (first-person, third-person, flying, racing)
- 3D product viewers and configurators
- Terrain and world visualization
- 3D data visualization (3D scatter plots, network graphs)
- Architectural walkthroughs
- Generative 3D art
- Physics-based 3D simulations

### Three.js App Template

```
apps/my-3d-app.dench.app/
  .dench.yaml
  index.html
  app.js            # Main Three.js module
  assets/
    model.glb       # 3D models (optional)
    texture.jpg     # Textures (optional)
```

**`.dench.yaml`:**
```yaml
name: "3D World"
description: "An interactive 3D experience"
icon: "box"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D World</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.170/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    canvas { display: block; }
    #loading {
      position: fixed; inset: 0; display: flex;
      align-items: center; justify-content: center;
      background: #0f0f1a; color: #e8e8f0;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 18px; z-index: 10;
      transition: opacity 0.5s;
    }
    #loading.hidden { opacity: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="loading">Loading...</div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

**`app.js` (Three.js module skeleton):**
```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f1a);
scene.fog = new THREE.Fog(0x0f0f1a, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(2048, 2048);
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;
scene.add(directionalLight);

// --- Ground ---
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Objects ---
const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshStandardMaterial({
  color: 0x6366f1,
  roughness: 0.3,
  metalness: 0.5,
});
const cube = new THREE.Mesh(geometry, material);
cube.position.y = 1;
cube.castShadow = true;
scene.add(cube);

// --- Theme ---
if (window.dench) {
  window.dench.app.getTheme().then(theme => {
    if (theme === 'light') {
      scene.background = new THREE.Color(0xf0f0f5);
      scene.fog = new THREE.Fog(0xf0f0f5, 50, 200);
      groundMat.color.set(0xe8e8f0);
    }
  }).catch(() => {});
}

// --- Hide loading screen ---
document.getElementById('loading')?.classList.add('hidden');

// --- Animation loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  cube.rotation.y = elapsed * 0.5;
  cube.position.y = 1 + Math.sin(elapsed) * 0.5;

  controls.update();
  renderer.render(scene, camera);
}

animate();

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

### Three.js Common Addons

Load additional Three.js modules as needed via the import map:

```javascript
// First-person controls
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// GLTF model loading
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Post-processing
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Environment maps
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Text
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// Sky
import { Sky } from 'three/addons/objects/Sky.js';

// Water
import { Water } from 'three/addons/objects/Water.js';

// Physics integration (use cannon-es via CDN)
// Add to importmap: "cannon-es": "https://unpkg.com/cannon-es@0.20/dist/cannon-es.js"
import * as CANNON from 'cannon-es';
```

### Three.js First-Person Game Pattern

```javascript
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);

// Click to enter pointer lock
document.addEventListener('click', () => {
  if (!controls.isLocked) controls.lock();
});

// Movement state
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const keys = { forward: false, backward: false, left: false, right: false, jump: false };

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space':                   keys.jump = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'Space':                   keys.jump = false; break;
  }
});

let onGround = true;
const MOVE_SPEED = 50;
const JUMP_FORCE = 12;
const GRAVITY = 30;

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked) {
    // Apply friction
    velocity.x -= velocity.x * 10.0 * dt;
    velocity.z -= velocity.z * 10.0 * dt;
    velocity.y -= GRAVITY * dt;

    direction.z = Number(keys.forward) - Number(keys.backward);
    direction.x = Number(keys.right) - Number(keys.left);
    direction.normalize();

    if (keys.forward || keys.backward) velocity.z -= direction.z * MOVE_SPEED * dt;
    if (keys.left || keys.right) velocity.x -= direction.x * MOVE_SPEED * dt;
    if (keys.jump && onGround) { velocity.y = JUMP_FORCE; onGround = false; }

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);
    camera.position.y += velocity.y * dt;

    if (camera.position.y < 1.7) {
      velocity.y = 0;
      camera.position.y = 1.7;
      onGround = true;
    }
  }

  renderer.render(scene, camera);
}

animate();
```

### Three.js GLTF Model Loading

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.170/examples/jsm/libs/draco/');
loader.setDRACOLoader(dracoLoader);

// Load a model from the app's assets folder
loader.load('assets/model.glb', (gltf) => {
  const model = gltf.scene;
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  model.scale.setScalar(1);
  scene.add(model);

  // If the model has animations
  if (gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
    // In animate loop: mixer.update(dt);
  }
}, undefined, (error) => {
  console.error('Model load error:', error);
});
```

### Three.js Post-Processing (Bloom, etc.)

```javascript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,  // strength
  0.4,  // radius
  0.85  // threshold
);
composer.addPass(bloomPass);

// In animate loop, replace renderer.render(scene, camera) with:
// composer.render();

// On resize, also update:
// composer.setSize(window.innerWidth, window.innerHeight);
```

### Three.js Procedural Terrain

```javascript
function createTerrain(width, depth, resolution) {
  const geometry = new THREE.PlaneGeometry(width, depth, resolution, resolution);
  const vertices = geometry.attributes.position.array;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const z = vertices[i + 1];
    vertices[i + 2] = noise(x * 0.02, z * 0.02) * 15;
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x3a7d44,
    roughness: 0.9,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// Simple noise function (for procedural generation without dependencies)
function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
```

### Three.js HUD / UI Overlay

Since Three.js renders to a canvas, use HTML overlays for UI:

```html
<div id="hud" style="
  position: fixed; top: 0; left: 0; right: 0;
  padding: 16px; pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  color: white; z-index: 5;
">
  <div id="score" style="font-size: 24px; font-weight: 700;"></div>
  <div id="health-bar" style="
    width: 200px; height: 8px; border-radius: 4px;
    background: rgba(255,255,255,0.2); margin-top: 8px;
  ">
    <div id="health-fill" style="
      width: 100%; height: 100%; border-radius: 4px;
      background: #22c55e; transition: width 0.3s;
    "></div>
  </div>
</div>
```

```javascript
function updateHUD(score, health) {
  document.getElementById('score').textContent = `Score: ${score}`;
  document.getElementById('health-fill').style.width = `${health}%`;
  document.getElementById('health-fill').style.background =
    health > 50 ? '#22c55e' : health > 25 ? '#f59e0b' : '#ef4444';
}
```

---

## Data Dashboards & Visualization

For data-heavy apps that query the workspace DuckDB, use Chart.js, D3.js, or plain HTML/CSS.

### Chart.js Dashboard

```html
<script src="https://unpkg.com/chart.js@4/dist/chart.umd.min.js"></script>
```

```javascript
async function renderChart() {
  const result = await window.dench.db.query(
    "SELECT name, entry_count FROM objects ORDER BY entry_count DESC"
  );

  const ctx = document.getElementById('myChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: result.rows.map(r => r.name),
      datasets: [{
        label: 'Entries',
        data: result.rows.map(r => r.entry_count),
        backgroundColor: '#6366f180',
        borderColor: '#6366f1',
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#2a2a4530' } },
        x: { grid: { display: false } },
      }
    }
  });
}
```

### D3.js Visualization

```html
<script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
```

```javascript
async function renderViz() {
  const result = await window.dench.db.query("SELECT * FROM pivot_people LIMIT 100");
  const data = result.rows;

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const width = window.innerWidth - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const svg = d3.select('#chart')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Build scales, axes, bindings as needed
}
```

### CSS-Only Stat Cards (No Library Needed)

For simple metric displays, plain HTML/CSS is often better than a charting library:

```html
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-label">Total Records</div>
    <div class="stat-value" id="total">—</div>
    <div class="stat-change positive">+12% this week</div>
  </div>
</div>
```

```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  padding: 24px;
}

.stat-card {
  padding: 20px;
  border-radius: 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}

.stat-label {
  font-size: 13px;
  color: var(--app-text-muted);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 36px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.stat-change {
  font-size: 12px;
  margin-top: 4px;
}

.stat-change.positive { color: var(--app-success); }
.stat-change.negative { color: var(--app-error); }
```

---

## Interactive Tools & Utilities

### Form-Based Tools

For tools that collect input and process it:

```html
<form id="tool-form">
  <div class="field">
    <label for="input">Input</label>
    <textarea id="input" rows="6" placeholder="Paste your data here..."></textarea>
  </div>
  <button type="submit">Process</button>
  <div id="output" class="output-box"></div>
</form>
```

```css
.field { margin-bottom: 16px; }
.field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-muted);
  margin-bottom: 6px;
}
.field textarea, .field input, .field select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}
.field textarea:focus, .field input:focus {
  outline: none;
  border-color: var(--app-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 20%, transparent);
}
button[type="submit"] {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: var(--app-accent);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
button[type="submit"]:hover { background: var(--app-accent-hover); }
.output-box {
  margin-top: 16px;
  padding: 16px;
  border-radius: 8px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  max-height: 400px;
  overflow: auto;
}
```

### Kanban / Drag-and-Drop

For sortable/draggable interfaces, use the native HTML Drag and Drop API or load SortableJS:

```html
<script src="https://unpkg.com/sortablejs@1/Sortable.min.js"></script>
```

```javascript
document.querySelectorAll('.kanban-column').forEach(col => {
  Sortable.create(col, {
    group: 'tasks',
    animation: 150,
    ghostClass: 'drag-ghost',
    onEnd: (evt) => {
      // Persist order change via DuckDB if needed
    },
  });
});
```

---

## Multi-File App Organization

For complex apps, split code across multiple files:

```
apps/complex-app.dench.app/
  .dench.yaml
  index.html
  css/
    main.css
    components.css
  js/
    app.js           # Entry point
    game.js          # Game logic
    renderer.js      # Rendering
    ui.js            # UI overlays
    utils.js         # Helpers
  assets/
    sprites/
    sounds/
    models/
```

### Using ES Modules for Multi-File JS

```html
<script type="module" src="js/app.js"></script>
```

```javascript
// js/app.js
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const game = new Game();
const renderer = new Renderer(game);
const ui = new UI(game);

async function init() {
  if (window.dench) {
    const theme = await window.dench.app.getTheme();
    renderer.setTheme(theme);
  }
  game.start();
}

init();
```

```javascript
// js/game.js
export class Game {
  constructor() {
    this.state = 'menu';
    this.score = 0;
    this.entities = [];
  }

  start() { this.state = 'playing'; this.loop(); }
  loop() {
    this.update();
    requestAnimationFrame(() => this.loop());
  }
  update() { /* game logic */ }
}
```

Relative imports (`./game.js`) work because all files are served from the same `/api/apps/serve/` base path.

---

## Asset Management

### Referencing Assets

All asset paths are relative to the `.dench.app` folder root:

```javascript
// In p5.js
let img;
function preload() {
  img = loadImage('assets/player.png');
}

// In Three.js (module)
const texture = new THREE.TextureLoader().load('assets/texture.jpg');

// In HTML
// <img src="assets/logo.png" />
// <audio src="assets/music.mp3"></audio>
```

### Supported MIME Types

The file server recognizes these extensions automatically:

| Extension | MIME Type |
|-----------|-----------|
| `.html`, `.htm` | `text/html` |
| `.css` | `text/css` |
| `.js`, `.mjs` | `application/javascript` |
| `.json` | `application/json` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.webp` | `image/webp` |
| `.woff`, `.woff2` | `font/woff`, `font/woff2` |
| `.ttf`, `.otf` | `font/ttf`, `font/otf` |
| `.wasm` | `application/wasm` |
| `.mp3`, `.wav`, `.ogg` | Served as `application/octet-stream` (works fine for `<audio>` and Howler) |

### Generating Assets Inline

For games without pre-made art, generate sprites and textures programmatically:

```javascript
// p5.js: Create a sprite at runtime
function createPlayerSprite(size) {
  const g = createGraphics(size, size);
  g.noStroke();
  g.fill('#6366f1');
  g.ellipse(size / 2, size / 2, size * 0.8);
  g.fill('#818cf8');
  g.ellipse(size / 2, size / 3, size * 0.3);
  return g;
}

// Three.js: Create a texture from canvas
function createCheckerTexture(size = 256, divisions = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cellSize = size / divisions;
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#cccccc';
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
```

---

## Performance & Best Practices

### General

- **Always use `runtime: "static"`** unless explicitly asked for React/TSX/npm
- **Request only needed permissions** — no permissions needed for pure games/tools
- **Keep apps self-contained** — all resources within the `.dench.app` folder
- **Use semantic HTML** and responsive design
- **Handle errors** for all bridge API calls
- **Apply the theme** as the very first thing on load
- **Use `requestAnimationFrame`** for all animation loops (p5.js does this automatically)
- **Clean up resources** in games: remove event listeners, cancel animations, dispose Three.js objects

### p5.js Performance

- Use `pixelDensity(1)` for pixel-art or retro-style games to avoid unnecessary high-DPI rendering
- Use `noSmooth()` for pixel-art aesthetics
- Minimize `createGraphics()` calls — create off-screen buffers once and reuse
- Object pool frequently-created entities (bullets, particles) instead of creating new objects each frame
- Use `p.frameRate(60)` explicitly to cap FPS
- For large worlds, only render entities visible on screen (frustum culling)
- Use `p.millis()` or `p.deltaTime` for time-based movement instead of frame-based

### Three.js Performance

- **Limit pixel ratio**: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`
- **Reuse geometries and materials** — don't create new ones per object if the shape/material is the same
- **Dispose resources** when no longer needed: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`
- **Use `BufferGeometry`** (the default in modern Three.js)
- **Merge static meshes** with `BufferGeometryUtils.mergeGeometries()` for large scenes
- **Use instanced rendering** (`InstancedMesh`) for many identical objects (trees, particles)
- **Limit shadow map resolution** on mobile
- **Use LOD** (Level of Detail) for complex models: `THREE.LOD`
- **Throttle physics** to a fixed timestep (e.g., 60Hz) separate from render framerate

### Memory

- For Three.js, always clean up in a dispose function:
  ```javascript
  function dispose() {
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
  ```

---

## Error Handling Patterns

### Bridge API Error Handling

Always wrap bridge calls in try/catch:

```javascript
async function loadData() {
  try {
    const result = await window.dench.db.query("SELECT * FROM objects");
    return result.rows || [];
  } catch (err) {
    console.error('Failed to load data:', err.message);
    showError('Could not load workspace data. Check permissions.');
    return [];
  }
}
```

### Loading State Pattern

```javascript
function showLoading(message = 'Loading...') {
  const el = document.getElementById('loading');
  if (el) { el.textContent = message; el.style.display = 'flex'; }
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.style.display = 'none';
}

function showError(message) {
  const el = document.getElementById('error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}
```

### Graceful Degradation

```javascript
async function init() {
  // Apply theme (degrade gracefully if bridge unavailable)
  try {
    const theme = await window.dench.app.getTheme();
    document.body.className = theme;
  } catch {
    document.body.className = 'dark';
  }

  // Load data (show fallback UI if unavailable)
  try {
    const data = await window.dench.db.query("SELECT * FROM objects");
    renderDashboard(data.rows);
  } catch {
    renderEmptyState('No data available. Make sure the app has database permission.');
  }
}
```

---

## Full Example Apps

### Example 1: Arcade Game (p5.js)

A complete asteroid-dodge game with scoring, particles, and game states.

**`.dench.yaml`:**
```yaml
name: "Asteroid Dodge"
description: "Dodge the falling asteroids! Arrow keys or WASD to move."
icon: "rocket"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asteroid Dodge</title>
  <script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a1a; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script src="game.js"></script>
</body>
</html>
```

**`game.js`:**
```javascript
const State = { MENU: 0, PLAY: 1, OVER: 2 };
let state = State.MENU;
let player, asteroids, particles, stars;
let score, highScore = 0, spawnTimer, difficulty;

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('system-ui');

  stars = Array.from({ length: 100 }, () => ({
    x: random(width), y: random(height), s: random(1, 3), b: random(100, 255)
  }));

  if (window.dench) {
    window.dench.app.getTheme().catch(() => {});
  }
}

function resetGame() {
  player = { x: width / 2, y: height - 80, size: 24, speed: 5, lives: 3, invincible: 0 };
  asteroids = [];
  particles = [];
  score = 0;
  spawnTimer = 0;
  difficulty = 1;
}

function draw() {
  background(10, 10, 26);
  drawStars();

  switch (state) {
    case State.MENU: drawMenu(); break;
    case State.PLAY: updateGame(); drawGame(); drawHUD(); break;
    case State.OVER: drawGame(); drawHUD(); drawGameOver(); break;
  }
}

function drawStars() {
  noStroke();
  for (const s of stars) {
    fill(255, s.b);
    ellipse(s.x, s.y, s.s);
    s.y += s.s * 0.3;
    if (s.y > height) { s.y = 0; s.x = random(width); }
  }
}

function drawMenu() {
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(min(width * 0.08, 56));
  textStyle(BOLD);
  text('ASTEROID DODGE', width / 2, height / 2 - 60);
  textSize(min(width * 0.03, 18));
  textStyle(NORMAL);
  fill(180);
  text('Arrow keys or WASD to move', width / 2, height / 2 + 10);
  fill(99, 102, 241);
  text('Press SPACE or ENTER to start', width / 2, height / 2 + 50);
  if (highScore > 0) {
    fill(120);
    textSize(14);
    text('High Score: ' + highScore, width / 2, height / 2 + 90);
  }
}

function updateGame() {
  // Player movement
  if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) player.x -= player.speed;
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) player.x += player.speed;
  if (keyIsDown(UP_ARROW) || keyIsDown(87)) player.y -= player.speed;
  if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) player.y += player.speed;
  player.x = constrain(player.x, player.size, width - player.size);
  player.y = constrain(player.y, player.size, height - player.size);
  if (player.invincible > 0) player.invincible--;

  // Spawn asteroids
  difficulty = 1 + score / 500;
  spawnTimer++;
  if (spawnTimer > max(15, 45 - difficulty * 3)) {
    asteroids.push({
      x: random(width), y: -30,
      size: random(15, 35),
      vy: random(2, 4) * difficulty,
      vx: random(-1, 1),
      rot: random(TWO_PI),
      rotSpeed: random(-0.05, 0.05),
    });
    spawnTimer = 0;
  }

  // Update asteroids
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const a = asteroids[i];
    a.y += a.vy;
    a.x += a.vx;
    a.rot += a.rotSpeed;

    if (a.y > height + 50) {
      asteroids.splice(i, 1);
      score += 10;
      continue;
    }

    // Collision
    if (player.invincible <= 0 && dist(player.x, player.y, a.x, a.y) < player.size + a.size / 2) {
      spawnParticles(a.x, a.y, color(239, 68, 68), 20);
      asteroids.splice(i, 1);
      player.lives--;
      player.invincible = 90;
      if (player.lives <= 0) {
        highScore = max(highScore, score);
        state = State.OVER;
      }
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.02;
    if (p.life <= 0) particles.splice(i, 1);
  }

  score++;
}

function drawGame() {
  // Draw asteroids
  for (const a of asteroids) {
    push();
    translate(a.x, a.y);
    rotate(a.rot);
    fill(120, 120, 140);
    stroke(80, 80, 100);
    strokeWeight(1);
    beginShape();
    for (let i = 0; i < 7; i++) {
      const angle = map(i, 0, 7, 0, TWO_PI);
      const r = a.size / 2 * (0.7 + 0.3 * sin(i * 2.5));
      vertex(cos(angle) * r, sin(angle) * r);
    }
    endShape(CLOSE);
    pop();
  }

  // Draw particles
  noStroke();
  for (const p of particles) {
    fill(red(p.col), green(p.col), blue(p.col), p.life * 255);
    ellipse(p.x, p.y, p.size * p.life);
  }

  // Draw player
  if (state === State.PLAY) {
    if (player.invincible <= 0 || frameCount % 6 < 3) {
      push();
      translate(player.x, player.y);
      fill(99, 102, 241);
      noStroke();
      triangle(0, -player.size, -player.size * 0.6, player.size * 0.6, player.size * 0.6, player.size * 0.6);
      fill(129, 140, 248);
      triangle(0, -player.size * 0.5, -player.size * 0.3, player.size * 0.3, player.size * 0.3, player.size * 0.3);
      pop();
    }
  }
}

function drawHUD() {
  fill(255);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(20);
  textStyle(BOLD);
  text('Score: ' + score, 20, 20);
  textStyle(NORMAL);
  textSize(14);
  fill(200);
  for (let i = 0; i < player.lives; i++) {
    fill(239, 68, 68);
    ellipse(20 + i * 22, 55, 14);
  }
}

function drawGameOver() {
  fill(0, 0, 0, 150);
  rect(0, 0, width, height);
  fill(239, 68, 68);
  textAlign(CENTER, CENTER);
  textSize(min(width * 0.07, 48));
  textStyle(BOLD);
  text('GAME OVER', width / 2, height / 2 - 40);
  fill(255);
  textSize(22);
  textStyle(NORMAL);
  text('Score: ' + score, width / 2, height / 2 + 10);
  fill(180);
  textSize(16);
  text('Press SPACE to play again', width / 2, height / 2 + 50);
}

function spawnParticles(x, y, col, count) {
  for (let i = 0; i < count; i++) {
    const angle = random(TWO_PI);
    const speed = random(1, 5);
    particles.push({
      x, y, vx: cos(angle) * speed, vy: sin(angle) * speed,
      size: random(4, 10), col, life: 1.0,
    });
  }
}

function keyPressed() {
  if (state === State.MENU && (key === ' ' || key === 'Enter')) {
    state = State.PLAY;
    resetGame();
  } else if (state === State.OVER && (key === ' ' || key === 'Enter')) {
    state = State.PLAY;
    resetGame();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
```

### Example 2: 3D Scene Viewer (Three.js)

**`.dench.yaml`:**
```yaml
name: "3D Playground"
description: "Interactive 3D scene with orbit controls"
icon: "box"
version: "1.0.0"
entry: "index.html"
runtime: "static"
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Playground</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.170/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script type="module" src="scene.js"></script>
</body>
</html>
```

**`scene.js`:**
```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
let bgColor = 0x0f0f1a;

if (window.dench) {
  window.dench.app.getTheme().then(t => {
    bgColor = t === 'light' ? 0xf0f0f5 : 0x0f0f1a;
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.Fog(bgColor, 30, 100);
  }).catch(() => {});
}

scene.background = new THREE.Color(bgColor);
scene.fog = new THREE.Fog(bgColor, 30, 100);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(8, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0x404060, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const shapes = [];
const colors = [0x6366f1, 0x22c55e, 0xf59e0b, 0xef4444, 0x06b6d4];

for (let i = 0; i < 12; i++) {
  const geos = [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.SphereGeometry(0.6, 32, 32),
    new THREE.ConeGeometry(0.5, 1.2, 6),
    new THREE.TorusGeometry(0.5, 0.2, 16, 32),
    new THREE.OctahedronGeometry(0.6),
  ];
  const geo = geos[Math.floor(Math.random() * geos.length)];
  const mat = new THREE.MeshStandardMaterial({
    color: colors[Math.floor(Math.random() * colors.length)],
    roughness: 0.3, metalness: 0.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    (Math.random() - 0.5) * 16,
    0.5 + Math.random() * 3,
    (Math.random() - 0.5) * 16
  );
  mesh.castShadow = true;
  mesh.userData = {
    baseY: mesh.position.y,
    phase: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
  };
  scene.add(mesh);
  shapes.push(mesh);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  for (const s of shapes) {
    s.position.y = s.userData.baseY + Math.sin(t + s.userData.phase) * 0.4;
    s.rotation.y += s.userData.rotSpeed;
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
```

### Example 3: Data Dashboard

**`.dench.yaml`:**
```yaml
name: "Dashboard"
description: "Workspace overview dashboard"
icon: "layout-dashboard"
version: "1.0.0"
entry: "index.html"
runtime: "static"
permissions:
  - database
```

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 24px; transition: background 0.2s, color 0.2s;
    }
    body.dark { background: #0f0f1a; color: #e8e8f0; }
    body.light { background: #fff; color: #1a1a2e; }

    h1 { font-size: 24px; margin-bottom: 24px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .card {
      padding: 20px; border-radius: 12px;
      background: color-mix(in srgb, currentColor 5%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    }
    .card h3 { font-size: 13px; opacity: 0.6; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .value { font-size: 36px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .error { padding: 16px; background: #ef444420; border-radius: 8px; color: #ef4444; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>Workspace Dashboard</h1>
  <div class="grid" id="cards"></div>
  <script>
    async function init() {
      try {
        const theme = await window.dench.app.getTheme();
        document.body.className = theme;
      } catch { document.body.className = 'dark'; }

      try {
        const result = await window.dench.db.query("SELECT name, entry_count FROM objects");
        const container = document.getElementById('cards');
        for (const row of result.rows || []) {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = '<h3>' + row.name + '</h3><div class="value">' + (row.entry_count ?? 0) + '</div>';
          container.appendChild(card);
        }
        if (!result.rows?.length) {
          container.innerHTML = '<p style="opacity:0.5">No objects in workspace yet.</p>';
        }
      } catch (err) {
        document.getElementById('cards').innerHTML =
          '<div class="error">Error loading data: ' + err.message + '</div>';
      }
    }
    init();
  </script>
</body>
</html>
```

---

## DuckDB Data Integration

Apps with the `database` permission can query the workspace DuckDB.

### Common Queries

```javascript
// List all objects (tables)
const objects = await window.dench.db.query("SELECT * FROM objects");

// Get entries from an object by name
const people = await window.dench.db.query(
  "SELECT * FROM entries WHERE object_id = (SELECT id FROM objects WHERE name = 'people')"
);

// Get field definitions
const fields = await window.dench.db.query(
  "SELECT * FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'people')"
);

// Use PIVOT views for tabular display
const data = await window.dench.db.query("SELECT * FROM pivot_people");

// Aggregate queries
const stats = await window.dench.db.query(`
  SELECT
    o.name,
    COUNT(e.id) as count,
    MIN(e.created_at) as earliest,
    MAX(e.created_at) as latest
  FROM objects o
  LEFT JOIN entries e ON e.object_id = o.id
  GROUP BY o.name
  ORDER BY count DESC
`);
```

### Creating App-Specific Tables

Apps can create their own tables for storing app-specific data:

```javascript
await window.dench.db.execute(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

await window.dench.db.execute(
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('theme_preference', 'dark')`
);
```

---

## Creating an App — Step by Step Checklist

When asked to build an app, follow these steps:

1. **Determine the app type** — game (2D/3D), dashboard, tool, visualization, etc.
2. **Choose the right library**:
   - 2D game / simulation / generative art → **p5.js** (always)
   - 3D game / scene / visualization → **Three.js** (always)
   - Data dashboard → **Chart.js** or **plain HTML/CSS**
   - Interactive tool / form → **plain HTML/CSS/JS**
3. **Create the app folder**: `apps/<name>.dench.app/`
4. **Create `.dench.yaml`** with manifest (always include `name`, `entry`, `runtime`)
5. **Create `index.html`** as the entry point with CDN script tags
6. **Create separate JS file(s)** for app logic — avoid massive inline scripts
7. **Apply theme** via `window.dench.app.getTheme()` on init
8. **Handle window resizing** (canvas-based apps must call `resizeCanvas` / update renderer)
9. **Add error handling** for all bridge API calls
10. **Test the app** opens correctly as a tab in DenchClaw
