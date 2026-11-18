# Value model

The board ranks protocols that record no token, by the value a token would
carry if the protocol's record stayed as it is. The model is implemented in
`lib/model.ts` (`calibrate`, `scoreProtocol`, `buildBoard`); this note states
it in one place for readers.

## Formula

```
implied_value_usd = TVL × base × growth × maturity × breadth
```

| Factor | Definition | Source |
| --- | --- | --- |
| `base` | Median of `mcap_usd / tvl_usd` over the snapshot's live-token protocols that carry both figures, clamped to [0.05, 0.50] | Computed at run time from the snapshot |
| `growth` | `1 + 0.5 × winsorised(change_7d)`, winsorised to [−50, +100]; a missing `change_7d` counts as 0 | Snapshot figure |
| `maturity` | `0.60 + 0.40 × (1 − exp(−age_days / 365))`, where `age_days` runs from `listed_at` to `as_of`; a missing `listed_at` is imputed at the median age of the ranked set | Snapshot figure |
| `breadth` | `1 + 0.04 × min(max(chains − 1, 0), 5)`, capped at 1.20 | Snapshot figure |

The result is rounded to whole dollars and clamped to [1, 10^14]. Rows are
sorted by implied value descending (ties: TVL descending, then slug), and a
final pass enforces a strictly falling value so rank order and value order
can never disagree after rounding.

## Why this shape

- **The multiple is calibrated, not asserted.** The snapshot's own live
  market says what a dollar of TVL is worth; the median keeps one outlier
  from moving it. On the sealed snapshot the calibration is 0.2138 over
  128 protocols (live-token protocols carrying a positive market cap).
- **Growth is winsorised.** Seven-day TVL changes in the snapshot run from
  −73% to +4,448%; an uncapped growth term would let one week dominate the
  board.
- **Maturity saturates.** Running longer with no token raises the score,
  with diminishing returns — the difference between 3 months and 1 year
  matters more than between 3 years and 4.
- **No name is special-cased.** Category is used only to pick the farm
  plan's action and the dashboard's filters, never to move a value. A
  protocol that appears in a future snapshot is ranked the moment it
  arrives, from its figures alone.

## What is ranked

- Every protocol that records no token (`mcap_usd`, `gecko_id` and `symbol`
  all null) and passes the exclusion rule below, including all 40 watchlist
  protocols, plus every other rankable protocol below the watchlist floor:
  197 rows on this snapshot, 157 of them early finds.
- Excluded, following the watchlist's own rule: exchange products (category
  `CEX`, 42 protocols), versioned pools (names ending in a version marker,
  11), and bridge / wrapped / staked products (bridge and liquid-staking
  categories, a wrapped/staked word in the name, or an exchange name at the
  start of the name — 92). A wrapped or staked product of a token that
  already trades is not a token that does not exist yet. The dashboard's
  Method page lists all 145 set-aside protocols with their reasons.
- Protocols whose token already trades are never ranked. The dashboard
  shows the top 40 by market cap separately, with the market's own values.

## Farm plans

Six steps per row, generated in `farmPlan` from the protocol's own record:
the action follows its category, the gas estimate follows its first chain,
the capital follows its TVL tier ($50–$250), and the holding period follows
its age (45–90 days). Every step states a cost and a time. Plans describe
activity a snapshot would see; they never promise an airdrop.

## Limits

A record that carries no token may simply be incomplete. TVL can be gamed,
seven days is a short window, and age is measured from the day tracking
began, not from launch. Implied value is this entry's own claim, never a
prediction of issuance, timing, or price.
