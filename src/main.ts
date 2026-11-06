// Pixi normally compiles shaders/uniform code with eval; the site's CSP forbids that,
// so use Pixi's eval-free code paths instead.
import 'pixi.js/unsafe-eval';
import { Application, Text } from 'pixi.js';
import { FixedLoop } from './core/loop';
import { Rng } from './core/rng';
import { generateLandscape } from './landscape/generate';
import { MATERIALS, Mat } from './landscape/materials';
import { LandscapeView } from './render/landscapeView';

const WORLD_W = 480;
const WORLD_H = 270;
const SEED = 1337;

const BRUSHES: { key: string; label: string; mat: Mat | 'dig' }[] = [
  { key: '1', label: 'Dig', mat: 'dig' },
  { key: '2', label: 'Sand', mat: Mat.Sand },
  { key: '3', label: 'Water', mat: Mat.Water },
  { key: '4', label: 'Earth', mat: Mat.Earth },
];

async function start(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: '#000000', antialias: false });
  document.getElementById('app')!.appendChild(app.canvas);

  const land = generateLandscape(WORLD_W, WORLD_H, SEED);
  const rng = new Rng(SEED ^ 0x5eed);
  const view = new LandscapeView(land);
  app.stage.addChild(view.sprite);

  const hud = new Text({ text: '', style: { fill: '#ffffff', fontSize: 16, fontFamily: 'monospace' } });
  hud.position.set(10, 8);
  app.stage.addChild(hud);

  let brush = 0;
  let goldDug = 0;
  let pointer: { x: number; y: number } | null = null;

  const layout = (): void => {
    const scale = Math.max(1, Math.floor(Math.min(app.screen.width / WORLD_W, app.screen.height / WORLD_H)));
    view.sprite.scale.set(scale);
    view.sprite.position.set(
      Math.floor((app.screen.width - WORLD_W * scale) / 2),
      Math.floor((app.screen.height - WORLD_H * scale) / 2),
    );
  };
  layout();
  app.renderer.on('resize', layout);

  const toWorld = (e: PointerEvent): { x: number; y: number } => ({
    x: Math.floor((e.offsetX - view.sprite.x) / view.sprite.scale.x),
    y: Math.floor((e.offsetY - view.sprite.y) / view.sprite.scale.y),
  });
  app.canvas.addEventListener('pointerdown', (e) => (pointer = toWorld(e)));
  app.canvas.addEventListener('pointermove', (e) => {
    if (pointer) pointer = toWorld(e);
  });
  window.addEventListener('pointerup', () => (pointer = null));
  window.addEventListener('keydown', (e) => {
    const i = BRUSHES.findIndex((b) => b.key === e.key);
    if (i >= 0) brush = i;
  });

  // Input is applied inside the tick so the simulation stays deterministic.
  const loop = new FixedLoop((tick) => {
    if (pointer) {
      const b = BRUSHES[brush].mat;
      if (b === 'dig') goldDug += land.dig(pointer.x, pointer.y, 6).get(Mat.Gold) ?? 0;
      else land.paint(pointer.x, pointer.y, 4, b);
    }
    land.step(tick, rng);
  });

  app.ticker.add((ticker) => {
    loop.advance(ticker.deltaMS);
    view.update();
    const brushes = BRUSHES.map((b, i) => (i === brush ? `[${b.key} ${b.label}]` : ` ${b.key} ${b.label} `)).join(' ');
    hud.text = `ReClonk sandbox   ${brushes}   gold dug: ${goldDug} px   (${MATERIALS.length} materials)`;
  });
}

void start();
