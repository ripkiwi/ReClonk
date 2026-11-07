# ReClonk

An ode to one of my favourite games as a child, teen, and adult.

ReClonk is a free, non-profit, open-source reimagining of **Clonk** that runs in
the browser and is easy to mod. Dig, throw flints, mine gold, sell it at your base,
build huts, castles and elevators, buy more clonks. The classic loop, on modern tech.

> 'Clonk' is a registered trademark of Matthes Bender. ReClonk is a fan project,
> not affiliated with the original authors. See [CREDITS.md](CREDITS.md).

## Status

**Phase 3: crews, bases and fights.** Pick a player, pick a scenario, and play with the original Clonk graphics:

- **Main menu, players and scenarios**, laid out on the original Clonk Rage menu backgrounds.
- **Player profiles**, saved in the browser. Each player has a name, a shirt colour, a control style
  and a **crew** of clonks with names from the original name list. Hire more clonks, bench some,
  or dismiss them. The most experienced clonk that isn't benched goes into the next round.
- **Ranks and experience**, like the original: 24 ranks from Clonk to Premier, then "First Class",
  "Second Degree" and so on, with rank n at n^1.5 × 1000 experience. Clonks earn experience for
  every 5th command (original rule), finding gold (+20), blasting rocks and nuggets loose (+2 each)
  and finishing a round (+100). Promotions show up in game with a fanfare, and higher ranks climb,
  hang and swim faster (original rule, maxing out at rank 20).
- **Two scenarios:** *Gold Mine* (rolling hills, rock and gold veins, a lake, your home base) and
  *Minor Melee* (a pretty flat map with flints everywhere, three clonks against a computer crew).
- **Scenario settings**, like the original's scenario properties: map size and seed, hills, rock and gold veins,
  the lake, objects in the earth and on the surface, crew size and what each clonk carries, the home base
  (gold and shop stock), computer crews to play against and "last crew standing", with a map preview that follows every change. Editing a scenario that comes with the
  game saves a copy under *Your scenarios*; editing one of yours changes it. Your scenarios are kept in the browser.
- Walk, jump, climb walls, hang from ceilings, swim. Dig through earth and sand; rock, gold and granite can't be dug.
- A clonk carries one item. Throw it; flints explode on impact. Blasting rock and gold veins drops rocks and
  gold nuggets (one per 75 blasted pixels, like the original); granite only cracks.
- Flints, rocks and gold lie buried in the ground and come loose when you dig them out.
- In Gold Mine you start next to your own wooden hut. The flag on its roof makes it your **home base**; a hut without
  a flag is just a building you can shelter in. Jump in a doorway to go in, press down to come out.
- In your base: carried gold sells automatically (5 gold), you heal 2 energy every 3 ticks, and the base
  pays 5 gold per 100 energy, like the original. Buy flints (5), rocks (1) and clonks (25), or sell what you carry.
- **Crews like the original:** a new player starts with an empty crew. Each round brings in your most
  experienced clonk who takes part, or recruits a new one with a random name who joins your crew for good.
  Buying a clonk in your base works the same way. A clonk that dies stays in the crew with all it learned;
  it only sits out the rest of that round, and its death count goes up.
- **Several clonks at once:** switch between them or select the whole crew. Clonks you switch away from keep
  digging; with the whole crew selected, down gathers everyone at the leader. The crew bar on the left shows
  everyone in the round; click a portrait to switch, Shift-click to add it to the group.
- Flint blasts hurt clonks (a third of the blast level on a direct hit, half in the shock wave), and a clonk dies at 0 energy.
- **Thrown objects hurt** (the original's hit rule, 3× as strong): damage grows with the speed and weight of what
  hits you, and you get knocked back the way it flies. Something that keeps flying through a clonk keeps hitting it,
  so a lucky rock can hit a jumping clonk again and again. A clonk can't catch something flying at it, and can't be
  hit by what it has just thrown.
- **Fist fights:** clonks of different crews who run into each other start fighting, like the original: each round
  of the fight a clonk swings half the time, and half the swings land. A punch takes 5 energy between equals and more
  from a weaker fighter, up to 10, which knocks them over. `E` (`A` in classic) swings, down walks away.
- **Computer crews** (scenario setting, 0 to 3): they pick up flints and rocks, dig them out of the ground, aim their
  throws (leading a moving target, and never at their own crew), dodge incoming throws, and fight with their fists.
  Each one is as big and as experienced as your crew. Enemy bases keep their doors shut to you.
- **Last crew standing** (the original's Melee goal): a crew with no clonks left is out, and the round ends when only
  one is left. Victory and defeat show on the results screen, with the knockouts each clonk scored; a clonk is
  credited with a knockout when it was the last enemy to hurt the one that died.
- Higher ranks have more energy (50, plus 5 per rank up to rank 10).
- Lakes have sloping banks, so a clonk can always swim out.

Press `Esc` in game to pause or end the round. Ending a round saves what the crew learned.

### Controls

Each player picks a control style in the player screen.

**Jump'n'Run** (hold a key to walk, let go to stop):

| Keys | Action |
|---|---|
| `A` / `D` or `←` / `→` | Walk (hold) |
| `W`, `↑` or `Space` | Jump; climb up while on a wall; in a doorway, go in |
| `S` / `↓` | Climb down, let go of a ceiling, leave a building. With the whole crew selected: gather everyone at the leader |
| `Q` | Dig the way you hold (straight down if you hold nothing). The clonk keeps digging on its own, so you can switch to another clonk; hold `A`/`D`/`W`/`S` to steer, `Q` again stops |
| `Q` `Q` (quickly) | Use what you carry |
| `E` | Throw the carried item (drop it while climbing or swimming) |
| `Tab` / `Shift`+`Tab` | Next / previous clonk |
| `1` to `9` | Pick a clonk by its place in the crew bar |
| `R` | Select the whole crew |
| In a building | `↓` leave · in your base: `↑` buy menu (`←`/`→` choose, `↑`/`E` buy, `↓` close), `E` sell what you carry |

**Classic** (tap to start, tap to stop; the original's first keyboard layout):

| Keys | Action |
|---|---|
| `Z` (`Y` on German keyboards) / `C` or `←` / `→` | Start walking left / right |
| `X` or `↓` | Stop |
| `S` or `↑` | Jump; in a doorway, go in |
| `D` or `Enter` | Dig. While digging, `←` / `→` turn the direction one step; `X` stops |
| `D` `D` (quickly) | Use what you carry |
| `A` or `Space` | Throw |
| `Q` / `E` (or `Tab`), `1` to `9` | Previous / next clonk, pick a clonk (the original's crew cursor) |
| `W` | Select the whole crew; `X` `X` gathers everyone at the leader |
| In a building | `X`/`↓` leave · in your base: `S`/`↑` buy menu (`Z`/`C` or `←`/`→` choose, `S`/`↑`/`A` buy, `X`/`↓` close), `A` sell what you carry |

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
  game/        the World (steps everything, explosions, experience), scenarios,
               rounds, player profiles and ranks
  input/       keyboard to per-tick controls, per control style
  render/      PixiJS views: sky, textured landscape, sprites, camera, messages
  ui/          DOM menus, HUD and results screen over the canvas
  audio/       sound effects
  main.ts      loads everything and switches between menu and game
public/classic/  original Clonk graphics (CC BY-NC 4.0, see its README)
```

Movement, digging and contact rules are ported from the Clonk Rage engine (`C4Movement.cpp`,
`C4Object.cpp`, `C4ObjectCom.cpp`), and speeds come from the original `DefCore.txt` physicals,
so the clonk should feel like the original. Those files say so in a header comment.

The site's Content Security Policy forbids `eval`, so `main.ts` imports `pixi.js/unsafe-eval`
(despite the name, that module is what makes Pixi work *without* eval). Keep it, and don't add inline scripts to `index.html`.

## Roadmap

1. **Foundations** (done): project setup, landscape sandbox, CI, deploy.
2. **A clonk** (now): walk, jump, climb, swim, dig, throw rocks and flints that blast terrain;
   menus, player profiles, crews, ranks and the first two scenarios.
3. **Economy and bases** (started): huts and flags, healing, buying and selling, buying clonks, scenario settings,
   fights, thrown-object hits and computer crews are in; next: the original's Scenario Properties and map creator,
   foundations under buildings, construction kits, then castles and elevators.
4. **Modding and content:** a public modding API in TypeScript + JSON (the base game itself is a mod), boats, scenarios, a Classic content pack.
5. **Multiplayer:** lockstep over WebSockets, then a desktop build.

## License

Code is [ISC](LICENSE). ReClonk's own art and sound are CC0. The original Clonk graphics in
`public/classic/` are CC BY-NC 4.0 and may only be used non-commercially. Details, including
how original Clonk content is handled, are in [licenses/](licenses/README.md).
