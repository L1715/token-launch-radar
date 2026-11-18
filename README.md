# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/L1715/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/L1715/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: pre-token protocols ranked by an implied value derived from the snapshot's own figures, each with a concrete farm plan. The base multiple is calibrated from the snapshot's live market (median market-cap-to-TVL ratio), growth is winsorised, maturity saturates with age, and breadth rewards multi-chain reach. No protocol name is ever special-cased, so a protocol that appears in a future snapshot is ranked the moment it arrives. The dashboard is a static page with no network requests: a sortable, filterable board, a detail view for every protocol with its value breakdown and farm plan, a separate live-token reference view, and a full method page. Built for the token-radar-01 bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads the sealed snapshot, writes `board.json`, the dashboard's `data.js`, and copies `dashboard/` and `screenshots/` into the output directory with a `dossier.json` built by the vendored make.fun library. Node 22.18+ (or newer), standard library only, deterministic: the same snapshot always writes the same bytes.

See [MODEL.md](MODEL.md) for the value model in full.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g3jk58gp&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
