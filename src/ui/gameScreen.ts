import type { Application, Ticker } from 'pixi.js';
import type { Sounds } from '../audio/sounds';
import { FixedLoop } from '../core/loop';
import { PLAYER_COLORS } from '../game/profiles';
import { LOCAL_PLAYER, type Round } from '../game/round';
import type { WorldEvent } from '../game/world';
import { keyHelp, layoutFor, type Settings } from '../input/bindings';
import { Keyboard } from '../input/keyboard';
import type { GameAssets } from '../render/assets';
import { BaseHud } from '../render/baseHud';
import { WorldView } from '../render/worldView';
import { bigButton, h } from './dom';
import { Hud } from './hud';

export interface GameEnv {
  app: Application;
  assets: GameAssets;
  sounds: Sounds;
  /** Where DOM overlays (HUD, pause menu) go. */
  ui: HTMLElement;
  /** Key bindings and the key help switch. */
  settings: Settings;
}

/** Sounds picked at random, like the original's Blast* and Hurt*. */
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const BLASTS = ['Blast1', 'Blast2', 'Blast3'] as const;
const HURTS = ['Hurt1', 'Hurt2', 'Hurt3'] as const;
const KIMES = ['Kime1', 'Kime2', 'Kime3'] as const;
const PUNCHES = ['Punch1', 'Punch2', 'Punch3'] as const;
const THUNDER = ['Thunder1', 'Thunder2', 'Thunder3'] as const;
const CHOPS = ['Chop1', 'Chop2', 'Chop3', 'Chop4'] as const;
const TREE_DOWN = ['TreeDown1', 'TreeDown2', 'TreeDown3'] as const;
const ROCK_HITS = ['RockHit1', 'RockHit2', 'RockHit3'] as const;
const WOOD_HITS = ['WoodHit1', 'WoodHit2', 'WoodHit3'] as const;
/** The original's DeathAnnounce messages. */
const DEATH_MESSAGES = ['%s is dead.', '%s has\ndeceased.', '%s\nrests in peace.'];
/** How long the round goes on after it's decided before the results show: 3.5 seconds. */
const END_DELAY_TICKS = 126;

/** A round being played: runs the simulation, draws it, and shows the HUD and pause menu. */
export class GameScreen {
  private readonly view: WorldView;
  private readonly keyboard: Keyboard;
  private readonly loop: FixedLoop;
  private readonly hud: Hud;
  /** Building panel (enter, buy, sell) and shop messages, drawn in Pixi. */
  private readonly baseHud: BaseHud;
  private paused = false;
  private pauseEl: HTMLElement | null = null;
  private stopped = false;
  /** Big messages at the top of the screen: eliminations and the end of the round. */
  private readonly announce: HTMLElement;
  /** The tick at which a decided round ends. */
  private endAt = Infinity;
  private readonly onTick = (t: Ticker): void => this.frame(t.deltaMS);
  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.stopped || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
    e.preventDefault();
    if (this.paused) this.resume();
    else this.pause();
  };

  constructor(
    private readonly env: GameEnv,
    readonly round: Round,
    /** Called when the player ends the round. */
    private readonly onEnd: (round: Round) => void,
  ) {
    const { app, assets } = env;
    const color = PLAYER_COLORS[round.profile.color % PLAYER_COLORS.length];
    const colors = new Map(round.players.map((p) => [p.id, p.color]));
    this.view = new WorldView(round.world, assets, (owner) => colors.get(owner) ?? color);
    const lead = this.follow;
    if (lead) {
      this.view.camX = lead.x - app.screen.width / 4;
      this.view.camY = lead.y - app.screen.height / 4;
    }
    app.stage.addChild(this.view.root);

    const style = round.profile.controlStyle;
    const layout = layoutFor(env.settings, style);
    this.keyboard = new Keyboard(style, window, layout);
    // The selected clonks of the crew follow the keys; the world keeps track of who's selected.
    this.loop = new FixedLoop(() => round.world.step(new Map([[LOCAL_PLAYER, this.keyboard.read()]])));
    this.hud = new Hud(env.ui, assets, env.settings.showKeyHelp ? keyHelp(style, layout) : null, {
      onMenu: () => this.pause(),
      // Click picks a clonk, Shift-click adds it to the group or takes it out.
      onCrew: (index, add) => this.keyboard.command(add ? { type: 'toggle', index } : { type: 'pick', index }),
    }, (owner) => colors.get(owner) ?? color);
    this.baseHud = new BaseHud(round.world, assets, LOCAL_PLAYER, style, false, color, layout);
    app.stage.addChild(this.baseHud.root);
    this.announce = h('div', { class: 'announce' });
    env.ui.append(this.announce);
    addEventListener('keydown', this.onKey);
    app.ticker.add(this.onTick);
  }

  /** The clonk the camera and HUD follow: the crew's leader. */
  private get follow() {
    return this.round.world.cursor(LOCAL_PLAYER).leader ?? this.round.crew[0];
  }

  private frame(deltaMs: number): void {
    const { world } = this.round;
    if (!this.paused) this.loop.advance(deltaMs);
    const crew = this.round.crew;
    const cursor = world.cursor(LOCAL_PLAYER);
    this.view.update(this.env.app.screen.width, this.env.app.screen.height, this.follow, world.events, crew.length > 1 ? cursor : undefined);
    for (const e of world.events) {
      if (e.type === 'recruit' && e.clonk.info) {
        const fresh = this.round.recruited.has(e.clonk.info.memberId);
        this.view.say(e.clonk, fresh ? `${e.clonk.info.name}\njoins the crew!` : `${e.clonk.info.name}\nreporting!`);
      } else if (e.type === 'death') {
        this.view.say(e.clonk, pick(DEATH_MESSAGES).replace('%s', e.clonk.info?.name ?? 'Clonk'));
      } else if (e.type === 'eliminated') {
        this.show(e.player === LOCAL_PLAYER ? 'Your crew is out!' : `${this.playerName(e.player)} is eliminated.`);
        if (e.player === LOCAL_PLAYER) this.endSoon();
      } else if (e.type === 'gameOver') {
        this.show(e.winner === LOCAL_PLAYER ? 'Victory!' : e.winner < 0 ? 'Nobody is left standing.' : `${this.playerName(e.winner)} wins.`);
        this.endSoon();
      }
    }
    this.playSounds(world.events);
    world.events.length = 0;
    const lead = this.follow;
    this.hud.update(lead, world.players.get(LOCAL_PLAYER), crew, cursor);
    if (lead) this.baseHud.update(this.env.app.screen.width, this.env.app.screen.height, lead);
    if (world.tick >= this.endAt) this.end();
  }

  private playerName(id: number): string {
    return this.round.players.find((p) => p.id === id)?.name ?? `Player ${id + 1}`;
  }

  private show(text: string): void {
    this.announce.textContent = text;
    this.announce.classList.remove('show');
    void this.announce.offsetWidth;
    this.announce.classList.add('show');
  }

  /** The round is decided: let it play on for a moment, then show the results. */
  private endSoon(): void {
    this.endAt = Math.min(this.endAt, this.round.world.tick + END_DELAY_TICKS);
  }

  private playSounds(events: readonly WorldEvent[]): void {
    const near = this.follow;
    // Quieter the further away from the clonk it happens.
    const volumeAt = (x: number, y: number): number =>
      near ? Math.max(0.15, 1 - Math.hypot(x - near.x, y - near.y) / 500) : 1;
    for (const e of events) {
      if (e.type === 'explosion') this.env.sounds.play(BLASTS[Math.floor(Math.random() * BLASTS.length)], volumeAt(e.x, e.y));
      else if (e.type === 'collect' && e.clonk === near) this.env.sounds.play('Grab', 0.8);
      else if (e.type === 'promotion' || e.type === 'newBase') this.env.sounds.play('Trumpet');
      else if (e.type === 'recruit') this.env.sounds.play('Click', 0.9);
      // Like the original clonk script: a swing sometimes grunts and whooshes,
      // a clonk who takes a blow sometimes cries out, and dying always makes a sound.
      else if (e.type === 'swing') {
        if (Math.random() < 1 / 3) this.env.sounds.play(pick(KIMES), volumeAt(e.clonk.x, e.clonk.y));
        if (Math.random() < 1 / 5) this.env.sounds.play(pick(PUNCHES), volumeAt(e.clonk.x, e.clonk.y));
      } else if (e.type === 'punch' || e.type === 'hit') {
        const c = e.type === 'punch' ? e.target : e.clonk;
        if (c.alive && Math.random() < 1 / 5) this.env.sounds.play(pick(HURTS), volumeAt(c.x, c.y));
      } else if (e.type === 'death') this.env.sounds.play('Die', volumeAt(e.clonk.x, e.clonk.y));
      else if (e.type === 'eliminated') this.env.sounds.play('Eliminated');
      else if (e.type === 'gameOver' && e.winner === LOCAL_PLAYER) this.env.sounds.play('Trumpet');
      else if (e.type === 'construct' || e.type === 'building') {
        const st = e.structure;
        this.env.sounds.play(Math.random() < 0.5 ? 'Build1' : 'Build2', volumeAt(st.x, st.y) * 0.8);
      } else if (e.type === 'built') this.env.sounds.play('Click', volumeAt(e.structure.x, e.structure.y));
      else if (e.type === 'gate') this.env.sounds.play('SteelGate1', volumeAt(e.x, e.y));
      else if (e.type === 'elevator') this.env.sounds.play('Elevator', volumeAt(e.x, e.y) * 0.6);
      else if (e.type === 'click') this.env.sounds.play('Click', volumeAt(e.x, e.y) * 0.7);
      // Thunder comes from the sky above the bolt, so only the distance across counts.
      else if (e.type === 'thunder') this.env.sounds.play(pick(THUNDER), near ? Math.max(0.3, 1 - Math.abs(e.x - near.x) / 800) : 1);
      else if (e.type === 'fuse') this.env.sounds.play('Fuse', volumeAt(e.x, e.y));
      else if (e.type === 'chop') this.env.sounds.play(pick(CHOPS), volumeAt(e.clonk.x, e.clonk.y));
      // Only big trees crash down audibly (Tree.c4d ChopDown: con over 50).
      else if (e.type === 'treeDown' && e.plant.scale > 0.5) this.env.sounds.play(pick(TREE_DOWN), volumeAt(e.plant.x, e.plant.bottom));
      // Big things catch fire with a whoosh (FnFxFireStart: shape over 500), and water hisses as it puts a fire out.
      else if (e.type === 'inflame' && e.loud) this.env.sounds.play('Inflame', volumeAt(e.x, e.y));
      else if (e.type === 'extinguish' && e.hiss) this.env.sounds.play('Pshshsh', volumeAt(e.x, e.y));
      else if (e.type === 'itemHit') {
        const id = e.item.def.id;
        const set = id === 'wood' ? WOOD_HITS : id === 'rock' || id === 'gold' || e.item.def.fuse ? ROCK_HITS : null;
        if (set) this.env.sounds.play(pick(set), volumeAt(e.item.x, e.item.y) * 0.5);
      }
    }
    if (this.paused || this.stopped) {
      this.env.sounds.stopLoops();
      return;
    }
    // Heavy things crackle while they burn (the Fire loop, mass 100 and up): trees and buildings.
    let fire = 0;
    for (const p of this.round.world.plants) if (p.fire) fire = Math.max(fire, volumeAt(p.x, p.bottom));
    for (const st of this.round.world.structures) if (st.fire) fire = Math.max(fire, volumeAt(st.x, st.y));
    this.env.sounds.loop('Fire', fire * 0.7);
    // A burning fuse hisses (the T-flint's Activated action sound).
    let fusing = 0;
    for (const item of this.round.world.items) {
      if (!item.lit || item.removed) continue;
      const at = item.container ?? item;
      fusing = Math.max(fusing, volumeAt(at.x, at.y) * 0.6);
    }
    this.env.sounds.loop('Fusing', fusing);
    const w = this.round.world.weather;
    if (!w) {
      this.env.sounds.loop('Wind', 0);
      this.env.sounds.loop('Earthquake', 0);
      return;
    }
    // The wind howls once it's strong (SoundLevel Wind, |wind| - 30), and earthquakes rumble.
    this.env.sounds.loop('Wind', (Math.max(Math.abs(w.wind) - 30, 0) * 2) / 100);
    let quake = 0;
    for (const q of w.quakes) quake = Math.max(quake, volumeAt(q.x, q.y));
    this.env.sounds.loop('Earthquake', quake);
  }

  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.keyboard.enabled = false;
    this.keyboard.reset();
    this.env.sounds.play('Click', 0.6);
    const keys = h('table', { class: 'keys' });
    const style = this.round.profile.controlStyle;
    for (const [k, a] of keyHelp(style, layoutFor(this.env.settings, style))) keys.append(h('tr', {}, h('td', {}, k), h('td', {}, a)));
    const paper = h(
      'div',
      { class: 'paper', style: { left: '86px', top: '40px' } },
      h(
        'div',
        { class: 'paper-body', style: { top: '50px' } },
        h('h1', {}, 'Paused'),
        h('div', { class: 'sub' }, this.round.scenario.title),
        keys,
        h('p', { style: { textAlign: 'center', marginTop: '14px' } }, 'Ending the round saves what your crew has learned.'),
      ),
    );
    this.pauseEl = h(
      'div',
      { class: 'screen overlay' },
      h(
        'div',
        { class: 'stage' },
        paper,
        bigButton('Continue', 150, 450, () => this.resume()),
        bigButton('End round', 426, 450, () => this.end()),
      ),
    );
    this.env.ui.append(this.pauseEl);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.keyboard.reset();
    this.keyboard.enabled = true;
  }

  /** Stop playing; the last frame stays on screen behind the results. */
  end(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.env.sounds.stopLoops();
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.announce.remove();
    this.env.app.ticker.remove(this.onTick);
    this.keyboard.dispose();
    removeEventListener('keydown', this.onKey);
    this.hud.dispose();
    this.onEnd(this.round);
  }

  /** Remove the world from the screen. */
  dispose(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.env.sounds.stopLoops();
      this.env.app.ticker.remove(this.onTick);
      this.keyboard.dispose();
      removeEventListener('keydown', this.onKey);
      this.hud.dispose();
      this.pauseEl?.remove();
      this.announce.remove();
    }
    this.view.destroy();
    this.baseHud.root.destroy({ children: true });
  }
}
