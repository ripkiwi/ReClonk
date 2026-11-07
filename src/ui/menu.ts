import type { Sounds } from '../audio/sounds';
import {
  activeProfile,
  createProfile,
  crewForRound,
  deleteProfile,
  hireClonk,
  PLAYER_COLORS,
  ROUND_BONUS,
  saveProfiles,
  type ControlStyle,
  type CrewMember,
  type CrewResult,
  type KeyValueStore,
  type Profile,
  type ProfileStore,
} from '../game/profiles';
import { rankName } from '../game/ranks';
import { LOCAL_PLAYER, type Round } from '../game/round';
import { deleteScenario, loadScenarios, saveEdit, saveScenarios } from '../game/scenarioStore';
import { isOriginal, landscapeSize, SCENARIOS, scenarioById, type ScenarioDef } from '../game/scenarios';
import { keyHelp, layoutFor, saveSettings, type Settings } from '../input/bindings';
import { bigButton, expBar, expProgress, h, portrait, rankBadge } from './dom';
import { scenarioPreview } from './preview';
import { gameSettings } from './gameSettings';
import { scenarioSettings } from './scenarioSettings';

export type MenuScreen = 'main' | 'players' | 'scenarios' | 'settings' | 'options' | 'credits';

export interface MenuOptions {
  root: HTMLElement;
  sounds: Sounds;
  storage: KeyValueStore;
  store: ProfileStore;
  /** Game settings: key bindings and the in-game key help. */
  settings: Settings;
  /** Clonk names to hire from (the original's Names.txt). */
  names: readonly string[];
  onPlay(scenario: ScenarioDef, profile: Profile): void;
}

/** What the results screen shows for one crew member. */
export interface CrewOutcome {
  member: CrewMember;
  result: CrewResult;
  /** Experience and rank before the round. */
  before: { experience: number; rank: number };
  /** Lost all energy during the round. */
  died: boolean;
  /** Joined the crew during this round. */
  isNew: boolean;
}

/** The largest crew a player can hire from the menu. */
const MAX_CREW = 12;

const CTRL_STYLES: { style: ControlStyle; title: string; text: string; row: number }[] = [
  { style: 'jumpAndRun', title: "Jump'n'Run", text: 'hold a key to walk', row: 1 },
  { style: 'classic', title: 'Classic', text: 'tap to start, tap to stop', row: 0 },
];

/** The results title: won or lost when crews fought it out, otherwise just "Round over". */
function roundVerdict(round: Round): { title: string; text: string } {
  const { world, players } = round;
  const name = (id: number): string => players.find((p) => p.id === id)?.name ?? 'Someone';
  if (world.winner === LOCAL_PLAYER) return { title: 'Victory!', text: 'Last crew standing · ' };
  if (world.winner !== null && world.winner >= 0) return { title: 'Defeat', text: `${name(world.winner)} won · ` };
  if (world.winner === -1) return { title: 'Round over', text: 'Nobody is left standing · ' };
  if (world.eliminated.has(LOCAL_PLAYER)) return { title: 'Defeat', text: 'Your crew is out · ' };
  return { title: 'Round over', text: '' };
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The startup menus: main menu, players and crews, the scenario book, credits,
 * and the round results. Plain DOM over the game canvas.
 */
export class Menu {
  private el: HTMLElement | null = null;
  private scenarioId = SCENARIOS[0].id;
  /** The player's own scenarios: edited copies of the originals. */
  private readonly own: ScenarioDef[];
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || !this.el || !this.back) return;
    e.preventDefault();
    this.back();
  };
  /** Where Escape goes on the current screen. */
  private back: (() => void) | null = null;

  constructor(private readonly o: MenuOptions) {
    this.own = loadScenarios(o.storage);
    addEventListener('keydown', this.onKey);
  }

  /** The scenario selected in the scenario book. */
  private get scenario(): ScenarioDef {
    return scenarioById(this.scenarioId, this.own) ?? SCENARIOS[0];
  }

  get visible(): boolean {
    return this.el !== null;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.back = null;
  }

  show(screen: MenuScreen): void {
    switch (screen) {
      case 'main':
        return this.mount(this.mainScreen(), 'bg-main', null);
      case 'players':
        return this.mount(this.playersScreen(), 'bg-players', () => this.go('main'));
      case 'scenarios':
        return this.mount(this.scenarioScreen(), 'bg-scenarios', () => this.go('main'));
      case 'settings':
        return this.mount(this.settingsScreen(), 'bg-main', () => this.go('scenarios'));
      case 'options':
        return this.mount(this.optionsScreen(), 'bg-main', () => this.go('main'));
      case 'credits':
        return this.mount(this.creditsScreen(), 'bg-main', () => this.go('main'));
    }
  }

  private go(screen: MenuScreen): void {
    this.o.sounds.play('Click', 0.6);
    this.show(screen);
  }

  private save(): void {
    saveProfiles(this.o.storage, this.o.store);
  }

  /** Replace whatever is showing with a new screen on a scaled 800×600 stage. */
  private mount(content: HTMLElement[], bg: string, back: (() => void) | null, overlay = false): void {
    const stage = h('div', { class: `stage ${overlay ? '' : bg}` }, ...content);
    const screen = h('div', { class: overlay ? 'screen overlay' : 'screen' });
    if (!overlay) screen.append(h('div', { class: `backdrop ${bg}` }));
    screen.append(stage);
    this.el?.remove();
    this.o.root.append(screen);
    this.el = screen;
    this.back = back;
  }

  // ------------------------------------------------------------ main menu

  private mainScreen(): HTMLElement[] {
    const profile = activeProfile(this.o.store);
    const lead = profile && crewForRound(profile, 1)[0];
    return [
      h('div', { class: 'game-title' }, 'ReClonk'),
      h('div', { class: 'game-subtitle' }, 'Dig, blast and mine for gold'),
      bigButton('Start game', 540, 300, () => this.go(profile ? 'scenarios' : 'players')),
      bigButton('Players', 540, 350, () => this.go('players')),
      bigButton('Settings', 540, 400, () => this.go('options')),
      bigButton('Credits', 540, 450, () => this.go('credits')),
      h(
        'div',
        { class: 'main-player' },
        profile
          ? h('span', {}, 'Playing as ', h('b', {}, profile.name), lead ? ` with ${rankName(lead.rank)} ${lead.name}` : ' with a new recruit')
          : 'Create a player to start',
      ),
      h('div', { class: 'footnote' }, "A free fan remake. 'Clonk' is a registered trademark of Matthes Bender."),
    ];
  }

  // -------------------------------------------------------------- players

  private playersScreen(): HTMLElement[] {
    const store = this.o.store;
    const profile = activeProfile(store);
    const rerender = (): void => this.show('players');

    const list = h('ul', { class: 'list', style: { maxHeight: '98px' } });
    for (const p of store.profiles) {
      list.append(
        h(
          'li',
          {
            class: p === profile ? 'selected' : '',
            onclick: () => {
              store.activeId = p.id;
              this.save();
              this.o.sounds.play('Click', 0.5);
              rerender();
            },
          },
          h('span', { class: 'swatch', style: { background: hex(PLAYER_COLORS[p.color % PLAYER_COLORS.length]) } }),
          h('span', { class: 'profile-name', style: { flex: '1' } }, p.name),
          h('span', { class: 'hint' }, plural(p.rounds, 'round')),
        ),
      );
    }
    if (!store.profiles.length) list.append(h('li', { class: 'hint' }, 'No players yet.'));

    const newPlayer = (): void => {
      createProfile(store, `Player ${store.profiles.length + 1}`);
      this.save();
      this.o.sounds.play('Click', 0.6);
      rerender();
      const input = this.el?.querySelector<HTMLInputElement>('.name-input');
      input?.focus();
      input?.select();
    };

    const left = h(
      'div',
      { class: 'parchment', style: { left: '72px', top: '214px', width: '272px', height: '316px' } },
      h('h2', {}, 'Players'),
      list,
      h('div', { style: { margin: '4px 0 2px' } }, h('button', { class: 'ink-button', onclick: newPlayer }, '+ New player')),
    );

    if (profile) {
      const name = h('input', {
        class: 'name-input',
        value: profile.name,
        maxLength: 24,
        spellcheck: false,
        oninput: (e: Event) => {
          profile.name = (e.target as HTMLInputElement).value.trim() || 'Player';
          this.save();
          const row = list.querySelector('li.selected .profile-name');
          if (row) row.textContent = profile.name;
          const crewTitle = this.el?.querySelector('.crew-title');
          if (crewTitle) crewTitle.textContent = `Crew of ${profile.name}`;
        },
      });
      const colors = h('span', {});
      PLAYER_COLORS.forEach((c, i) =>
        colors.append(
          h('button', {
            class: `swatch swatch-button${profile.color === i ? ' selected' : ''}`,
            style: { background: hex(c) },
            title: 'Shirt colour',
            onclick: () => {
              profile.color = i;
              this.save();
              this.o.sounds.play('Click', 0.5);
              rerender();
            },
          }),
        ),
      );
      const tiles = h('div', { class: 'ctrl-tiles' });
      for (const s of CTRL_STYLES) {
        const on = profile.controlStyle === s.style;
        tiles.append(
          h(
            'button',
            {
              class: `ctrl-tile${on ? ' selected' : ''}`,
              title: keyHelp(s.style, layoutFor(this.o.settings, s.style)).map(([k, a]) => `${k}: ${a}`).join('\n'),
              onclick: () => {
                profile.controlStyle = s.style;
                this.save();
                this.o.sounds.play('Click', 0.5);
                rerender();
              },
            },
            h('div', { class: 'ctrl-icon', style: { backgroundPosition: `${on ? -128 : 0}px ${-s.row * 51}px` } }),
            h('b', {}, s.title),
            h('span', {}, s.text),
          ),
        );
      }
      left.append(
        h('hr', { style: { border: '0', borderTop: '1px solid rgba(58,40,18,.25)', margin: '6px 0' } }),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Name'), name),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Colour'), colors),
        h('div', { class: 'row', style: { marginBottom: '0' } }, h('span', { class: 'label' }, 'Controls')),
        tiles,
        h(
          'div',
          { style: { textAlign: 'right', marginTop: '4px' } },
          h(
            'button',
            {
              class: 'link',
              onclick: () => {
                if (!confirm(`Delete ${profile.name} and their whole crew?`)) return;
                deleteProfile(store, profile.id);
                this.save();
                rerender();
              },
            },
            'Delete player',
          ),
        ),
      );
    }

    const right = h('div', {
      class: 'parchment',
      style: { left: '384px', top: '300px', width: '252px', height: '226px' },
    });
    if (profile) {
      const crewList = h('ul', { class: 'list', style: { maxHeight: '164px' } });
      const playing = new Set(crewForRound(profile, 1).map((m) => m.id));
      for (const m of profile.crew) crewList.append(this.crewRow(profile, m, playing.has(m.id), rerender));
      if (!profile.crew.length) {
        crewList.append(h('li', { class: 'hint', style: { cursor: 'default' } }, 'No clonks yet. Your first round recruits one, or hire one here.'));
      }
      right.append(
        h('h2', { class: 'crew-title', style: { fontSize: '22px' } }, `Crew of ${profile.name}`),
        crewList,
        h(
          'div',
          { style: { marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h(
            'button',
            {
              class: 'ink-button',
              disabled: profile.crew.length >= MAX_CREW,
              onclick: () => {
                const m = hireClonk(profile, this.o.names);
                this.save();
                this.o.sounds.play('Click', 0.6);
                rerender();
                this.el?.querySelector(`[data-member="${m.id}"]`)?.scrollIntoView({ block: 'nearest' });
              },
            },
            '+ Hire a clonk',
          ),
        ),
      );
    } else {
      right.append(h('h2', {}, 'Crew'), h('p', {}, 'Every player brings a crew of clonks. They gain experience and climb the ranks, round after round.'));
    }

    return [
      left,
      right,
      bigButton('Back', 40, 550, () => this.go('main')),
      bigButton('Choose scenario', 536, 550, () => this.go('scenarios'), !profile),
      ...(profile ? [] : [bigButton('New player', 96, 470, newPlayer)]),
    ];
  }

  private crewRow(profile: Profile, m: CrewMember, leads: boolean, rerender: () => void): HTMLElement {
    const exp = expBar(m.experience);
    exp.bar.title = expProgress(m.experience).label;
    const plays = m.participates !== false;
    return h(
      'li',
      { class: `crew-row${plays ? '' : ' benched'}`, 'data-member': m.id, style: { cursor: 'default' } },
      portrait(m.portrait),
      h(
        'div',
        { class: 'crew-info' },
        h(
          'div',
          { class: 'crew-name' },
          m.name,
          leads ? h('span', { title: 'Plays the next round' }, ' ★') : '',
          ' ',
          h('small', {}, plural(m.rounds, 'round'), m.kills ? `, ${plural(m.kills, 'knockout')}` : '', m.deaths ? `, ${plural(m.deaths, 'death')}` : ''),
        ),
        h('div', { class: 'crew-rank' }, rankBadge(m.rank), rankName(m.rank)),
        exp.bar,
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' } },
        h(
          'button',
          {
            class: 'plays',
            title: plays ? 'Takes part in rounds. Click to bench.' : 'Benched. Click to let them play.',
            onclick: () => {
              m.participates = !plays;
              this.save();
              rerender();
            },
          },
          plays ? '✓' : '',
        ),
        h(
          'button',
          {
            class: 'link',
            title: 'Dismiss from the crew',
            onclick: () => {
              if (!confirm(`Dismiss ${rankName(m.rank)} ${m.name} from the crew for good?`)) return;
              profile.crew = profile.crew.filter((c) => c !== m);
              this.save();
              rerender();
            },
          },
          '✕',
        ),
      ),
    );
  }

  // ------------------------------------------------------------ scenarios

  private scenarioScreen(): HTMLElement[] {
    const profile = activeProfile(this.o.store);
    const scenario = this.scenario;
    const list = h('ul', { class: 'list scen-list', style: { maxHeight: '262px' } });
    for (const s of [...SCENARIOS, ...this.own]) {
      if (s === this.own[0]) list.append(h('li', { class: 'scen-group' }, 'Your scenarios'));
      list.append(
        h(
          'li',
          {
            class: s === scenario ? 'selected' : '',
            onclick: () => {
              this.scenarioId = s.id;
              this.o.sounds.play('Click', 0.5);
              this.show('scenarios');
            },
            ondblclick: () => profile && this.play(s, profile),
          },
          s.title,
          h('small', {}, `${plural(s.crewSize, 'clonk')} · ${landscapeSize(s).width} × ${landscapeSize(s).height}`),
        ),
      );
    }

    const crew = profile ? crewForRound(profile, scenario.crewSize) : [];
    const style = CTRL_STYLES.find((c) => c.style === profile?.controlStyle);
    const left = h(
      'div',
      { class: 'parchment', style: { left: '104px', top: '118px', width: '262px', height: '372px' } },
      h('h2', { style: { fontSize: '32px', marginBottom: '12px' } }, 'Scenarios'),
      list,
      h(
        'div',
        { style: { position: 'absolute', bottom: '0', left: '0', right: '0' } },
        profile
          ? h(
              'p',
              { style: { margin: '0', fontSize: '12px' } },
              'Playing as ',
              h('b', {}, profile.name),
              style ? ` with ${style.title} controls. ` : '. ',
              h('button', { class: 'link', onclick: () => this.go('players') }, 'Change'),
            )
          : h('button', { class: 'ink-button', onclick: () => this.go('players') }, 'Create a player first'),
      ),
    );

    const crewLine = h('div', { style: { fontSize: '12.5px' } });
    for (const m of crew) {
      crewLine.append(
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '5px', margin: '2px 0' } },
          rankBadge(m.rank),
          `${rankName(m.rank)} ${m.name}`,
        ),
      );
    }
    const recruits = profile ? scenario.crewSize - crew.length : 0;
    if (recruits > 0) {
      crewLine.append(
        h(
          'div',
          { style: { margin: '2px 0', fontStyle: 'italic' } },
          `${crew.length ? 'and ' : ''}${recruits === 1 ? 'a new recruit' : `${recruits} new recruits`}`,
        ),
      );
    }
    const right = h(
      'div',
      { class: 'parchment', style: { left: '430px', top: '112px', width: '300px', height: '380px' } },
      h('h2', { style: { fontSize: '30px', textAlign: 'center' } }, scenario.title),
      h('div', { class: 'preview' }, scenarioPreview(scenario)),
      h('p', { class: 'scen-desc' }, scenario.description),
      profile ? h('h3', {}, 'Your crew') : null,
      crewLine,
      h(
        'div',
        { class: 'scen-actions' },
        h(
          'button',
          { class: 'ink-button', title: 'Change the map, the crew and the home base', onclick: () => this.go('settings') },
          'Settings',
        ),
        isOriginal(scenario)
          ? null
          : h(
              'button',
              {
                class: 'link',
                onclick: () => {
                  if (!confirm(`Delete your scenario ${scenario.title}?`)) return;
                  deleteScenario(this.own, scenario.id);
                  saveScenarios(this.o.storage, this.own);
                  this.scenarioId = scenario.basedOn ?? SCENARIOS[0].id;
                  this.go('scenarios');
                },
              },
              'Delete',
            ),
      ),
    );

    return [
      left,
      right,
      bigButton('Back', 92, 538, () => this.go('main')),
      bigButton('Start', 470, 538, () => profile && this.play(scenario, profile), !profile),
    ];
  }

  /** Settings of the selected scenario. Saving an original makes a copy; your own are changed in place. */
  private settingsScreen(): HTMLElement[] {
    const scenario = this.scenario;
    return scenarioSettings({
      scenario,
      original: isOriginal(scenario),
      basedOnTitle: scenario.basedOn ? scenarioById(scenario.basedOn)?.title : undefined,
      onCancel: () => this.go('scenarios'),
      onSave: (edited) => {
        const saved = saveEdit(this.own, edited);
        saveScenarios(this.o.storage, this.own);
        this.scenarioId = saved.id;
        this.go('scenarios');
      },
    });
  }

  private play(scenario: ScenarioDef, profile: Profile): void {
    this.o.sounds.play('Click', 0.7);
    this.hide();
    this.o.onPlay(scenario, profile);
  }

  // -------------------------------------------------------------- credits

  /** Keys for both control styles, and the in-game key help switch. */
  private optionsScreen(): HTMLElement[] {
    return gameSettings({
      settings: this.o.settings,
      style: activeProfile(this.o.store)?.controlStyle ?? 'jumpAndRun',
      save: () => saveSettings(this.o.storage, this.o.settings),
      click: () => this.o.sounds.play('Click', 0.5),
      onBack: () => this.go('main'),
    });
  }

  private creditsScreen(): HTMLElement[] {
    const paper = h(
      'div',
      { class: 'paper compact', style: { left: '86px', top: '50px' } },
      h(
        'div',
        { class: 'paper-body', style: { top: '30px', bottom: '36px' } },
        h('h1', {}, 'Credits'),
        h('div', { class: 'sub' }, 'ReClonk is a free, non-profit fan remake of Clonk.'),
        h('h3', {}, 'Clonk'),
        h(
          'p',
          {},
          'Created by Matthes Bender and RedWolf Design. Clonk Rage engine by Matthes Bender, Sven Eberhardt, ' +
            'Peter Wortmann, Günther Brammer, Armin Burgmeier, Julian Raschke and Alexander Post, ' +
            'and thanks to everyone who made Clonk’s content and community.',
        ),
        h('h3', {}, 'LegacyClonk'),
        h('p', {}, 'The LegacyClonk Team and contributors keep the Clonk Rage engine alive and published its content under CC BY-NC 4.0.'),
        h('h3', {}, 'Graphics, sounds, font and names'),
        h(
          'p',
          {},
          'The clonk, items, hut, flag, materials, menu backgrounds, portraits, rank symbols, sounds, the Endeavour font and the clonk names ' +
            'are original Clonk Rage content by RedWolf Design, used under CC BY-NC 4.0. ' +
            'Main menu picture by Matthes Bender and Christopher Graulich.',
        ),
        h('h3', {}, 'ReClonk'),
        h('p', {}, 'Started by Kevin (ripkiwi), with contributions from the community. Code under the ISC license.'),
        h('p', { style: { fontSize: '11px', color: 'var(--ink-soft)', marginTop: '8px' } }, "'Clonk' is a registered trademark of Matthes Bender. ReClonk is not affiliated with or endorsed by Matthes Bender, RedWolf Design or the LegacyClonk Team."),
      ),
    );
    return [paper, bigButton('Back', 288, 545, () => this.go('main'))];
  }

  // -------------------------------------------------------------- results

  /** The end-of-round screen: experience earned, ranks, promotions. Shown over the frozen game. */
  showResults(round: Round, outcomes: CrewOutcome[], actions: { again(): void; menu(): void }): void {
    const verdict = roundVerdict(round);
    const seconds = Math.floor(round.world.tick / 36);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const rows: HTMLElement[] = [];
    const bars: { fill: HTMLElement; rank: HTMLElement; promo: HTMLElement; to: number; outcome: CrewOutcome }[] = [];
    for (const outcome of outcomes) {
      const { member: m, result, before } = outcome;
      const bar = expBar(before.experience);
      const rank = h('div', { class: 'crew-rank' }, rankBadge(before.rank), rankName(before.rank));
      const promo = h('div', { class: 'promoted' });
      bars.push({ fill: bar.fill, rank, promo, to: m.experience, outcome });
      rows.push(
        h(
          'div',
          { class: 'result' },
          portrait(m.portrait),
          h(
            'div',
            { style: { flex: '1' } },
            h('div', { class: 'crew-name' }, m.name, outcome.isNew ? h('small', { class: 'new-tag' }, ' joined the crew') : ''),
            rank,
            bar.bar,
            h('div', { class: 'exp-text' }, expProgress(m.experience).label),
            h(
              'div',
              { class: 'gain' },
              h('b', {}, `+${result.experienceGained + ROUND_BONUS} experience`),
              ` (${result.experienceGained} earned, ${ROUND_BONUS} for playing)`,
              result.kills ? h('b', {}, ` · ${plural(result.kills, 'knockout')}`) : '',
            ),
            outcome.died ? h('div', { class: 'hint' }, 'Was knocked out this round, but keeps what they learned.') : null,
            promo,
          ),
        ),
      );
    }
    const paper = h(
      'div',
      { class: `paper${outcomes.length > 2 ? ' many' : ''}`, style: { left: '86px', top: '50px' } },
      h(
        'div',
        { class: 'paper-body' },
        h('h1', {}, verdict.title),
        h('div', { class: 'sub' }, `${verdict.text}${round.scenario.title} · ${time} played · ${round.profile.name}`),
        ...rows,
      ),
    );
    this.mount([paper, bigButton('Play again', 150, 540, actions.again), bigButton('Main menu', 426, 540, actions.menu)], '', actions.menu, true);

    // Fill the experience bars. A promotion fills the old rank's bar to the end,
    // then the fanfare plays and the bar starts over for the new rank.
    const pct = (exp: number): string => `${(expProgress(exp).fraction * 100).toFixed(1)}%`;
    const promoted = bars.filter((b) => b.outcome.member.rank > b.outcome.before.rank);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const b of bars) b.fill.style.width = promoted.includes(b) ? '100%' : pct(b.to);
      }),
    );
    if (!promoted.length) return;
    setTimeout(() => {
      if (!this.el?.contains(paper)) return;
      this.o.sounds.play('Trumpet');
      for (const b of promoted) {
        const r = b.outcome.member.rank;
        b.rank.replaceChildren(rankBadge(r), rankName(r));
        b.promo.textContent = `Promoted to ${rankName(r)}!`;
        b.promo.classList.add('show');
        b.fill.style.transition = 'none';
        b.fill.style.width = '0%';
        void b.fill.offsetWidth;
        b.fill.style.transition = '';
        b.fill.style.width = pct(b.to);
      }
    }, 1700);
  }
}
