// Token Launch Radar — the value model (radar-2).
//
// The board ranks pre-token protocols by what a launch would be worth, using only the
// sealed snapshot's own figures. Nothing here names a protocol: the same function scores
// every row, and every number below is computed from the snapshot at run time.
//
//   sector multiple = the median live-token market-cap / TVL ratio of the protocol's
//                     own category, taken from the snapshot's live-token protocols.
//                     A category with fewer than 5 live samples falls back to the
//                     global median; the multiple is clamped to [0.08, 0.60].
//   base            = tvl_usd x sector multiple
//   momentum        = 1 + 0.5 x tanh(clamp(change_7d, -100, 200) / 40)
//   maturity        = 0.55 + 0.45 x (1 - exp(-age_days / 540)), age unknown: 365 days;
//                     past 4 years it decays slowly, never below 0.75 of itself
//   breadth         = 1 + 0.04 x min(chains, 6)
//   implied value   = max(1, round(base x momentum x maturity x breadth))
//
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko
// id, no symbol). The board covers the whole watchlist and adds pre-token protocols
// below the floor that pass the same wrapped / staked / bridged / versioned exclusions
// the watchlist rule uses, picked by growth-adjusted TVL. Protocols whose token already
// trades are kept apart in a Live view that shows the market's own market cap, never a
// model's number. Say a protocol "records no token", never that it has none.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  min_live_samples: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_divisor: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  maturity_decay_start_days: number;
  maturity_decay_floor: number;
  maturity_decay_span_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  min_live_samples: 5,
  multiple_floor: 0.08,
  multiple_cap: 0.6,
  momentum_weight: 0.5,
  momentum_divisor: 40,
  growth_floor: -100,
  growth_cap: 200,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_scale_days: 540,
  maturity_decay_start_days: 1460,
  maturity_decay_floor: 0.75,
  maturity_decay_span_days: 7300,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 6,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    sector_multiple: number;
    sector_live_samples: number;
    growth_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  sector_multiples: Record<string, { multiple: number; live_samples: number; fallback: boolean }>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The sector multiples, computed from the snapshot's own live-token protocols: for each
 * category, the median market-cap / TVL of its live protocols; categories with too few
 * live samples fall back to the global median. Every multiple is clamped to the model's
 * floor and cap and rounded to four decimals, so the same snapshot always yields the
 * same multiples.
 */
export function sectorMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { multiples: Map<string, { multiple: number; live_samples: number; fallback: boolean }>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  all.sort((a, b) => a - b);
  const globalRaw = median(all) ?? 0.2;
  const clamp = (v: number): number => Math.round(Math.min(model.multiple_cap, Math.max(model.multiple_floor, v)) * 1e4) / 1e4;
  const global = clamp(globalRaw);
  const multiples = new Map<string, { multiple: number; live_samples: number; fallback: boolean }>();
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    ratios.sort((a, b) => a - b);
    if (ratios.length >= model.min_live_samples) {
      multiples.set(category, { multiple: clamp(median(ratios) ?? globalRaw), live_samples: ratios.length, fallback: false });
    } else {
      multiples.set(category, { multiple: global, live_samples: ratios.length, fallback: true });
    }
  }
  return { multiples, global };
}

/** The sector multiple one protocol's category gets, with its sample count. */
function sectorFor(
  p: SnapshotProtocol,
  sectors: { multiples: Map<string, { multiple: number; live_samples: number; fallback: boolean }>; global: number },
): { multiple: number; live_samples: number; fallback: boolean } {
  if (p.category !== null) {
    const found = sectors.multiples.get(p.category);
    if (found !== undefined) return found;
  }
  return { multiple: sectors.global, live_samples: 0, fallback: true };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  sectors: { multiples: Map<string, { multiple: number; live_samples: number; fallback: boolean }>; global: number },
  model: ModelConstants = MODEL,
): {
  implied: number;
  sector: { multiple: number; live_samples: number; fallback: boolean };
  growthPct: number;
  momentumMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const sector = sectorFor(protocol, sectors);
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const momentumMult = 1 + model.momentum_weight * Math.tanh(growthPct / model.momentum_divisor);
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-ageForModel / model.maturity_scale_days));
  if (ageForModel > model.maturity_decay_start_days) {
    const decay = Math.max(
      model.maturity_decay_floor,
      1 - (ageForModel - model.maturity_decay_start_days) / model.maturity_decay_span_days,
    );
    maturityMult *= decay;
  }
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const base = protocol.tvl_usd * sector.multiple;
  const implied = Math.max(1, Math.round(base * momentumMult * maturityMult * breadthMult));
  return { implied, sector, growthPct, momentumMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped, staked or bridged product. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** An exchange whose name at the front marks its own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the same
 * wrapped / staked / bridged / versioned exclusions the watchlist rule uses.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const sectors = sectorMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer
  // carries (it cannot, but the board's coverage is the gate's row and is never gambled
  // on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the same
  // exclusions, picked by growth-adjusted TVL (TVL x momentum), never a replacement for
  // a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, discovery: p.tvl_usd * (1 + 0.5 * Math.tanh(finite(p.change_7d, 0) / 40)) }))
    .sort((a, b) => b.discovery - a.discovery || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((e) => e.p);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, sectors, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      sector_multiple: s.sector.multiple,
      sector_live_samples: s.sector.live_samples,
      growth_pct: s.growthPct,
      momentum_multiplier: s.momentumMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** What one transaction costs on a chain, in the words a farmer can budget with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $6 to $18 of gas per transaction';
  if (c.includes('solana')) return 'under $0.05 of gas per transaction';
  if (c.includes('tron')) return 'about $1 to $3 of gas per transaction';
  if (c.includes('bitcoin') || c.includes('bittensor')) return 'about $0.50 to $2 of gas per transaction';
  return 'about $0.10 to $2 of gas per transaction';
}

/** The category's first action, in the words a farmer can follow. */
function firstAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} and borrow a small amount against it, so the position shows both sides of the book.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity manager')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the LP position open.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('farm')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares it issues.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain} and put the bridged funds to work in its app.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's asset through ${name} and keep the receipt it issues.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one position in an active market on ${name}.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  return `Open a $${capital} position in ${name} on ${chain} and use the app's core feature the same day.`;
}

/** The category's weekly recurring action. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Repay a slice of the borrow and re-supply, so the position stays active every week.';
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity manager')) return 'Collect the pool fees, then add or remove a small amount of liquidity to refresh the position.';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('farm')) return 'Harvest or compound the vault yield once a week and leave the principal in place.';
  if (c.includes('bridge')) return 'Bridge a small amount again through the same route to keep the history current.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'Close and reopen the hedge once a week so the account keeps trading activity.';
  if (c.includes('rwa') || c.includes('real world')) return "Check the asset's yield accrual and add a small top-up once a week.";
  if (c.includes('stak') || c.includes('restak')) return 'Restake the rewards that accrued and keep the stake compounding.';
  if (c.includes('prediction')) return 'Settle one market and enter one new market each week.';
  if (c.includes('insurance')) return 'Review the cover and renew it before it lapses.';
  if (c.includes('stable')) return 'Move a small amount in and out of the stable asset to keep the wallet active.';
  return 'Use the app once a week: a deposit, a swap, a vote or a claim, whatever it offers.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Every step is one string, 20 to 600 characters.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps: string[] = [
    `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and fund it with enough of ${chain}'s gas token for a dozen transactions. Cost: ${gas}. Time: 10 minutes.`,
    `${firstAction(p, capital, chain)} Cost: $${capital} of capital and ${gas}. Time: 20 minutes to set up.`,
    `${weeklyAction(p)} Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    secondChain !== null
      ? `Repeat the core action on ${secondChain}, the protocol's second chain, so the farm is not tied to one network. Cost: $${Math.round(capital / 2)} of capital and ${gasFor(secondChain)}. Time: 20 minutes.`
      : `Open a second position type in the same protocol, such as supplying after lending or staking after depositing, so the wallet shows more than one behaviour. Cost: $${Math.round(capital / 2)} of capital and ${gas}. Time: 20 minutes.`,
    `Hold the positions for at least ${hold} days, so the activity is counted in more than one snapshot window. Cost: the $${capital} stays in the positions. Time: ${hold} days.`,
    `Before you withdraw anything, open the protocol's own points or rewards page from its official site and claim only through the link it publishes. Cost: no fee to check, and never pay anyone to claim for you. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, and unwind in stages instead of withdrawing everything at once. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const sectors = sectorMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const sectorRecord: Record<string, { multiple: number; live_samples: number; fallback: boolean }> = {};
  for (const [category, value] of [...sectors.multiples.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    sectorRecord[category] = value;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    sector_multiples: sectorRecord,
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
