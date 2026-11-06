import { rankName } from '../game/ranks';
import type { PlayerState } from '../game/world';
import { KEY_HELP } from '../input/keyboard';
import type { Clonk, ControlStyle } from '../objects/clonk';
import { CLONK, ENERGY_UNIT, ITEMS } from '../objects/defs';
import type { GameAssets } from '../render/assets';
import { drawItem, expProgress, h, portrait, rankBadge } from './dom';

/** Seconds before the key help fades back. */
const HELP_SECONDS = 25;

/**
 * The in-game overlay: the selected clonk's portrait, name, rank and experience,
 * what it carries, a menu button and the key help.
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly name: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly expText: HTMLElement;
  private readonly slot: HTMLCanvasElement;
  private readonly energy: HTMLElement;
  private readonly energyText: HTMLElement;
  private readonly wealth: HTMLElement;
  private readonly wealthText: HTMLElement;
  private readonly help: HTMLElement;
  private shown = {
    rank: -1,
    exp: -1,
    item: '' as string | undefined,
    clonk: null as Clonk | null,
    energy: -1,
    wealth: -1,
  };

  constructor(
    root: HTMLElement,
    private readonly assets: GameAssets,
    style: ControlStyle,
    onMenu: () => void,
  ) {
    this.portrait = portrait(1);
    this.name = h('div', { class: 'crew-name' });
    this.rank = h('div', { class: 'crew-rank' });
    this.fill = h('div');
    this.expText = h('div', { class: 'exp-text' });
    this.slot = h('canvas', { width: 32, height: 32 });
    this.energy = h('div');
    this.energyText = h('span');
    this.wealthText = h('span');
    const coin = h('canvas', { width: 16, height: 16 });
    drawItem(coin, ITEMS.gold, assets);
    this.wealth = h('div', { class: 'hud-wealth', title: 'Gold' }, coin, this.wealthText);
    this.help = h('div', { class: 'hud-help' });
    for (const [keys, action] of KEY_HELP[style]) this.help.append(h('b', {}, keys), ` ${action}   `);
    this.el = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-crew' },
        this.portrait,
        h(
          'div',
          { class: 'crew-info' },
          this.name,
          this.rank,
          h('div', { class: 'exp' }, this.fill),
          this.expText,
          h('div', { class: 'hud-energy', title: 'Energy' }, h('div', { class: 'bar' }, this.energy), this.energyText),
        ),
        h('div', { class: 'hud-side' }, h('div', { class: 'hud-slot', title: 'Carrying' }, this.slot), this.wealth),
      ),
      h('button', { class: 'hud-menu', onclick: onMenu }, 'Menu (Esc)'),
      this.help,
    );
    root.append(this.el);
    setTimeout(() => this.help.classList.add('faded'), HELP_SECONDS * 1000);
  }

  /** Bring the HUD up to date. Only touches the DOM when something changed. */
  update(c: Clonk | undefined, player?: PlayerState): void {
    const s = this.shown;
    const info = c?.info;
    if (c !== s.clonk) {
      s.clonk = c ?? null;
      this.portrait.src = portrait(info?.portrait ?? 1).src;
      this.name.textContent = info?.name ?? 'Clonk';
      s.rank = s.exp = -1;
    }
    const rank = info?.rank ?? 0;
    if (rank !== s.rank) {
      s.rank = rank;
      this.rank.replaceChildren(rankBadge(rank), rankName(rank));
    }
    const exp = info?.experience ?? 0;
    if (exp !== s.exp) {
      s.exp = exp;
      const p = expProgress(exp);
      this.fill.style.width = `${(p.fraction * 100).toFixed(1)}%`;
      this.expText.textContent = p.label;
    }
    const energy = c?.alive ? c.energy : 0;
    if (energy !== s.energy) {
      s.energy = energy;
      const frac = energy / CLONK.energy;
      this.energy.style.width = `${(frac * 100).toFixed(1)}%`;
      this.energy.classList.toggle('low', frac <= 0.3);
      this.energyText.textContent = c && !c.alive ? 'dead' : String(Math.ceil(energy / ENERGY_UNIT));
    }
    const wealth = player ? player.wealth : -1;
    if (wealth !== s.wealth) {
      s.wealth = wealth;
      this.wealth.style.display = player ? '' : 'none';
      this.wealthText.textContent = String(wealth);
    }
    const item = c?.carrying?.def.id;
    if (item !== s.item) {
      s.item = item;
      drawItem(this.slot, c?.carrying?.def, this.assets);
      this.slot.parentElement!.title = c?.carrying ? `Carrying ${c.carrying.def.name}` : 'Empty hands';
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
