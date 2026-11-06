import type { Application, Ticker } from 'pixi.js';
import type { Sounds } from '../audio/sounds';
import { FixedLoop } from '../core/loop';
import { PLAYER_COLORS } from '../game/profiles';
import { LOCAL_PLAYER, type Round } from '../game/round';
import type { WorldEvent } from '../game/world';
import { Keyboard, KEY_HELP } from '../input/keyboard';
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
}

/** Explosion sounds, picked at random like the original's Blast* sounds. */
const BLASTS = ['Blast1', 'Blast2', 'Blast3'] as const;

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
    this.view = new WorldView(round.world, assets, () => color);
    const lead = this.follow;
    if (lead) {
      this.view.camX = lead.x - app.screen.width / 4;
      this.view.camY = lead.y - app.screen.height / 4;
    }
    app.stage.addChild(this.view.root);

    this.keyboard = new Keyboard(round.profile.controlStyle);
    // The selected clonks of the crew follow the keys; the world keeps track of who's selected.
    this.loop = new FixedLoop(() => round.world.step(new Map([[LOCAL_PLAYER, this.keyboard.read()]])));
    this.hud = new Hud(env.ui, assets, round.profile.controlStyle, {
      onMenu: () => this.pause(),
      // Click picks a clonk, Shift-click adds it to the group or takes it out.
      onCrew: (index, add) => this.keyboard.command(add ? { type: 'toggle', index } : { type: 'pick', index }),
    });
    this.baseHud = new BaseHud(round.world, assets, LOCAL_PLAYER, round.profile.controlStyle, false, color);
    app.stage.addChild(this.baseHud.root);
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
      }
    }
    this.playSounds(world.events);
    world.events.length = 0;
    const lead = this.follow;
    this.hud.update(lead, world.players.get(LOCAL_PLAYER), crew, cursor);
    if (lead) this.baseHud.update(this.env.app.screen.width, this.env.app.screen.height, lead);
  }

  private playSounds(events: readonly WorldEvent[]): void {
    const near = this.follow;
    // Quieter the further away from the clonk it happens.
    const volumeAt = (x: number, y: number): number =>
      near ? Math.max(0.15, 1 - Math.hypot(x - near.x, y - near.y) / 500) : 1;
    for (const e of events) {
      if (e.type === 'explosion') this.env.sounds.play(BLASTS[Math.floor(Math.random() * BLASTS.length)], volumeAt(e.x, e.y));
      else if (e.type === 'collect' && e.clonk === near) this.env.sounds.play('Grab', 0.8);
      else if (e.type === 'promotion') this.env.sounds.play('Trumpet');
      else if (e.type === 'recruit') this.env.sounds.play('Click', 0.9);
    }
  }

  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.keyboard.enabled = false;
    this.keyboard.reset();
    this.env.sounds.play('Click', 0.6);
    const keys = h('table', { class: 'keys' });
    for (const [k, a] of KEY_HELP[this.round.profile.controlStyle]) keys.append(h('tr', {}, h('td', {}, k), h('td', {}, a)));
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
    this.pauseEl?.remove();
    this.pauseEl = null;
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
      this.env.app.ticker.remove(this.onTick);
      this.keyboard.dispose();
      removeEventListener('keydown', this.onKey);
      this.hud.dispose();
      this.pauseEl?.remove();
    }
    this.view.destroy();
    this.baseHud.root.destroy({ children: true });
  }
}
