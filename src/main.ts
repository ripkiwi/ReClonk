// Pixi normally compiles shaders/uniform code with eval; the site's CSP forbids that,
// so use Pixi's eval-free code paths instead.
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { FixedLoop } from './core/loop';
import { setupDefaultBases } from './game/homeBase';
import { World } from './game/world';
import { Keyboard } from './input/keyboard';
import { generateMap } from './landscape/generate';
import { MATERIALS } from './landscape/materials';
import { FLAG, ITEMS, STRUCTURES } from './objects/defs';
import { frame, loadAssets } from './render/assets';
import { BaseHud } from './render/baseHud';
import { WorldView } from './render/worldView';

const WORLD_W = 1400;
const WORLD_H = 640;

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? 1337) >>> 0;

  const app = new Application();
  await app.init({ resizeTo: window, background: '#9fc8ef', antialias: false, roundPixels: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const assets = await loadAssets(
    MATERIALS.map((m) => m.texture).concat('SMOOTH2'),
    [
      ...Object.values(ITEMS).map((i) => i.graphic.file),
      ...Object.values(STRUCTURES).map((s) => s.graphic.file),
      FLAG.graphic.file,
      FLAG.graphic.overlay,
    ],
  );

  const map = generateMap(WORLD_W, WORLD_H, seed);
  const world = World.fromMap(map, seed);
  const player = 0;
  // Default scenario: start next to your own wooden hut with your flag on it.
  const { home } = setupDefaultBases(world, player, map.spawn.x);
  const start = home.exitPoint();
  const clonk = world.addClonk(start.x, start.y, player);
  // Start with a flint in hand, like a classic starting kit.
  const flint = world.spawnItem('flint', clonk.x, clonk.y);
  flint.container = clonk;
  clonk.contents.push(flint);

  const view = new WorldView(world, assets);
  view.camX = clonk.x - app.screen.width / 4;
  view.camY = clonk.y - app.screen.height / 4;
  app.stage.addChild(view.root);

  // HUD: what the clonk is carrying, and the controls.
  const hud = new Container();
  const panel = new Graphics();
  const slot = new Sprite();
  slot.scale.set(4);
  const label = new Text({ text: '', style: { fill: '#ffffff', fontSize: 16, fontFamily: 'monospace', stroke: { color: '#000000', width: 3 } } });
  const help = new Text({
    text: 'A/D or ←/→ walk · W/↑/Space jump, climb, enter doors · S/↓ dig (hold, steer with arrows) · Q/E throw',
    style: { fill: '#ffffff', fontSize: 14, fontFamily: 'monospace', stroke: { color: '#000000', width: 3 } },
  });
  hud.addChild(panel, slot, label, help);
  const baseHud = new BaseHud(world, assets, player);
  hud.addChild(baseHud.root);
  app.stage.addChild(hud);

  const keyboard = new Keyboard();
  const loop = new FixedLoop(() => world.step(new Map([[player, keyboard.read()]])));

  app.ticker.add((ticker) => {
    loop.advance(ticker.deltaMS);
    view.update(app.screen.width, app.screen.height, clonk);

    const item = clonk.carrying;
    panel.clear().roundRect(10, 10, 44, 44, 6).fill({ color: 0x000000, alpha: 0.45 }).stroke({ color: 0xffffff, alpha: 0.6, width: 2 });
    slot.visible = !!item;
    if (item) {
      const g = item.def.graphic;
      slot.texture = frame(assets.items[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h);
      slot.position.set(20, 20);
    }
    label.text = item ? item.def.name : 'empty hands';
    label.position.set(62, 22);
    help.position.set(10, app.screen.height - 26);
    baseHud.update(app.screen.width, app.screen.height, clonk);
  });
}

void start();
