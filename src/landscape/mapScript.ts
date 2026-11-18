/**
 * The original's map scripts (Landscape.txt), ported from the Clonk Rage
 * engine's C4MapCreatorS2.cpp ("complex dynamic landscape creator" by Sven2).
 * Clonk source code: Copyright (c) 2001-2014 RedWolf Design GmbH, ISC license.
 * See licenses/clonk_engine_license.txt.
 *
 * A map script describes a map as a tree of overlays. Each overlay fills a
 * part of its owner with a material wherever its algorithm says so (solid,
 * bozo blobs, lines, a sine curve, checkers, borders...), bent by turbulence
 * and rotation. Overlays chained with & | ^ combine their masks before the last
 * one paints, and an overlay's children are painted inside it. Named overlays
 * can be reused anywhere below by name, with changed fields in braces.
 *
 *   map Caves { mat=Earth; overlay { algo=bozo; mat=Tunnel; turbulence=100; }; };
 *
 * Materials the game doesn't have yet are left out: such an overlay paints
 * nothing and neither do its children, so the material beneath stays.
 */
import type { Rng } from '../core/rng';
import { dsin, mapSize, IFT, type LandscapeDef, type MapData } from './mapCreator';
import { MATERIALS, texIndex } from './materials';

/** C4MC_SizeRes and C4MC_ZoomRes. */
const SIZE_RES = 100;
const Z = 100;

type Op = 'none' | '&' | '|' | '^';
type Algo = (o: Overlay, x: number, y: number) => boolean;

/** A number in percent of the owner's size, or in map pixels (C4MCNode::int_bool). */
interface Rel {
  value: number;
  percent: boolean;
}
const rel = (value: number, percent: boolean): Rel => ({ value, percent });
/** int_bool::Evaluate, with C's integer division. */
const evalRel = (r: Rel, relativeTo: number): number => (r.percent ? Math.trunc((r.value * relativeTo) / SIZE_RES) : r.value);

/** A script that can't be read: the message says where. */
export class MapScriptError extends Error {}

interface Node {
  kind: 'root' | 'overlay' | 'point' | 'map';
  name: string;
  owner: Node | null;
  children: Node[];
}

interface Point extends Node {
  kind: 'point';
  rx: Rel;
  ry: Rel;
  x: number;
  y: number;
}

interface Overlay extends Node {
  kind: 'overlay' | 'map';
  rx: Rel;
  ry: Rel;
  rwdt: Rel;
  rhgt: Rel;
  rox: Rel;
  roy: Rel;
  /** Material name, or '' for none (paints sky, or tunnel when underground). */
  mat: string;
  tex: string;
  algoName: string;
  algo: Algo;
  sub: boolean;
  zoomX: number;
  zoomY: number;
  alpha: Rel;
  beta: Rel;
  turbulence: number;
  lambda: number;
  rotate: number;
  fixedSeed: number;
  invert: boolean;
  looseBounds: boolean;
  group: boolean;
  mask: boolean;
  /** The operator that chains it to the next overlay. */
  op: Op;
  // Worked out by evaluate():
  X: number;
  Y: number;
  Wdt: number;
  Hgt: number;
  offX: number;
  offY: number;
  seed: number;
  /** The texture map index it paints (with IFT when underground). */
  color: number;
  /** Its material isn't in the game yet: paint nothing. */
  skip: boolean;
}

const isOverlay = (n: Node | null | undefined): n is Overlay => !!n && (n.kind === 'overlay' || n.kind === 'map');

function sibling(n: Node, d: 1 | -1): Node | null {
  if (!n.owner) return null;
  const list = n.owner.children;
  return list[list.indexOf(n) + d] ?? null;
}

/** C4MCNode::OwnerOverlay. */
function ownerOverlay(n: Node): Overlay | null {
  for (let o = n.owner; o; o = o.owner) if (isOverlay(o)) return o;
  return null;
}

/** C4MCNode::GetNodeByName: the latest of that name here, else further up. */
function nodeByName(n: Node, name: string): Node | null {
  for (let c = n.children.length - 1; c >= 0; c--) if (n.children[c].name === name) return n.children[c];
  return n.owner ? nodeByName(n.owner, name) : null;
}

/** Append a node to its owner, like C4MCNode::Reg2Owner. */
function adopt<T extends Node>(n: T, owner: Node): T {
  n.owner = owner;
  owner.children.push(n);
  return n;
}

/**
 * A copy of a node and its children under a new owner. Only clones (children
 * being copied along) keep their operator; the copy itself starts a new chain.
 * Copies have no name.
 */
function copyNode(t: Node, owner: Node, clone: boolean): Node {
  let n: Node;
  if (isOverlay(t)) {
    n = { ...t, name: '', owner: null, children: [], op: clone ? t.op : 'none' } as Overlay;
  } else {
    n = { ...t, name: '', owner: null, children: [] };
  }
  adopt(n, owner);
  for (const c of t.children) copyNode(c, n, true);
  return n;
}

/** C4MCOverlay::Default. */
function defaultOverlay(kind: 'overlay' | 'map'): Overlay {
  return {
    kind,
    name: '',
    owner: null,
    children: [],
    rx: rel(0, true),
    ry: rel(0, true),
    rwdt: rel(SIZE_RES, true),
    rhgt: rel(SIZE_RES, true),
    rox: rel(0, true),
    roy: rel(0, true),
    mat: '',
    tex: '',
    algoName: 'solid',
    algo: ALGOS.solid,
    sub: true,
    zoomX: Z,
    zoomY: Z,
    alpha: rel(0, false),
    beta: rel(0, false),
    turbulence: 0,
    lambda: 0,
    rotate: 0,
    fixedSeed: 0,
    invert: false,
    looseBounds: false,
    group: false,
    mask: false,
    op: 'none',
    X: 0,
    Y: 0,
    Wdt: SIZE_RES,
    Hgt: SIZE_RES,
    offX: 0,
    offY: 0,
    seed: 0,
    color: 0,
    skip: false,
  };
}

// --- Tokens (C4MCParser::GetNextToken) ---

type Tok =
  | { t: 'idtf'; s: string }
  | { t: 'int' | 'percent' | 'px'; v: number; s: string }
  | { t: 'dir' | 'range' | '=' | '{' | '}' | ';' | '&' | '|' | '^' | 'eof'; s: string };

function tokenize(code: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = code.length;
  const identChar = (c: string): boolean => /[0-9a-zA-Z_]/.test(c);
  while (true) {
    // Spaces and comments
    while (i < n) {
      const c = code[i];
      if (c === '/' && code[i + 1] === '/') {
        while (i < n && code[i] !== '\n' && code[i] !== '\r') i++;
      } else if (c === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < n && !(code[i - 1] === '*' && code[i] === '/')) i++;
        i++;
      } else if (c.charCodeAt(0) <= 32) i++;
      else break;
    }
    if (i >= n) {
      out.push({ t: 'eof', s: '' });
      return out;
    }
    const c = code[i];
    if ((c >= '0' && c <= '9') || c === '+' || c === '-') {
      const start = i++;
      while (i < n && code[i] >= '0' && code[i] <= '9') i++;
      const s = code.slice(start, i);
      if (s === '-') {
        out.push({ t: 'range', s });
        continue;
      }
      const v = parseInt(s, 10) || 0;
      if (code[i] === '%') {
        i++;
        out.push({ t: 'percent', v, s });
      } else if (code[i] === 'p') {
        i++;
        if (code[i] === 'x') i++;
        out.push({ t: 'px', v, s });
      } else out.push({ t: 'int', v, s });
    } else if ('={};&|^'.includes(c)) {
      i++;
      out.push({ t: c as '=', s: c });
    } else if (c === '#' || c >= '@') {
      const start = i++;
      while (i < n && identChar(code[i])) i++;
      out.push(c === '#' ? { t: 'dir', s: code.slice(start, i) } : { t: 'idtf', s: code.slice(start, i) });
    } else {
      throw new MapScriptError(`unexpected character '${c}' (line ${line(code, i)})`);
    }
  }
}

function line(code: string, pos: number): number {
  return code.slice(0, pos).split('\n').length;
}

// --- Parser (C4MCParser::ParseTo) ---

class Parser {
  private pos = 0;
  tok: Tok = { t: 'eof', s: '' };

  constructor(
    private readonly toks: Tok[],
    private readonly defaultMap: Overlay,
    private readonly onTopLevel: (n: Node) => void,
  ) {}

  next(): boolean {
    this.tok = this.toks[Math.min(this.pos++, this.toks.length - 1)];
    return this.tok.t !== 'eof';
  }

  private err(msg: string): never {
    throw new MapScriptError(`${msg} (near '${this.tok.s}')`);
  }

  parseTo(to: Node): void {
    const global = to.kind === 'root';
    let state: 'none' | 'keywd1' | 'keywd1n' | 'afternode' | 'gotop' | 'gotidtf' | 'gotopidtf' | 'setfield' = 'none';
    let node: Node | null = null;
    let idtf = '';
    let field = '';
    let done = false;
    while (this.next()) {
      const tok = this.tok;
      switch (state) {
        case 'none':
        case 'gotop':
          if (tok.t === 'dir') this.err(global ? `unknown directive ${tok.s}` : "can't use directives in local scope");
          else if (tok.t === 'idtf') {
            if (tok.s === 'overlay') {
              node = adopt(defaultOverlay('overlay'), to);
              state = 'keywd1';
            } else if (tok.s === 'point' && !nodeByName(to, tok.s)) {
              node = adopt<Point>({ kind: 'point', name: '', owner: null, children: [], rx: rel(0, false), ry: rel(0, false), x: 0, y: 0 }, to);
              state = 'keywd1';
            } else if (tok.s === 'map') {
              if (!global) this.err("can't declare map in local scope");
              node = copyNode(this.defaultMap, to, false);
              state = 'keywd1';
            } else {
              idtf = tok.s;
              state = state === 'gotop' ? 'gotopidtf' : 'gotidtf';
            }
          } else if (tok.t === '}') done = true;
          else this.err('identifier expected');
          break;
        case 'keywd1':
        case 'keywd1n':
          if (state === 'keywd1' && tok.t === 'idtf') {
            node!.name = tok.s;
            state = 'keywd1n';
            break;
          }
          if (state === 'keywd1' && global) this.err('unnamed objects not allowed in global scope');
          if (tok.t !== '{') this.err("'{' expected");
          this.parseTo(node!);
          if (this.tok.t === 'eof') this.err('unexpected end of file');
          state = 'afternode';
          break;
        case 'gotidtf':
        case 'gotopidtf':
          if (tok.t === '=') {
            if (state === 'gotopidtf') this.err('second operand expected');
            field = idtf;
            state = 'setfield';
            break;
          }
          if (tok.t === '{' || tok.t === ';' || tok.t === '&' || tok.t === '|' || tok.t === '^') {
            if (global) this.err(`can't reinstanciate object '${idtf}' in global scope`);
            const tpl = nodeByName(to, idtf);
            if (!tpl) this.err(`unknown object: ${idtf}`);
            if (tpl.kind !== 'overlay') this.err(`can't reinstanciate '${idtf}'`);
            node = copyNode(tpl, to, false);
            if (tok.t === '{') {
              this.parseTo(node);
              this.next();
              if (this.tok.t === 'eof') this.err('unexpected end of file');
            }
            state = 'afternode';
          } else this.err("'=', ';' or '{' expected");
          this.afterNode(to, node!);
          state = this.tok.t === ';' ? 'none' : 'gotop';
          node = null;
          break;
        case 'afternode':
          this.afterNode(to, node!);
          state = tok.t === ';' ? 'none' : 'gotop';
          node = null;
          break;
        case 'setfield':
          this.parseValue(to, field);
          state = 'none';
          break;
      }
      if (done) break;
    }
    if (state !== 'none') this.err(state === 'gotop' ? 'second operand expected' : 'unexpected end of file');
  }

  /** ';' or an operator after a node; nodes of the global scope are evaluated now. */
  private afterNode(to: Node, node: Node): void {
    const t = this.tok.t;
    if (t === '&' || t === '|' || t === '^') {
      if (to.kind === 'root') this.err('operators not allowed in global scope');
      if (!isOverlay(node)) this.err("';' expected");
      node.op = t;
    } else if (t !== ';') this.err("';' or operator expected");
    if (to.kind === 'root') this.onTopLevel(node);
  }

  /** C4MCParser::ParseValue: a name, or a number with an optional random range (a - b). */
  private parseValue(to: Node, field: string): void {
    const tok = this.tok;
    if (tok.t === 'idtf') {
      if (!setField(to, field, tok.s, 0, 'idtf')) this.err(`field '${field}' not found`);
      this.next();
    } else if (tok.t === 'int' || tok.t === 'px' || tok.t === 'percent') {
      let value = tok.v;
      let type: 'int' | 'px' | 'percent' = tok.t;
      this.next();
      if (this.tok.t === 'range') {
        this.next();
        const hi = this.tok as Tok;
        if (hi.t !== 'int' && hi.t !== 'px' && hi.t !== 'percent') this.err(`constant for field '${field}' expected`);
        value += this.random(hi.v - value);
        type = hi.t;
        this.next();
      }
      if (!setField(to, field, '', value, type)) this.err(`field '${field}' not found`);
    } else this.err(`constant for field '${field}' expected`);
    if (this.tok.t !== ';') this.err("';' expected");
  }

  random: (n: number) => number = () => 0;
}

/** C4MCOverlay::SetField and C4MCPoint::SetField. */
function setField(n: Node, field: string, s: string, v: number, type: 'idtf' | 'int' | 'px' | 'percent'): boolean {
  const num = (): number => {
    if (type === 'idtf') throw new MapScriptError(`'${s}' is not a valid value for this field`);
    return v;
  };
  if (n.kind === 'point') {
    const p = n as Point;
    if (type === 'int') return false;
    if (field === 'x') p.rx = rel(num(), type === 'percent');
    else if (field === 'y') p.ry = rel(num(), type === 'percent');
    else return false;
    return true;
  }
  if (!isOverlay(n)) return false;
  const o = n;
  const percent = type === 'percent' || type === 'int';
  switch (field) {
    case 'x': o.rx = rel(num(), percent); break;
    case 'y': o.ry = rel(num(), percent); break;
    case 'wdt': o.rwdt = rel(num(), percent); break;
    case 'hgt': o.rhgt = rel(num(), percent); break;
    case 'ox': o.rox = rel(num(), percent); break;
    case 'oy': o.roy = rel(num(), percent); break;
    case 'a': o.alpha = rel(num(), type === 'percent'); break;
    case 'b': o.beta = rel(num(), type === 'percent'); break;
    case 'mat':
    case 'tex':
    case 'algo':
      if (type !== 'idtf') throw new MapScriptError(`'${v}' is not a valid value for this field`);
      if (field === 'mat') o.mat = s;
      else if (field === 'tex') o.tex = s;
      else {
        const a = ALGOS[s];
        if (!a) throw new MapScriptError(`algorithm '${s}' not found`);
        o.algoName = s;
        o.algo = a;
      }
      break;
    case 'sub': o.sub = num() !== 0; break;
    case 'invert': o.invert = num() !== 0; break;
    case 'loosebounds': o.looseBounds = num() !== 0; break;
    case 'grp': o.group = num() !== 0; break;
    case 'mask': o.mask = num() !== 0; break;
    case 'zoomX': o.zoomX = Math.max(1, Math.min(Z * 2, Z - num())); break;
    case 'zoomY': o.zoomY = Math.max(1, Math.min(Z * 2, Z - num())); break;
    case 'turbulence': o.turbulence = num(); break;
    case 'lambda': o.lambda = num(); break;
    case 'rotate': o.rotate = num(); break;
    case 'seed': o.fixedSeed = num(); break;
    // Script callbacks need the scenario script, which ReClonk doesn't have: ignored.
    case 'evalFn':
    case 'drawFn':
      break;
    default:
      return false;
  }
  return true;
}

/** The texture map index of a material and texture; -1 if the game doesn't have that material. */
function matColor(mat: string, tex: string): number {
  if (!mat) return 0;
  const i = texIndex(tex ? `${mat}-${tex}` : mat, tex || undefined);
  if (i) return i;
  return mat.toLowerCase() === 'sky' ? 0 : -1;
}

/** C4MCOverlay::Evaluate / C4MCPoint::Evaluate, for a node and all below it (ReEvaluate). */
function evaluateTree(n: Node, rng: Rng): void {
  const owner = ownerOverlay(n);
  if (n.kind === 'point') {
    const p = n as Point;
    if (owner) {
      p.x = evalRel(p.rx, owner.Wdt) + owner.X;
      p.y = evalRel(p.ry, owner.Hgt) + owner.Y;
    }
  } else if (isOverlay(n)) {
    const c = matColor(n.mat, n.tex);
    n.skip = c < 0;
    n.color = c > 0 && n.sub ? c + IFT : Math.max(c, 0);
    if (owner) {
      n.X = evalRel(n.rx, owner.Wdt) + owner.X;
      n.Y = evalRel(n.ry, owner.Hgt) + owner.Y;
      n.Wdt = evalRel(n.rwdt, owner.Wdt);
      n.Hgt = evalRel(n.rhgt, owner.Hgt);
      n.offX = evalRel(n.rox, owner.Wdt);
      n.offY = evalRel(n.roy, owner.Hgt);
    }
    n.seed = n.fixedSeed || ((rng.int(32768) << 16) | rng.int(65536));
  }
  for (const c of n.children) evaluateTree(c, rng);
}

// --- Rendering ---

const sinDeg = (deg: number): number => dsin((deg * Math.PI) / 180);
const cosDeg = (deg: number): number => dsin(((deg + 90) * Math.PI) / 180);
/** 3754936 / 65536: degrees per radian in the original's fixed point. */
const RAD2GRAD = 3754936 / 65536;
/** fixtoi(x, prec): rounded. */
const fixtoi = (x: number, prec: number): number => Math.floor(x * prec + 0.5);
/** itofix of a value too big for 16.16 fixed point keeps only its low 16 bits. */
const fixWrap = (v: number): number => (v << 16) >> 16;

function inBounds(o: Overlay, x: number, y: number): boolean {
  return x >= o.X && y >= o.Y && x < o.X + o.Wdt && y < o.Y + o.Hgt;
}

/** C4MCOverlay::CheckMask: does the algorithm fill this map pixel, after turbulence, rotation and zoom? */
function checkMask(o: Overlay, ix: number, iy: number): boolean {
  if (!o.looseBounds && !inBounds(o, ix, iy)) return false;
  let dX = ix;
  let dY = iy;
  if (o.turbulence) {
    let j = 3;
    for (let i = 10; i <= o.turbulence; i *= 10) {
      let seed2 = o.seed;
      for (let l = 0; l <= o.lambda; ++l) {
        for (let d = 2; d < 6; d += 1.5) {
          dX += (sinDeg(((dX / 7 + fixWrap(seed2) / o.zoomX + dY) / j + d) * RAD2GRAD) * j) / 2;
          dY += (cosDeg(((dY / 7 + fixWrap(seed2) / o.zoomY + dX) / j - d) * RAD2GRAD) * j) / 2;
        }
        seed2 = (Math.imul(o.seed, seed2 << 3) + 0x4465) & 0xffff;
      }
      j += 3;
    }
  }
  if (o.rotate) {
    const c = cosDeg(o.rotate);
    const s = sinDeg(o.rotate);
    const x0 = dX;
    const y0 = dY;
    dX = x0 * c - y0 * s;
    dY = y0 * c + x0 * s;
  }
  if (o.rotate || o.turbulence) {
    ix = fixtoi(dX, o.zoomX);
    iy = fixtoi(dY, o.zoomY);
  } else {
    ix *= o.zoomX;
    iy *= o.zoomY;
  }
  ix -= o.offX * o.zoomX;
  iy -= o.offY * o.zoomY;
  if (o.looseBounds && (ix < o.X * o.zoomX || iy < o.Y * o.zoomY || ix >= (o.X + o.Wdt) * o.zoomX || iy >= (o.Y + o.Hgt) * o.zoomY)) return o.invert;
  return o.algo(o, ix, iy) !== o.invert;
}

/**
 * C4MCOverlay::RenderPix: combine this overlay's mask with the chain so far;
 * the last of a chain paints its material and then its children.
 */
function renderPix(o: Overlay, x: number, y: number, pix: { v: number }, lastOp: Op, lastSet: boolean, draw: boolean): boolean {
  const setThis = checkMask(o, x, y);
  let doSet = lastOp === '&' ? setThis && lastSet : lastOp === '|' ? setThis || lastSet : lastOp === '^' ? setThis !== lastSet : setThis;
  if ((doSet && draw && o.op === 'none') || o.group) {
    draw = draw && (!o.group || o.op === 'none');
    if (draw && doSet && !o.mask && !o.skip) pix.v = o.color;
    if (!o.skip) {
      let set = false;
      let op: Op = 'none';
      for (const c of o.children) {
        if (!isOverlay(c)) continue;
        set = renderPix(c, x, y, pix, op, set, draw);
        if (o.group && c.op === 'none') doSet ||= set;
        op = c.op;
      }
    }
  }
  return doSet;
}

/** C4MCOverlay::FirstOfChain. */
function firstOfChain(o: Overlay): Overlay {
  let cur = o;
  for (let p = sibling(cur, -1); isOverlay(p) && p.op !== 'none'; p = sibling(cur, -1)) cur = p;
  return cur;
}

/** C4MCOverlay::PeekPix: is the pixel set by the chain that starts here? */
function peekPix(o: Overlay, x: number, y: number): boolean {
  const scratch = { v: 0 };
  let set = false;
  let op: Op = 'none';
  for (let cur: Overlay | null = o; cur; ) {
    set = renderPix(cur, x, y, scratch, op, set, false);
    op = cur.op;
    if (op === 'none') break;
    const nx = sibling(cur, 1);
    cur = isOverlay(nx) ? nx : null;
  }
  return set;
}

// --- Algorithms (the original's C4MCAlgoMap) ---

/** AlgoRandom: noise from the seed and the position. */
function algoRandom(o: Overlay, x: number, y: number): boolean {
  const s = o.seed;
  const h = (s ^ (x << 2) ^ (y << 5)) ^ (((s >> 16) + 1 + x + (y << 2)) | 0);
  return Math.trunc(h / 17) % (evalRel(o.alpha, SIZE_RES) + 2) === 0;
}

const ALGOS: Record<string, Algo> = {
  solid: () => true,
  random: algoRandom,
  checker: (_o, x, y) => ((Math.trunc(x / (Z * 10)) % 2) ^ (Math.trunc(y / (Z * 10)) % 2)) === 0,
  bozo: (o, x, y) => {
    const s = o.seed;
    const xc = ((Math.trunc(x / 10) + s + Math.trunc(y / 80)) | 0) % (Z * 2) - Z;
    const yc = ((Math.trunc(y / 10) + s + Math.trunc(x / 80)) | 0) % (Z * 2) - Z;
    return Math.abs(xc * yc) > Math.trunc((Z * Z * (evalRel(o.alpha, SIZE_RES) + 10)) / 50);
  },
  sin: (_o, x, y) => y > fixtoi(sinDeg(Math.trunc(x / Z) * 10) + 1, Z * 10),
  boxes: (o, x, y) => {
    const pxb = evalRel(o.beta, o.Wdt);
    const pxa = evalRel(o.alpha, o.Wdt);
    const s = o.seed;
    return Math.abs(x + (s % 4738)) % (pxb * Z + 1) < pxa * Z + 1 && Math.abs(y + Math.trunc(s / 4738)) % (pxb * Z + 1) < pxa * Z + 1;
  },
  rndchecker: (o, x, y) => algoRandom(o, Math.trunc(x / (Z * 10)), Math.trunc(y / (Z * 10))),
  lines: (o, x) => {
    const pxb = evalRel(o.beta, o.Wdt);
    const pxa = evalRel(o.alpha, o.Wdt);
    return Math.abs(x + (o.seed % 4738)) % (pxb * Z + 1) < pxa * Z + 1;
  },
  border: (o, x, y) => {
    // Set where the owner's chain is unset within a (sideways) or b (up and down) pixels.
    const la = evalRel(o.alpha, o.Wdt);
    const lb = evalRel(o.beta, o.Hgt);
    x = Math.trunc(x / o.zoomX);
    y = Math.trunc(y / o.zoomY);
    const owner = ownerOverlay(o);
    if (!owner) return false;
    let top = owner;
    for (let up = ownerOverlay(top); up; up = ownerOverlay(top)) top = up;
    const chain = firstOfChain(owner);
    for (let xx = x - la; xx <= x + la; xx++) if (inBounds(top, xx, y) && !peekPix(chain, xx, y)) return true;
    for (let yy = y - lb; yy <= y + lb; yy++) if (inBounds(top, x, yy) && !peekPix(chain, x, yy)) return true;
    return false;
  },
  mandel: (o, x, y) => {
    const a = evalRel(o.alpha, SIZE_RES);
    const iter = Math.max(10, a !== 0 ? a : 1000);
    const c = (x / Z / o.Wdt - 0.5 * (o.zoomX / Z)) * 4;
    const ci = (y / Z / o.Hgt - 0.5 * (o.zoomY / Z)) * 4;
    let zr = c;
    let zi = ci;
    let i = 0;
    for (; i < iter; i++) {
      const xz = zr * zr - zi * zi;
      zi = 2 * zr * zi + ci;
      zr = xz + c;
      if (zr * zr + zi * zi > 4) break;
    }
    return !(i < iter);
  },
  gradient: (o, x, y) => (Math.abs(Number((BigInt((x ^ (y * 3)) | 0) * 2531011n) % 214013n)) % Z) > Math.trunc(x / o.Wdt),
  // Script algorithms call the scenario script, which ReClonk doesn't have.
  script: () => false,
  rndall: (o) => o.seed % 100 < evalRel(o.alpha, SIZE_RES),
  poly: algoPolygon,
};

/** AlgoPolygon: inside the polygon of the overlay's points (crossings of a ray to the right). */
function algoPolygon(o: Overlay, iX: number, iY: number): boolean {
  const pts = o.children.filter((c): c is Point => c.kind === 'point');
  if (!pts.length) return false;
  // Start after the last point that isn't on this row.
  let start = pts.length - 1;
  while (start > 0 && pts[start].y * 100 === iY) start--;
  let uX = pts[start].x * 100;
  let uY = pts[start].y * 100;
  let lX = uX;
  let count = 0;
  let ignore = false;
  for (let k = 1; k <= pts.length; k++) {
    const p = pts[(start + k) % pts.length];
    const cX = p.x * 100;
    const cY = p.y * 100;
    if (ignore) {
      if (cY === iY) {
        if (lX < iX === iX < cX || cX === iX) return true;
      } else {
        if (uY < iY === iY < cY && lX >= iX) count++;
        ignore = false;
        uX = cX;
        uY = cY;
      }
    } else if (cY === iY) {
      if (cX === iX) return true;
      ignore = true;
    } else {
      if (uY < iY === iY <= cY) {
        if (iX < Math.min(uX, cX)) count++;
        else if (iX <= Math.max(uX, cX)) {
          const zX = Math.trunc(((cX - uX) * (iY - uY)) / (cY - uY)) + uX;
          if (iX < zX) count++;
          if (zX === iX) return true;
        }
      }
      uX = cX;
      uY = cY;
    }
    lX = cX;
  }
  return (count & 1) > 0;
}

/**
 * Read a map script and draw its map (the last map in it, like the original
 * when the scenario names none). The map is as big as the scenario's
 * landscape says. Throws MapScriptError if the script can't be read.
 */
export function runMapScript(script: string, l: LandscapeDef, rng: Rng, players: number): MapData {
  const root: Node = { kind: 'root', name: '', owner: null, children: [] };
  // C4MCMap::Default: the map is as big as the landscape's map size.
  const defaultMap = defaultOverlay('map');
  const size = mapSize(l, rng, players);
  defaultMap.Wdt = size.width;
  defaultMap.Hgt = size.height;
  const parser = new Parser(tokenize(script), defaultMap, (n) => evaluateTree(n, rng));
  parser.random = (n) => (n > 0 ? rng.int(n) : 0);
  parser.parseTo(root);
  let map: Overlay | null = null;
  for (let i = root.children.length - 1; i >= 0 && !map; i--) if (root.children[i].kind === 'map') map = root.children[i] as Overlay;
  if (!map) throw new MapScriptError('no map in the script');
  const w = map.Wdt;
  const h = map.Hgt;
  if (w <= 0 || h <= 0) throw new MapScriptError('the map is empty');
  const pix = new Uint8Array(w * h);
  const p = { v: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      p.v = 0;
      renderPix(map, x, y, p, 'none', false, true);
      pix[y * w + x] = p.v;
    }
  }
  return { width: w, height: h, pix };
}

/** Materials a map script names that the game doesn't have (they are left out of the map). */
export function missingMaterials(script: string): string[] {
  const names = new Set<string>();
  for (const m of script.matchAll(/\bmat\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  return [...names].filter((n) => n.toLowerCase() !== 'tunnel' && n.toLowerCase() !== 'sky' && !MATERIALS.some((m) => m.name.toLowerCase() === n.toLowerCase()));
}

/** Kept for the editor: whether the landscape is drawn by a script. */
export function usesMapScript(l: LandscapeDef): boolean {
  return typeof l.mapScript === 'string' && l.mapScript.trim().length > 0;
}
