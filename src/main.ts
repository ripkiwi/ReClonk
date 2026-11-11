// Pixi normally compiles shaders/uniform code with eval; the site's CSP forbids that,
// so use Pixi's eval-free code paths instead.
import 'pixi.js/unsafe-eval';
import './ui/menu.css';
import { Application } from 'pixi.js';
import { Music } from './audio/music';
import { Sounds } from './audio/sounds';
import { applyRoundResults, loadProfiles, saveProfiles, type KeyValueStore, type Profile } from './game/profiles';
import { newSeed, roundResults, startRound, type Round } from './game/round';
import type { ScenarioDef } from './game/scenarios';
import { loadSettings, setKeyLabels } from './input/bindings';
import { TEXMAP, TUNNEL } from './landscape/materials';
import { ELEVATOR_CASE, FLAG, ITEMS, STRUCTURES } from './objects/defs';
import { GRASS, PLANTS } from './objects/vegetation';
import { CONTENT_BASE, loadAssets } from './render/assets';
import { FIRE_PARTICLES } from './render/fireView';
import { fitStage, h, setCssImages } from './ui/dom';
import { GameScreen } from './ui/gameScreen';
import { Menu, type CrewOutcome } from './ui/menu';

/** The original's font, used for titles, buttons and in-game messages. */
async function loadFont(): Promise<void> {
  try {
    const font = new FontFace('Endeavour', `url("${CONTENT_BASE}fonts/Endeavour.ttf")`);
    document.fonts.add(await font.load());
  } catch {
    // Fall back to the serif fonts in the stylesheet.
  }
}

/** Clonk names to hire from, one per line (the original's Names.txt). */
async function loadNames(): Promise<string[]> {
  try {
    const res = await fetch(`${CONTENT_BASE}Names.txt`);
    if (!res.ok) return [];
    return (await res.text())
      .split(/\r?\n/)
      .map((n) => n.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** localStorage, or a throwaway in-memory store if the browser blocks it. */
function storage(): KeyValueStore {
  try {
    localStorage.setItem('reclonk.test', '1');
    localStorage.removeItem('reclonk.test');
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

/** Name keys the way this keyboard labels them (Chrome and Edge only), e.g. Y and Z on a German one. */
async function keyboardLabels(): Promise<void> {
  try {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } }).keyboard;
    if (kb) setKeyLabels(await kb.getLayoutMap());
  } catch {
    // Not allowed or not supported: keep the plain names.
  }
}

async function start(): Promise<void> {
  const ui = document.getElementById('ui')!;
  setCssImages();
  fitStage();
  const loading = h('div', { class: 'screen' }, h('div', { class: 'loading' }, 'Loading…'));
  ui.append(loading);

  const app = new Application();
  await app.init({ resizeTo: window, background: '#9fc8ef', antialias: false, roundPixels: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const sounds = new Sounds();
  const [assets, names] = await Promise.all([
    loadAssets(
      TEXMAP.map((t) => t.texture).concat(TUNNEL.texture),
      [
        ...Object.values(ITEMS).map((i) => i.graphic.file),
        ...Object.values(STRUCTURES).flatMap((s) => [
          s.graphic.file,
          s.burned.file,
          ...(s.basement ? [s.basement.file] : []),
          ...(s.gates ?? []).map((g) => g.file),
          ...(s.elevator ? [ELEVATOR_CASE.file] : []),
        ]),
        FLAG.graphic.file,
        FLAG.graphic.overlay,
        ...Object.values(PLANTS).flatMap((p) => [p.file, p.burned.file]),
        GRASS.file,
        FIRE_PARTICLES.fire.file,
        FIRE_PARTICLES.fire2.file,
      ],
    ),
    loadNames(),
    loadFont(),
    sounds.load(),
  ]);
  // Browsers only allow sound after the player has clicked or pressed a key.
  const store = storage();
  const profiles = loadProfiles(store);
  const settings = loadSettings(store);
  const music = new Music(settings.music);
  for (const ev of ['pointerdown', 'keydown'] as const) {
    addEventListener(
      ev,
      () => {
        sounds.unlock();
        music.unlock();
      },
      { capture: true },
    );
  }
  void keyboardLabels();
  let game: GameScreen | null = null;
  // For poking at a running game from the browser console while developing.
  if (import.meta.env.DEV) Object.assign(window, { reclonk: { game: () => game } });

  const play = (scenario: ScenarioDef, profile: Profile): void => {
    music.game();
    game = new GameScreen({ app, assets, sounds, ui, settings }, startRound(scenario, profile, names, scenario.newMapEachRound ? newSeed() : scenario.seed), finish);
  };

  const finish = (round: Round): void => {
    const { profile } = round;
    const results = roundResults(round);
    const before = new Map(profile.crew.map((m) => [m.id, { experience: m.experience, rank: m.rank }]));
    applyRoundResults(profile, results);
    saveProfiles(store, profiles);
    const dead = new Set(round.crew.filter((c) => !c.alive).map((c) => c.info?.memberId));
    const outcomes: CrewOutcome[] = results.flatMap((result) => {
      const member = profile.crew.find((m) => m.id === result.memberId);
      const was = before.get(result.memberId);
      return member && was
        ? [{ member, result, before: was, died: dead.has(member.id), isNew: round.recruited.has(member.id) }]
        : [];
    });
    const close = (): void => {
      game?.dispose();
      game = null;
    };
    menu.showResults(round, outcomes, {
      again: () => {
        close();
        menu.hide();
        play(round.scenario, profile);
      },
      menu: () => {
        close();
        music.menu();
        menu.show('main');
      },
    });
  };

  const menu = new Menu({ root: ui, sounds, music, storage: store, store: profiles, settings, names, onPlay: play });
  loading.remove();
  music.menu();
  menu.show('main');
}

void start();
