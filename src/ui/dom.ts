import { experienceForRank, MAX_RANK, rankForExperience, rankName, rankSymbols } from '../game/ranks';
import type { ItemDef } from '../objects/defs';
import { CONTENT_BASE, type GameAssets } from '../render/assets';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> };

/** Tiny element builder: h('div', { class: 'x', onclick }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else if (v === false) continue;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** Image URLs the stylesheet uses, set as CSS variables so they follow the base path. */
export function setCssImages(root: HTMLElement = document.documentElement): void {
  const url = (file: string): string => `url("${CONTENT_BASE}${file}")`;
  const vars: Record<string, string> = {
    '--img-main-menu': url('gui/MainMenu.jpg'),
    '--img-plr-sel': url('gui/StartupPlrSelBG.png'),
    '--img-scen-sel': url('gui/StartupScenSelBG.png'),
    '--img-dlg-paper': url('gui/StartupDlgPaper.png'),
    '--img-button': url('gui/StartupBigButton.png'),
    '--img-button-down': url('gui/StartupBigButtonDown.png'),
    '--img-ctrl-type': url('gui/StartupPlrCtrlType.png'),
    '--img-title-ov': url('gui/StartupScenSelTitleOv.png'),
    '--img-rank': url('clonk/Rank.png'),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Keep the 800×600 menu stage fitted to the window. */
export function fitStage(): void {
  const fit = (): void =>
    document.documentElement.style.setProperty('--stage-scale', String(Math.min(innerWidth / 800, innerHeight / 600)));
  fit();
  addEventListener('resize', fit);
}

export function bigButton(label: string, x: number, y: number, onclick: () => void, disabled = false): HTMLButtonElement {
  return h('button', { class: 'big-button', style: { left: `${x}px`, top: `${y}px` }, onclick, disabled }, label);
}

export function portrait(n: number, cls = 'portrait'): HTMLImageElement {
  const p = Math.max(1, Math.min(5, n || 1));
  return h('img', { class: cls, src: `${CONTENT_BASE}clonk/portraits/Portrait${p}.png`, alt: '', draggable: false });
}

/** The rank symbol from the original's Rank.png, with a star for extended ranks. */
export function rankBadge(rank: number, big = false): HTMLElement {
  const s = rankSymbols(rank);
  const badge = h('span', { class: big ? 'rank-badge big' : 'rank-badge', title: rankName(rank) });
  badge.append(h('i', { style: { backgroundPosition: `${-s.base * 16}px 0` } }));
  if (s.extension !== undefined) badge.append(h('i', { style: { backgroundPosition: `${-s.extension * 16}px 0` } }));
  return badge;
}

/** Progress towards the next rank, as a fraction and a "123 / 1000" label. */
export function expProgress(exp: number): { fraction: number; label: string } {
  const r = rankForExperience(exp);
  if (r >= MAX_RANK) return { fraction: 1, label: `${exp} experience` };
  const lo = experienceForRank(r);
  const hi = experienceForRank(r + 1);
  return { fraction: (exp - lo) / (hi - lo), label: `${exp} / ${hi} experience` };
}

export function expBar(exp: number): { bar: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const p = expProgress(exp);
  const fill = h('div', { style: { width: `${(p.fraction * 100).toFixed(1)}%` } });
  return { bar: h('div', { class: 'exp' }, fill), fill, text: h('div', { class: 'exp-text' }, p.label) };
}

/** Draw an item's sprite into a small canvas, for HUD slots. */
export function drawItem(canvas: HTMLCanvasElement, def: ItemDef | undefined, assets: GameAssets): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!def) return;
  const g = def.graphic;
  const source = assets.items[g.file]?.source.resource as CanvasImageSource | undefined;
  if (!source) return;
  ctx.imageSmoothingEnabled = false;
  const s = Math.floor(Math.min(canvas.width / g.facet.w, canvas.height / g.facet.h));
  const w = g.facet.w * s;
  const hgt = g.facet.h * s;
  try {
    ctx.drawImage(source, g.facet.x, g.facet.y, g.facet.w, g.facet.h, (canvas.width - w) / 2, (canvas.height - hgt) / 2, w, hgt);
  } catch {
    // Not drawable in this browser; leave the slot empty.
  }
}
