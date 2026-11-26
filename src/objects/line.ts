// Power lines and pipes (Structures.c4d/Lines.c4d: PowerLine, SourcePipe,
// DrainPipe), ported from the original content and the engine's CONNECT
// procedure (C4Object::ExecAction DFA_CONNECT, C4Shape::LineConnect).
// See licenses/clonk_engine_license.txt.

import type { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import type { Item } from './item';
import { Structure } from './structure';

/** A power line carries energy; a source pipe takes liquid into a pump, a drain pipe lets it out. */
export type LineKind = 'power' | 'source' | 'drain';

/** What a line hangs from: a building, or the line kit it's being laid with. */
export type LineEnd = Structure | Item;

export const LINE = {
  /** A line can have this many corners (C4D_MaxVertex). */
  maxVertices: 30,
  /** Drawn in the game palette's colours 68 (copper) and 23 (grey), with a light dot at each corner (colour 26). */
  colors: { power: 0x98642c, source: 0x747474, drain: 0x747474, joint: 0xa8a8a8 } as Record<LineKind | 'joint', number>,
};

/** The original's names (DefCore Name). */
export const LINE_NAMES: Record<LineKind, string> = { power: 'Power line', source: 'Source pipe', drain: 'Drain pipe' };

/**
 * A line between two things. It follows both ends, bends around the
 * landscape where it would cut through it, and straightens again where it
 * can. `from` is where it comes from (the original's first action target),
 * `to` where it goes.
 */
export class Line {
  readonly xs: number[];
  readonly ys: number[];
  removed = false;

  constructor(
    readonly kind: LineKind,
    public from: LineEnd,
    public to: LineEnd,
    readonly owner: number,
    /** The tick it was laid: its transfers keep time from then (the Connect action's Delay). */
    readonly born = 0,
  ) {
    const a = endPoint(from);
    const b = endPoint(to);
    this.xs = [a.x, b.x];
    this.ys = [a.y, b.y];
  }

  /** The end at the other side of `e`, or null if the line doesn't hang from it. */
  other(e: LineEnd): LineEnd | null {
    return this.from === e ? this.to : this.to === e ? this.from : null;
  }

  /** The line's last corner: where a drain pipe or a source pipe without a building ends (GetVertex(50)). */
  get last(): { x: number; y: number } {
    return { x: this.xs[this.xs.length - 1], y: this.ys[this.ys.length - 1] };
  }
}

/**
 * Where a line hangs from something (DFA_CONNECT without C4D_Line_Vertex):
 * its centre, a quarter of its height down. A line kit being carried or kept
 * somewhere is where its holder is.
 */
export function endPoint(e: LineEnd): { x: number; y: number } {
  if (e instanceof Structure) return { x: e.x, y: e.y + Math.trunc(e.def.height / 4) };
  const h = e.container;
  return h ? { x: Math.round(h.x), y: Math.round(h.y) } : { x: Math.round(e.x), y: Math.round(e.y) };
}

/**
 * PathFree: is the straight way from one point to another clear of solid
 * landscape? If not, `hit` is where it first runs into it. With
 * `ignoreMasks` the solid parts of buildings don't count (PathFreeIgnoreVehicle).
 */
export function pathFree(land: Landscape, x1: number, y1: number, x2: number, y2: number, hit?: { x: number; y: number }, ignoreMasks = false): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= n; i++) {
    const x = n ? Math.round(x1 + (dx * i) / n) : x1;
    const y = n ? Math.round(y1 + (dy * i) / n) : y1;
    if (!land.isSolid(x, y)) continue;
    if (ignoreMasks && land.get(x, y) === Mat.Basement) continue;
    if (hit) {
      hit.x = x;
      hit.y = y;
    }
    return false;
  }
  return true;
}

/**
 * C4Shape::LineConnect: move the end corner `i` (0 or the last one) to the
 * new point. Where the way to its neighbour isn't free, a bend is put in
 * around the obstacle. Returns false if no bend could be found: the line breaks.
 */
export function lineConnect(land: Landscape, l: Line, i: number, tx: number, ty: number): boolean {
  const { xs, ys } = l;
  if (xs[i] === tx && ys[i] === ty) return true;
  const nb = i === 0 ? 1 : i - 1;
  const hit = { x: 0, y: 0 };
  if (pathFree(land, tx, ty, xs[nb], ys[nb], hit)) {
    xs[i] = tx;
    ys[i] = ty;
    return true;
  }
  let bx = 0;
  let by = 0;
  let found = false;
  search: for (let r = 4; r <= 12; r += 4) {
    for (let cx = hit.x - r / 2; cx <= hit.x + r; cx += r) {
      for (let cy = hit.y - r / 2; cy <= hit.y + r; cy += r) {
        if (pathFree(land, cx, cy, tx, ty) && pathFree(land, cx, cy, xs[nb], ys[nb])) {
          bx = cx;
          by = cy;
          found = true;
          break search;
        }
      }
    }
  }
  if (!found) {
    // Bend right where the line was, letting it through buildings (castles, elevator shafts).
    bx = xs[i];
    by = ys[i];
    if (!pathFree(land, bx, by, tx, ty, undefined, true) || !pathFree(land, bx, by, xs[nb], ys[nb], undefined, true)) return false;
  }
  if (xs.length >= LINE.maxVertices) return false;
  if (i === 0) {
    xs.splice(1, 0, bx);
    ys.splice(1, 0, by);
  } else {
    xs.splice(i, 0, bx);
    ys.splice(i, 0, by);
    i++;
  }
  xs[i] = tx;
  ys[i] = ty;
  return true;
}

/** ReduceLineSegments: take out a corner (two with `alternate`) where the line can go straight past it. */
export function reduceLine(land: Landscape, l: Line, alternate: boolean): boolean {
  const { xs, ys } = l;
  const skip = alternate ? 3 : 2;
  for (let i = 0; i + skip < xs.length; i++) {
    if (!pathFree(land, xs[i], ys[i], xs[i + skip], ys[i + skip])) continue;
    xs.splice(i + 1, skip - 1);
    ys.splice(i + 1, skip - 1);
    return true;
  }
  return false;
}
