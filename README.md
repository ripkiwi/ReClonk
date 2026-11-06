# ReClonk

An ode to one of my favourite games as a child, teen, and adult.

ReClonk is a free, non-profit, open-source reimagining of **Clonk** that runs in
the browser and is easy to mod. Dig, throw flints, mine gold, sell it at your base,
build huts, castles and elevators, buy more clonks. The classic loop, on modern tech.

> 'Clonk' is a registered trademark of Matthes Bender. ReClonk is a fan project,
> not affiliated with the original authors. See [CREDITS.md](CREDITS.md).

## Status

**Phase 0: foundations.** Right now it's a landscape sandbox: a generated world of
earth, sand, rock, gold, granite and water where sand falls and water flows.

| Key | Brush |
|---|---|
| `1` | Dig (counts the gold you dig up) |
| `2` | Sand |
| `3` | Water |
| `4` | Earth |

Hold the left mouse button to use the brush.

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
  landscape/   material grid, falling/flowing materials, digging, map generator
  render/      PixiJS views
  main.ts      wires it together
```

The site's Content Security Policy forbids `eval`, so `main.ts` imports `pixi.js/unsafe-eval`
(despite the name, that module is what makes Pixi work *without* eval). Keep it, and don't add inline scripts to `index.html`.

## Roadmap

1. **Foundations** (now): project setup, landscape sandbox, CI, deploy.
2. **A clonk:** walk, jump, climb, swim, dig, throw rocks and flints that blast terrain.
3. **Economy and bases:** huts and flags, healing, selling gold, buying clonks and kits, building castles and elevators.
4. **Modding and content:** a public modding API in TypeScript + JSON (the base game itself is a mod), boats, scenarios, a Classic content pack.
5. **Multiplayer:** lockstep over WebSockets, then a desktop build.

## License

Code is [ISC](LICENSE). ReClonk's own art and sound are CC0. Details, including
how original Clonk content is handled, are in [licenses/](licenses/README.md).
