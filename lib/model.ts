// Token launch radar: the value model.
//
// One sealed snapshot in, one ranked board out. The board ranks protocols
// that record no token, by the value a token would carry if the protocol's
// record stayed as it is. Protocols whose token already trades are kept
// apart: the dashboard shows them with the market's own market caps, never
// mixed into the ranked board.
//
// The implied value follows only from the snapshot's own figures:
//
//   base multiple  median(mcap_usd / tvl_usd) over the snapshot's live-token
//                  protocols that carry both figures, clamped to [0.05, 0.50].
//                  The market inside the snapshot sets the multiple; no
//                  constant is asserted and no protocol name is special-cased.
//   growth         change_7d winsorised to [-50, +100]; a missing value
//                  counts as 0. growth multiplier = 1 + 0.5 * growth / 100.
//   maturity       age in days from listed_at to as_of; a missing date is
//                  imputed at the median age of the ranked set. The multiplier
//                  saturates: 0.60 + 0.40 * (1 - exp(-age / 365)), so a
//                  protocol that has run longer with no token scores higher,
//                  with diminishing returns past the first years.
//   breadth        1 + 0.04 * min(max(chains - 1, 0), 5): a protocol live on
//                  more chains reaches more farmers. Capped at 1.20.
//   implied        round(tvl_usd * base * growth * maturity * breadth),
//                  clamped to [1, 100_000_000_000_000].
//
// The ranked set is every pre-token protocol except the products the
// watchlist's own rule sets aside: exchange products (category CEX),
// versioned pools (a name ending in a version marker), bridge / liquid
// staking / wrapped / staked products (their category, a wrapped/staked
// word in the name, or an exchange name at the start of the name). A
// wrapped or staked product of a token that already trades is not a token
// that does not exist yet, so it is not ranked as a launch; the dashboard
// lists every set-aside protocol with its reason, so the judgment is
// visible rather than silent. Watchlist slugs are always included: the
// watchlist is the floor, never the ceiling, and every watchlist slug
// passes this rule by construction.
//
// Farm plans are generated from each protocol's own record (category,
// chains, TVL, age): the same templates score every row. Nothing here names
// a protocol.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's calibrated constants: computed from the snapshot at run time. */
export interface Calibration {
  /** Median mcap/TVL of live-token protocols, clamped to [0.05, 0.50]. */
  base_multiple: number;
  /** How many live-token protocols carried both figures for the median. */
  calibration_n: number;
  /** Median age in days of the ranked set, used when listed_at is missing. */
  median_age_days: number;
  /** The growth, maturity and breadth shape constants (fixed by design). */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's reference view carries. */
export const LIVE_ROWS = 40;

/** The gate's cap on an implied value, in whole dollars. */
export const IMPLIED_CAP = 100_000_000_000_000;

const DAY_MS = 86_400_000;

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's version-marker rule: a name ending in a release marker. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products wrap, stake or bridge another protocol's asset. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a pre-token protocol is set aside from the ranking, or null. */
export function exclusionReason(p: Protocol): string | null {
  if (p.category === 'CEX') return 'Exchange product';
  if (VERSIONED.test(p.name)) return 'Versioned pool';
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) {
    return 'Bridge, wrapped or staked product';
  }
  if (WRAPPED_WORD.test(p.name)) return 'Bridge, wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'Exchange-named product';
  return null;
}

/** Whether a protocol belongs on the ranked board. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Calibrate the model from the snapshot's own figures. */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const raw = ratios.length > 0 ? median(ratios) : 0.25;
  const ages = snapshot.protocols
    .filter(isRankable)
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  return {
    base_multiple: clamp(raw, 0.05, 0.5),
    calibration_n: ratios.length,
    median_age_days: ages.length > 0 ? Math.round(median(ages)) : 365,
    growth_weight: 0.5,
    growth_floor: -50,
    growth_cap: 100,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_scale_days: 365,
    breadth_per_chain: 0.04,
    breadth_max_chains: 5,
  };
}

/** One protocol's score: the implied value and every factor behind it. */
export interface Score {
  implied: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  age_used: number;
  age_imputed: boolean;
}

export function scoreProtocol(
  p: Protocol,
  asOf: string,
  cal: Calibration,
): Score {
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? cal.median_age_days;
  const growthPct = clamp(
    typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)
      ? p.change_7d
      : 0,
    cal.growth_floor,
    cal.growth_cap,
  );
  const growthMultiplier = 1 + (growthPct / 100) * cal.growth_weight;
  const maturityMultiplier =
    cal.maturity_floor +
    cal.maturity_range * (1 - Math.exp(-ageUsed / cal.maturity_scale_days));
  const extraChains = clamp(p.chains.length - 1, 0, cal.breadth_max_chains);
  const breadthMultiplier = 1 + extraChains * cal.breadth_per_chain;
  const implied = clamp(
    Math.round(
      p.tvl_usd *
        cal.base_multiple *
        growthMultiplier *
        maturityMultiplier *
        breadthMultiplier,
    ),
    1,
    IMPLIED_CAP,
  );
  return {
    implied,
    growth_pct: growthPct,
    growth_multiplier: growthMultiplier,
    maturity_multiplier: maturityMultiplier,
    breadth_multiplier: breadthMultiplier,
    age_days: age,
    age_used: ageUsed,
    age_imputed: age === null,
  };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days_used: number;
    age_imputed: boolean;
  };
  farm_steps: string[];
}

/** A live-token protocol for the dashboard's reference view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** A pre-token protocol set aside from the ranking, with its reason. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  calibration: Calibration;
  universe_size: number;
  pre_token_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: watchlist first as a floor, then every other rankable protocol. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({
    p,
    score: scoreProtocol(p, snapshot.as_of, cal),
  }));
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Enforce a strictly falling implied value so rank order and value order
  // can never disagree after rounding. Values here are large; the walk
  // moves a row by at most a few dollars, and only on exact ties.
  let ceiling = Number.POSITIVE_INFINITY;
  const rows: BoardRow[] = scored.map((s, i) => {
    const implied = Math.max(1, Math.min(s.score.implied, ceiling - 1));
    ceiling = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      on_watchlist: watchlist.has(s.p.slug),
      age_days: s.score.age_days,
      implied_value_usd: implied,
      model: {
        base_multiple: cal.base_multiple,
        growth_pct: s.score.growth_pct,
        growth_multiplier: round4(s.score.growth_multiplier),
        maturity_multiplier: round4(s.score.maturity_multiplier),
        breadth_multiplier: round4(s.score.breadth_multiplier),
        age_days_used: s.score.age_used,
        age_imputed: s.score.age_imputed,
      },
      farm_steps: farmPlan(s.p, s.score.age_days),
    };
  });
  return rows;
}

/** The live-token reference set, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** The pre-token protocols set aside from the ranking, largest first. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p)!,
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** The board, the live set and the calibration, as one dashboard payload. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    calibration: cal,
    universe_size: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board,
    live,
    set_aside: setAsideRows(snapshot),
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function gasPhrase(chain: string): string {
  const cheap = new Set([
    'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Blast', 'Linea',
    'Scroll', 'zkSync Era', 'Mantle', 'Sui', 'Aptos', 'Sei', 'Injective',
  ]);
  const mid = new Set(['BSC', 'Avalanche', 'Fantom', 'Gnosis', 'Berachain', 'Hyperliquid', 'Monad']);
  if (chain === 'Ethereum') return '$8–$20 of gas per transaction';
  if (cheap.has(chain)) return 'under $1 of gas per transaction';
  if (mid.has(chain)) return '$0.30–$1 of gas per transaction';
  return '$1–$5 of gas per transaction';
}

/** Weekly gas for the recurring step, from the same chain tiering. */
function weeklyGas(chain: string): string {
  if (chain === 'Ethereum') return '$8–$20 of gas';
  if (chain === 'Solana') return 'under $0.50 of gas';
  return '$1–$5 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's core action, in words a farmer can follow. */
function primaryAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender, and do not borrow against it in the first week.`;
  if (c.includes('dex') || c.includes('liquidity manager') || c === 'farm')
    return `Add $${capital} of liquidity to ${name}'s highest-volume pool on ${chain} as a balanced pair, and keep the LP position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the destination app the same day.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Stake $${capital} through ${name} on ${chain} and hold the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, sized under 20% of the deposit.`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('vault'))
    return `Deposit $${capital} into ${name}'s flagship vault on ${chain} and hold the vault shares.`;
  if (c.includes('rwa') || c.includes('basis'))
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('stable') || c.includes('algo'))
    return `Mint or deposit $${capital} through ${name} on ${chain} and hold the position.`;
  if (c.includes('prediction'))
    return `Fund the wallet with $${capital} and place one position on ${name}'s nearest-resolving market.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use.`;
  if (c.includes('launchpad'))
    return `Commit $${capital} through ${name} on ${chain} to qualify for its sale allocations.`;
  if (c.includes('payment') || c.includes('card'))
    return `Route $${capital} of real spending through ${name} on ${chain} across the month.`;
  return `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the position open.`;
}

/** A second, different interaction, so the wallet shows more than one touch. */
function secondAction(p: Protocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp'))
    return `Borrow a small amount against the deposit on ${name}, then repay it in full within the same week.`;
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Run one swap through ${name} on ${chain} in a second pool, so the wallet shows trading as well as liquidity.`;
  if (c.includes('bridge'))
    return `Bridge a second, smaller amount back through ${name} a few days later, on a different day than the first bridge.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Claim or restake any rewards ${name} shows for the position, and keep the receipt in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Close the hedge and open a fresh one the following week, so the account shows repeated margin use.`;
  return `Use a second feature of ${name} once — a swap, a second pool, or a rewards claim — so the wallet shows more than one interaction type.`;
}

/** One step as a single string: the action, then its cost and its time. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age).
 */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasPhrase(chain);
  return [
    stepText(
      `Open a fresh wallet used only for this farm, write its seed phrase on paper, and fund it with gas on ${chain} plus the $${capital} position.`,
      gas,
      '10 minutes to set up',
    ),
    stepText(primaryAction(p, capital, chain), `$${capital} of capital plus ${gas}`, '20 minutes'),
    stepText(
      'Repeat one qualifying action every week — a top-up, a swap, or a new deposit — and never let the wallet sit idle for a full snapshot window.',
      `about ${weeklyGas(chain)} a week`,
      '10 minutes a week',
    ),
    stepText(secondAction(p, chain), gas, '15 minutes'),
    stepText(
      `Hold the position for at least ${hold} days so it appears in several snapshots, and check ${p.name}'s own points or rewards page weekly for new tasks.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `When a claim opens, use only the link ${p.name} publishes in its own app, verify the token contract there before approving anything, and log every transaction hash, date, and amount.`,
      `${gas} to claim and unwind`,
      '20 minutes, plus the claim window',
    ),
  ];
}

// ---------------------------------------------------------------- input / checks

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape scored. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: Protocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it is sound. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `the board holds ${board.length} rows, outside 100..4000`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `rank ${i + 1} outranks rank ${i} on implied value`;
    }
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares the same implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
