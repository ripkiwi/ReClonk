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
- **The original's map creator.** Maps are made like in Clonk Rage (`C4MapCreator`, ported): a scenario
  describes its landscape with the original values (map width and height, zoom, amplitude, phase, period, random,
  water level, material layers, objects in the earth), the map creator draws a small map from them, and the
  landscape zoom turns every map pixel into a ragged chunk of material, drawn with the original textures
  (smooth, rough and ridged earth, rock and granite). Values can have a random range, and by default every round
  gets a new map, like the original.
- **Two scenarios with the original's values:** *Gold Mine* (gold veins, maybe a lake, your home base; the map gets
  wider for every crew) and *Minor Melee* (hills and lakes, flints in the earth and lying around, three
  clonks against a computer crew).
- **Scenario Properties**, laid out like the original's dialog: *Game* (goal, computer crews, description),
  *Equipment* (wealth, crew, buildings, what each clonk carries, home base material), *Landscape* (the original's
  coloured sliders with random ranges, top and bottom open, width according to player number, and the map
  preview with the screen size frame, layers and "preview for 1 to 4 players") and *Environment* (material layers,
  ground, objects in the earth and on the surface) and *Weather* (below). Editing a scenario that comes with the game saves a copy under
  *Your scenarios*; editing one of yours changes it. Your scenarios are kept in the browser.
- **Weather like the original** (`C4Weather` and its weather objects, ported), set on the *Weather* page with the
  original's sliders: climate, season, time advance, rain, thunderstorms, wind, earthquakes, meteorites and gravity.
  The year turns (YearSpeed 50 is a 6.5 minute year) and the temperature follows it; the wind changes every
  1000 ticks. Rain clouds (one per 500 pixels of map width) drop rain that collects in lakes, or snow below
  0 degrees that the wind blows sideways and piles up. Lakes freeze over from the top below -10 degrees and thaw
  from below above 10; snow melts above 5. Lightning zigzags down, hurts and knocks over clonks in its way and lights
  up the world; meteorites fall with a trail of smoke and sparks and explode where they hit; earthquakes knock clonks over, shake earth and sand loose and shake the view.
  Flags fly with the wind, the wind howls when it's strong, and there's thunder. Optional: season colours and a sky
  that drifts with the wind. Gold Mine and Minor Melee have the original's weather (no rain, gusty winds). Volcanoes
  wait for lava.
- **Basements:** huts stand on the original's 60×8 stone basement, guard towers on a 48×8 one. It can't be dug;
  nine flint blasts next to it break it into four rocks. Elevators have no basement.
- **Construction kits** (15 gold in your base): double dig opens the build menu (wooden hut, elevator, guard tower)
  and puts up a construction site where the clonk stands. Like the original, the site needs room (at most 5% solid)
  and level enough ground, and small dips under it (less than 20 pixels deep) are filled with the ground's own
  material, so a building on slightly skewed ground stands on solid ground. The clonk builds it up from the bottom
  (a hut takes about 18 seconds, a guard tower about 37); walk away to stop, press down at the site to carry on.
  Clonks you switch away from keep building.
- **Elevator:** its case hangs at the bottom with its floor level with the ground. Stand in it and press down to hold
  on: `Q` drills the shaft deeper through earth and sand (not rock), holding up or down rides (classic: tap up or down,
  left/right stops), left or right walks off. Whatever stands on the case rides along. A case that's free comes to
  a clonk of yours standing still next to the shaft, like the original. Enemies can't work your elevator.
- **Guard tower:** stone walls and a roof platform. Go in through the door and you come out on the roof, where you
  can throw over the battlements. Its two gates open when it's finished; press down in the tower to hold on to it,
  then left or right opens or shuts that gate. A shut gate keeps clonks out.
- Walk, jump, climb walls, hang from ceilings, swim. Dig through earth and sand; rock, gold and granite can't be dug.
- A clonk carries one item. Throw it; flints explode on impact. Blasting rock and gold veins drops rocks and
  gold nuggets (one per 75 blasted pixels, like the original); granite only cracks.
- Flints, rocks and gold lie buried in the ground and come loose when you dig them out.
- **More flints, like the original:** the T-flint lights its fuse when it lands (or on a double dig in your hands)
  and goes off 60 ticks later, wherever it is, even in your hands; the super T-flint burns 120 ticks for a
  bigger blast. Super-flints (radius 30) and tera-flints (40) explode on impact like flints (18).
- **Trees, bushes and grass:** Gold Mine and Minor Melee get the original's trees (Vegetation and
  VegetationLevel, now on the Environment tab). Trees sway in strong wind, grow slowly (15 minutes for the big
  one), and now and then seed a new one nearby, up to 40 in an area. Double dig at a tree to chop it: 10
  damage every 30 ticks, so a grown tree falls after about 13 seconds; flints damage and fell trees too, and a
  tree whose ground is blasted away falls over. Double dig at a felled tree to chop it into wood (7 for the big
  one), which sells for 2 gold. Grass grows along the earth and blows away in blasts.
- **Fire, like the original:** a flint that hits a tree sets it alight (10 blast damage; lightning does it too),
  and it turns into a black dead tree that burns away in about 28 seconds, falling over on the way. Burning
  things set fire to whatever their middle is in, every 35 ticks: a burning tree lights the trees it reaches
  into, a burning clonk the tree it runs through, and burning wood or a burning felled tree the clonk standing
  on it. A burning clonk loses an energy point every 5 ticks (about 7 seconds to live): jump into water or get
  into your home base to put it out. Blasts set wood (5 damage) and buildings alight: three flints for a wooden
  hut, a lot more for a guard tower. A burning building turns into its burned ruin, everyone inside comes out,
  the flag falls off, lifts and gates are gone, and it burns down in about 28 seconds; put out (in water) it can
  be built back up into the real thing, flag and all. Flames and smoke drift with the wind.
- **Vehicles, like the original:** the **sailboat** (15 gold), **balloon** (50) and **blimp** (100) come out of
  your base's door when you buy them. Press down at one to hold on to it, down twice to let go; throw lets go
  and throws. Push the boat along the ground into a lake: it floats and sets its sail. Swim to it, climb onto
  its deck and hold on to steer left or right (0.7 pixels a tick, a little more in a strong right wind, like the original);
  without anyone at the helm it drifts with the wind. Up twice raises the sail so you can push it back onto
  land. The balloon goes up and down as you say (1 pixel a tick) and drifts with the wind; let go and it
  sinks. The blimp flies wherever you steer it and turns round, pilot and all, to go the other way. Whoever
  stands on a deck or in a basket rides along. Vehicles float on water, burn (a blast of 35 sets one alight),
  and a burning balloon or blimp falls out of the sky.
- In Gold Mine you start next to your own wooden hut. The flag on its roof makes it your **home base**; a hut without
  a flag is just a building you can shelter in. Jump in a doorway to go in, press down to come out.
- In your base: carried gold sells automatically (5 gold), you heal 2 energy every 3 ticks, and the base
  pays 5 gold per 100 energy, like the original. Buy flints (5), T-flints (4), super-flints (10), wood (2), rocks (1), construction kits (15) and clonks (25),
  or sell what you carry.
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
- **Computer crews** (scenario property, 0 to 3): they pick up flints and rocks, dig them out of the ground, aim their
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
| `S` / `↓` | Climb down, let go of a ceiling, leave a building. At a construction site: build. In an elevator case, guard tower or vehicle: hold on to work it (`↓` `↓` lets go of a vehicle). With the whole crew selected: gather everyone at the leader |
| Holding a vehicle | Boat on land: `←`/`→` push it. Sailing: `←`/`→` steer, `↑` `↑` raise the sail. Balloon: hold `↑`/`↓` to rise or sink. Blimp: hold any direction |
| `Q` | Dig the way you hold (straight down if you hold nothing). The clonk keeps digging on its own, so you can switch to another clonk; hold `A`/`D`/`W`/`S` to steer, `Q` again stops |
| `Q` `Q` (quickly) | Use what you carry (a construction kit opens the build menu: `←`/`→` choose, `↑`/`E` build, `↓` close) |
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
| `D` `D` (quickly) | Use what you carry (a construction kit opens the build menu) |
| `X` `X` (quickly) | At a construction site: build. In an elevator case, guard tower or vehicle: hold on to work it; at a vehicle again: let go |
| Holding a vehicle | Boat on land: `Z`/`C` push it, `X` stop. Sailing: `Z`/`C` steer, `X` stop, `S` `S` raise the sail. Balloon: `S` up, `X` down (each press the other way stops). Blimp: each press turns its course one step that way |
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
  landscape/   material grid, flowing water, loose pixels (rain, snow), freezing and thawing,
               digging and blasting, the original's map creator
  objects/     clonk and item behaviour, ported movement physics, object definitions
  game/        the World (steps everything, explosions, experience), weather, scenarios,
               rounds, player profiles and ranks
  input/       keyboard to per-tick controls, per control style
  render/      PixiJS views: sky, textured landscape, sprites, camera, messages
  ui/          DOM menus, HUD and results screen over the canvas
  audio/       sound effects
  main.ts      loads everything and switches between menu and game
public/classic/  original Clonk graphics (CC BY-NC 4.0, see its README)
```

Movement, digging and contact rules are ported from the Clonk Rage engine (`C4Movement.cpp`,
`C4Object.cpp`, `C4ObjectCom.cpp`), the map creator and landscape zoom from `C4Map.cpp` and `C4Landscape.cpp`,
and speeds come from the original `DefCore.txt` physicals,
so the clonk should feel like the original. Those files say so in a header comment.

The site's Content Security Policy forbids `eval`, so `main.ts` imports `pixi.js/unsafe-eval`
(despite the name, that module is what makes Pixi work *without* eval). Keep it, and don't add inline scripts to `index.html`.

## Roadmap

1. **Foundations** (done): project setup, landscape sandbox, CI, deploy.
2. **A clonk** (now): walk, jump, climb, swim, dig, throw rocks and flints that blast terrain;
   menus, player profiles, crews, ranks and the first two scenarios.
3. **Economy and bases** (started): huts and flags, healing, buying and selling, buying clonks, fights,
   thrown-object hits, computer crews, the original's Scenario Properties and map creator, basements under
   buildings, construction kits, elevators, guard towers, weather, T-flints, super- and tera-flints, trees,
   chopping, wood, grass and fire are in.
4. **Modding and content:** a public modding API in TypeScript + JSON (the base game itself is a mod), boats, scenarios, a Classic content pack.
5. **Multiplayer:** lockstep over WebSockets, then a desktop build.

## License

Code is [ISC](LICENSE). ReClonk's own art and sound are CC0. The original Clonk graphics in
`public/classic/` are CC BY-NC 4.0 and may only be used non-commercially. Details, including
how original Clonk content is handled, are in [licenses/](licenses/README.md).
