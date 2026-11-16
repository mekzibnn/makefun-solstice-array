# Solstice Array — a three.js tactical FPS

A round-based tactical FPS in the Counter-Strike style, set at a desert solar
farm at golden hour. HELIOS (attack) vs UMBRA (defend). Sites: **A Mirror
Field** and **B Control Spire**. 12 rounds, first to 7. Plant/defuse objective,
round economy, six original weapons + three grenades, 4v4 bots.

## Play

```sh
node serve.ts   # then open http://localhost:8080
```

Click to play (pointer lock). WASD move, mouse look, click fire, RMB aim,
R reload, 1/2 weapons, G throw grenade, Q cycle grenade, E hold to plant or
defuse, B buy menu, Tab scoreboard, Ctrl crouch, Space jump.

## Screenshots

`?shot=combat`, `?shot=buy`, `?shot=objective`, `?shot=end` stage the four
dossier screenshots from the same game code. `?demo=1` runs a headless
bot-vs-bot playtest.

## Entry

Built for the make.fun `threejs-fps-01` bounty. `main.ts` (Node 22) copies
`game/` + `screenshots/` to `/output` and writes `dossier.json` with the
vendored `makefun-threejs.ts` library. three.js 0.187.0 is vendored under
`game/vendor/three/`. All art is procedural and all sound is synthesised
WebAudio — the game makes no network requests.

## License

MIT — see LICENSE.
