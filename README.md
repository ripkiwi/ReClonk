# ReClonk

An ode to one of my favourite games as a child, teen, and adult.

ReClonk is a free, non-profit, open-source reimagining of **Clonk** that runs in
the browser and is easy to mod. Dig, throw flints, mine gold, sell it at your base,
build huts, castles and elevators, buy more clonks. The classic loop, on modern tech.

> 'Clonk' is a registered trademark of Matthes Bender. ReClonk is a fan project,
> not affiliated with the original authors. See [CREDITS.md](CREDITS.md).

## Status

**Phase 2: a playable clonk.** One clonk in a generated world, using the original Clonk graphics:

- Walk, jump, climb walls, hang from ceilings, swim.
- Dig through earth and sand. Rock, gold and granite can't be dug.
- Pick up items by walking over them. A clonk carries one item at a time.
- Throw what you carry. Flints explode on impact. Blasting rock and gold veins drops rocks and gold nuggets
  (one per 75 blasted pixels, like the original); granite only cracks.
- Flints, rocks and gold lie buried in the ground and come loose when you dig them out.
- You start next to your own wooden hut. The flag on its roof makes it your **home base**; a hut without
  a flag is just a building you can shelter in. Jump in a doorway to go in, press down to come out.
- In your base: carried gold sells automatically (5 gold), you heal 2 energy every 3 ticks, and the base
  pays 5 gold per 100 energy, like the original. Buy flints (5) and rocks (1), or sell what you carry.
- Flint blasts hurt clonks (a third of the blast level on a direct hit, half in the shock wave), and a clonk dies at 0 energy.

| Keys | Action |
|---|---|
| `A` / `D` or `←` / `→` | Walk (hold) |
| `W`, `↑` or `Space` | Jump; climb up while on a wall; in a doorway, go in |
| `S` / `↓` | Start digging. Hold a direction to keep digging that way (down, sideways, diagonal); let go to stop |
| `Q` or `E` | Throw the carried item (drop it while climbing or swimming) |
| In a building | `↓` leave · in your base: `↑` buy menu (`←`/`→` choose, `↑`/`Q` buy, `↓` close), `Q`/`E` sell what you carry |

Add `?seed=123` to the URL for a different map.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev        # local dev server with hot reload
npm test           # unit tests (Vitest)
npm run build      # type-check and build static files into dist/
npm run preview    # serve the built dist/ locally
```

`BASE_PATH=/some/path/ npm run build` builds for hosting under a sub-path instead of a domain root.

## How it's built

- **TypeScript + [PixiJS](https://pixijs.com/) v8**, bundled with **Vite**.
- **Deterministic simulation:** a fixed 36 ticks per second (like the original), a seeded RNG
  and integer math, so replays and lockstep multiplayer stay possible. Never use
  `Math.random()` or wall-clock time inside the simulation.
- **Simulation never touches rendering.** `src/landscape` is pure data and logic;
  `src/render` draws it.

```
src/
  core/        fixed-step loop, seeded RNG
  landscape/   material grid, flowing water, digging and blasting, map generator
  objects/     clonk and item behaviour, ported movement physics, object definitions
  game/        the World: steps everything, explosions
  input/       keyboard to per-tick controls
  render/      PixiJS views: sky, textured landscape, sprites, camera
  main.ts      wires it together
public/classic/  original Clonk graphics (CC BY-NC 4.0, see its README)
```

Movement, digging and contact rules are ported from the Clonk Rage engine (`C4Movement.cpp`,
`C4Object.cpp`, `C4ObjectCom.cpp`), and speeds come from the original `DefCore.txt` physicals,
so the clonk should feel like the original. Those files say so in a header comment.

The site's Content Security Policy forbids `eval`, so `main.ts` imports `pixi.js/unsafe-eval`
(despite the name, that module is what makes Pixi work *without* eval). Keep it, and don't add inline scripts to `index.html`.

## Roadmap

1. **Foundations** (done): project setup, landscape sandbox, CI, deploy.
2. **A clonk** (now): walk, jump, climb, swim, dig, throw rocks and flints that blast terrain.
3. **Economy and bases** (started): huts and flags, healing, buying and selling are in; next: buying clonks and kits, building castles and elevators.
4. **Modding and content:** a public modding API in TypeScript + JSON (the base game itself is a mod), boats, scenarios, a Classic content pack.
5. **Multiplayer:** lockstep over WebSockets, then a desktop build.

## License

Code is [ISC](LICENSE). ReClonk's own art and sound are CC0. The original Clonk graphics in
`public/classic/` are CC BY-NC 4.0 and may only be used non-commercially. Details, including
how original Clonk content is handled, are in [licenses/](licenses/README.md).
