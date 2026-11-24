import { activeGoals, goalProgress, goalStatus, GOALS } from '../game/goals';
import { RULES } from '../game/rules';
import type { World } from '../game/world';
import { CONTENT_BASE } from '../render/assets';
import { h } from './dom';

/** Seconds a goal's message stays up. */
const MESSAGE_SECONDS = 8;

/**
 * The round's goals and rules as pictures under the menu button, like the
 * original's goal and rule objects: click a goal to read how far along it is
 * (its Activate message window), a rule to read what it does. Release Clonk
 * releases the clonk you control.
 */
export class GoalBar {
  readonly el: HTMLElement;
  private readonly message: HTMLElement;
  private readonly progress = new Map<string, HTMLElement>();
  private timer = 0;
  private lastUpdate = -1;

  constructor(
    root: HTMLElement,
    private readonly world: World,
    private readonly player: number,
  ) {
    const icon = (file: string): HTMLElement => h('img', { src: `${CONTENT_BASE}${file}`, alt: '', draggable: false });
    const buttons: HTMLElement[] = [];
    for (const id of activeGoals(world)) {
      const count = h('span', { class: 'goal-progress' });
      this.progress.set(id, count);
      const n = world.goals[id] ?? 1;
      const name = GOALS[id].count ? `${GOALS[id].name} (${GOALS[id].count!(n)})` : GOALS[id].name;
      buttons.push(
        h('button', { class: 'goal-icon', title: name, onclick: () => this.say(`${name}\n${goalStatus(world, id, player)}`) }, icon(GOALS[id].icon), count),
      );
    }
    for (const id of world.rules) {
      const r = RULES[id];
      const release = id === 'releaseClonk';
      buttons.push(
        h(
          'button',
          {
            class: `goal-icon rule${release ? ' action' : ''}`,
            title: release ? 'Release Clonk: let the clonk you control go' : r.name,
            onclick: () => {
              if (!release) return this.say(`${r.name}\n${r.description}`);
              const c = world.releaseClonk(player);
              if (!c) this.say('Release Clonk\nThere is no clonk to release.');
            },
          },
          icon(r.icon),
        ),
      );
    }
    this.message = h('div', { class: 'goal-message' });
    this.message.addEventListener('click', () => this.message.classList.remove('show'));
    this.el = h('div', { class: 'goal-bar' }, ...buttons);
    if (buttons.length) root.append(this.el, this.message);
  }

  /** Bring the progress counts up to date, about twice a second. */
  update(): void {
    const w = this.world;
    if (w.tick - this.lastUpdate < 18 && this.lastUpdate >= 0) return;
    this.lastUpdate = w.tick;
    for (const [id, el] of this.progress) {
      const text = goalProgress(w, id as keyof typeof GOALS, this.player);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  private say(text: string): void {
    this.message.textContent = text;
    this.message.classList.add('show');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.message.classList.remove('show'), MESSAGE_SECONDS * 1000);
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.el.remove();
    this.message.remove();
  }
}
