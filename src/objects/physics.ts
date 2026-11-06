// Ported from the Clonk Rage engine (C4Movement.cpp, C4Shape.cpp, C4Physics.h).
// See licenses/clonk_engine_license.txt.
//
// All speeds are in pixels per tick (36 ticks per second). Only + - * / and
// Math.floor/Math.sqrt are used, which give identical results on every
// JavaScript engine, so the simulation stays deterministic.

import type { Landscape } from '../landscape/landscape';

export const GRAVITY = 0.2;
export const WALK_ACCEL = 0.5;
export const SWIM_ACCEL = 0.2;
export const FLOAT_ACCEL = 0.1;
/** Fastest a body can fall; keeps per-pixel movement loops short. */
export const MAX_SPEED = 12;
/** Speed (|xdir| + |ydir|) at which an object "hits" something: flints explode. */
export const HIT_SPEED_1 = 1.5;
/** Landing this fast makes a clonk kneel. */
export const HIT_SPEED_3 = 6;
/** Landing this fast knocks a clonk flat. */
export const HIT_SPEED_4 = 8;
const REDIRECT = 0.5;
const FRICTION = 0.3;
/** How far a walking/climbing clonk snaps to the surface it's attached to. */
export const ATTACH_RANGE = 5;
export const CORNER_RANGE = ATTACH_RANGE + 2;

/** Contact attachment directions (CNAT). */
export const CNAT = { None: 0, Left: 1, Right: 2, Top: 4, Bottom: 8 } as const;

export interface Vertex {
  x: number;
  y: number;
  cnat: number;
  /** Friction in percent when this vertex touches the ground. */
  friction: number;
}

/** Physical attributes are stored like the original (0..100000) and converted to speeds here. */
export function physical(percent: number, value: number): number {
  return (value * (percent / 5)) / (100000 * 20);
}

export function round(v: number): number {
  return Math.floor(v + 0.5);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Move `from` towards zero by up to 0.5 and add that amount to `to` in direction tdir. */
export function redirect(from: number, to: number, tdir: number): [number, number] {
  const r = Math.min(Math.abs(from), REDIRECT);
  return [from - r * sign(from), to + r * tdir];
}

export function applyFriction(v: number, percent: number): number {
  const f = (FRICTION * percent) / 100;
  if (v > f) return v - f;
  if (v < -f) return v + f;
  return 0;
}

export interface Contact {
  /** Union of the CNAT flags of every vertex that touched solid ground. */
  cnat: number;
  count: number;
  /** Union of solid neighbours around the touching vertices (to decide which way to slide). */
  around: number;
  friction: number;
}

/** Check all vertices of a shape at position (cx, cy) against solid landscape. */
export function contactCheck(land: Landscape, vertices: readonly Vertex[], cx: number, cy: number): Contact {
  const c: Contact = { cnat: 0, count: 0, around: 0, friction: 0 };
  for (const v of vertices) {
    const px = cx + v.x;
    const py = cy + v.y;
    if (!land.isSolid(px, py)) continue;
    if (c.count === 0) c.friction = v.friction;
    c.cnat |= v.cnat;
    c.count++;
    if (land.isSolid(px, py - 1)) c.around |= CNAT.Top;
    if (land.isSolid(px, py + 1)) c.around |= CNAT.Bottom;
    if (land.isSolid(px - 1, py)) c.around |= CNAT.Left;
    if (land.isSolid(px + 1, py)) c.around |= CNAT.Right;
  }
  return c;
}

/**
 * Snap a shape to the surface in direction `cnatPos` (e.g. keep a walking clonk's
 * feet on the ground over bumps and slopes). Returns the adjusted position, or
 * null if there is nothing to hold on to within ATTACH_RANGE.
 */
export function attach(
  land: Landscape,
  vertices: readonly Vertex[],
  cx: number,
  cy: number,
  cnatPos: number,
): { x: number; y: number } | null {
  let attached = false;
  for (const v of vertices) {
    if (!(v.cnat & cnatPos)) continue;
    const xd = cnatPos === CNAT.Left ? -1 : cnatPos === CNAT.Right ? 1 : 0;
    const yd = cnatPos === CNAT.Top ? -1 : cnatPos === CNAT.Bottom ? 1 : 0;
    // Scan from ATTACH_RANGE behind the vertex to ATTACH_RANGE in front of it.
    for (let k = -ATTACH_RANGE; k < ATTACH_RANGE; k++) {
      const ax = cx + v.x + k * xd + xd;
      const ay = cy + v.y + k * yd + yd;
      if (land.isSolid(ax, ay) && ax >= 0 && ax < land.width) {
        cx += k * xd;
        cy += k * yd;
        attached = true;
        break;
      }
    }
  }
  return attached ? { x: cx, y: cy } : null;
}
