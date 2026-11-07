import { rankName } from '../game/ranks';
import type { CrewCursor, PlayerState } from '../game/world';
import { KEY_HELP } from '../input/keyboard';
import type { Clonk, ControlStyle } from '../objects/clonk';
import { CLONK, ENERGY_UNIT, ITEMS } from '../objects/defs';
import type { GameAssets } from '../render/assets';
import { drawItem, expProgress, h, portrait, rankBadge } from './dom';

/** Seconds before the key help fades back. */
const HELP_SECONDS = 25;

export interface HudActions {
  onMenu(): void;
  /** A crew bar portrait was clicked; `add` with Shift held. */
  onCrew(index: number, add: boolean): void;
}

/** One clonk in the crew bar. */
interface CrewCell {
  el: HTMLButtonElement;
  img: HTMLImageElement;
  energy: HTMLElement;
  /** What the cell was last drawn with. */
  key: string;
}

/**
 * The in-game overlay: the leader's portrait, name, rank and experience,
 * what it carries, the crew bar, a menu button and the key help.
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
  /** Portraits of every clonk in the round, to switch between them. Hidden with only one. */
  private readonly crewBar: HTMLElement;
  private cells: CrewCell[] = [];
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
    private readonly actions: HudActions,
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
    this.crewBar = h('div', { class: 'hud-crewbar' });
    for (const [keys, action] of KEY_HELP[style]) this.help.append(h('span', {}, h('b', {}, keys), ` ${action}`));
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
      this.crewBar,
      h('button', { class: 'hud-menu', onclick: () => actions.onMenu() }, 'Menu (Esc)'),
      this.help,
    );
    root.append(this.el);
    setTimeout(() => this.help.classList.add('faded'), HELP_SECONDS * 1000);
  }

  /** Bring the HUD up to date. Only touches the DOM when something changed. */
  update(c: Clonk | undefined, player?: PlayerState, crew: readonly Clonk[] = [], cursor?: CrewCursor): void {
    this.updateCrewBar(crew, cursor);
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
      const frac = energy / (c?.maxEnergy ?? CLONK.energy);
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

  /** The crew bar: one portrait per clonk, the leader and the selected ones marked. */
  private updateCrewBar(crew: readonly Clonk[], cursor?: CrewCursor): void {
    const show = crew.length > 1;
    this.crewBar.style.display = show ? '' : 'none';
    if (!show) return;
    while (this.cells.length < crew.length) {
      const index = this.cells.length;
      const img = portrait(1);
      const energy = h('div');
      const el = h(
        'button',
        { class: 'crew-cell', onclick: (e: MouseEvent) => this.actions.onCrew(index, e.shiftKey) },
        img,
        index < 9 ? h('span', { class: 'crew-key' }, String(index + 1)) : null,
        h('div', { class: 'mini-energy' }, energy),
      );
      this.crewBar.append(el);
      this.cells.push({ el, img, energy, key: '' });
    }
    crew.forEach((c, i) => {
      const cell = this.cells[i];
      const info = c.info;
      const state = !c.alive ? 'dead' : cursor?.leader === c ? 'leader' : cursor?.selected.has(c) ? 'selected' : '';
      const energy = c.alive ? Math.ceil((c.energy / c.maxEnergy) * 20) : 0;
      const key = `${info?.memberId}:${info?.rank}:${state}:${energy}:${!!c.contained}`;
      if (key === cell.key) return;
      cell.key = key;
      cell.img.src = portrait(info?.portrait ?? 1).src;
      cell.el.className = `crew-cell ${state}`;
      cell.energy.style.width = `${energy * 5}%`;
      cell.energy.classList.toggle('low', energy <= 6);
      const name = info ? `${rankName(info.rank)} ${info.name}` : 'Clonk';
      const where = !c.alive ? ' (dead)' : c.contained ? ` (in the ${c.contained.def.name})` : '';
      cell.el.title = `${name}${where}\nClick to control, Shift-click to add to the group`;
    });
  }

  dispose(): void {
    this.el.remove();
  }
}
