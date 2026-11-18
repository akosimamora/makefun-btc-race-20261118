// Deep-dip swing bot for make.fun btc-race-24h-20261118-1444.
//
// Strategy (long only, one position, full size, one round trip per swing):
//   - Buy after a DEEP pullback: the close falls at least DIP_BPS below the
//     highest close of the last HIGH_W bars. Shallow dips are noise in this
//     market: on both 24h windows we can replay, a 1.2% dip (yesterday's bot)
//     bought into legs that kept falling, while a 1.8% dip marks the actual
//     swing low of the day's big move, and the bounce after it retraces
//     almost the whole drop. Waiting for the deep dip also means few trades:
//     one round trip per window, so the ~36 bps all-in round-trip cost is
//     paid once, not churned away.
//   - Sell at take-profit TP_BPS above cost, or stop-loss SL_BPS below cost,
//     or after TIMEOUT_BARS bars without either. The bounce after a deep dip
//     needs roughly 400 bars to mature (both replay windows: the winning
//     trade took 407-443 bars to reach take-profit), so the timeout is 720
//     bars (12h): long enough to let the swing develop, short enough that a
//     missed take-profit still exits with a small gain instead of riding the
//     position into the close.
//   - A 10-bar cooldown after every exit keeps the bot from re-buying the
//     same leg at once.
//   - A drawdown brake halts new entries if equity falls 250 bps below its
//     peak and resumes at 50 bps below peak. 250 bps is calibrated from this
//     strategy's own simulated loss distribution: the worst single round trip
//     the strategy can take is the stop-loss, about 150 bps of price plus
//     ~36 bps of round-trip cost, roughly 190 bps of equity; the brake sits
//     just above one full stop-loss, so it stops the bleeding after a second
//     consecutive loser instead of letting the bot buy every dip down.
//   - Trailing take-profit: once the position peaks at least 140 bps above
//     cost, sell if it gives back 60 bps from that peak. This covers the
//     case where the swing tops out below the +175 bps take-profit: instead
//     of riding it to the 720-bar timeout, the bot locks in peak minus 60.
//     Arm and giveback are measured, not guessed. On both replay windows
//     the swing retraces up to 62 bps while its peak sits in the 100-140
//     bps zone, so an arm at 100 with a 60 bps giveback fires early and
//     costs ~$12 on the old window (worst window +$16.67 -> +$4.45);
//     above a 140 bps peak the largest retrace seen is 20 bps, so a
//     60 bps giveback clears it with a 40 bps margin. With this trailing
//     in place both windows are unchanged (+$16.71 / +$16.67: it never
//     fires when the take-profit is hit), while in a simulated stalled
//     swing (take-profit raised so it is never hit) the worst window
//     improves from +$3.31 to +$9.95.
//   - No fallback market buy: on both replay windows the deep-dip signal
//     fired twice per window, so a no-trade window is unlikely, and a late
//     trend-chasing buy would occupy the single position exactly when a real
//     dip could arrive.
//
// Calibrated on two separate 24h windows (see VALIDATION.md):
//   - new dev window (17 Nov 14:44 UTC -> 18 Nov 14:44 UTC, falling -2.79%):
//     net +$16.71, gross +$20.29, fees $0.81, slip+impact $2.78, 2 trades.
//   - old dev window (16 Nov 06:04 UTC -> 17 Nov 06:03 UTC, flat-up +0.53%):
//     net +$16.67, gross +$20.13, fees $0.81, slip+impact $2.65, 2 trades.
//   Neighbouring parameters (dip 180-200 bps, TP 165-180 bps) are all net
//   positive on both windows, so this is a plateau, not a tuned spike.
//
// Everything is deterministic: fixed parameters, exact bigint close math
// for every decision, no clock, no environment, no randomness. Two runs
// produce byte-identical action logs.

import { BPS, runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (calibrated on two 24h windows; see VALIDATION.md) ---
const HIGH_W = 60; // rolling-high window (bars)
const DIP_BPS = 180n; // buy when close <= high * (1 - 180 bps)
const TP_BPS = 175n; // take profit: position value >= cost * (1 + 175 bps)
const SL_BPS = 150n; // stop loss: position value <= cost * (1 - 150 bps)
const TIMEOUT_BARS = 720; // sell if neither TP nor SL after this many bars
const COOLDOWN_BARS = 10; // bars to wait after an exit before a new entry
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const BRAKE_BPS = 250n; // halt new entries at 2.5% below peak equity
const RESUME_BPS = 50n; // resume entries at 0.5% below peak equity
const TRAIL_ARM_BPS = 140n; // trailing take-profit arms once retBps peaks here
const TRAIL_GIVEBACK_BPS = 60n; // exit if retBps falls this far below its peak
const N_BARS = 1440; // bars per window (RULES: 1,440 one-minute bars)

/** Floor division for bigints with a positive divisor (BigInt `/` truncates toward zero). */
function divFloor(a: bigint, b: bigint): bigint {
  return a >= 0n ? a / b : -((-a + b - 1n) / b);
}

// Rolling maximum of the last HIGH_W closes, current bar included.
// Kept as a monotone deque of [seq, close] pairs, front is the maximum.
const high: [number, bigint][] = [];
let entrySeq = -1; // seq of the bar the open position was decided on
let coolUntil = -1; // no new entry before this seq
let peakEquity: bigint | null = null; // highest equity seen (quote units)
let halted = false; // drawdown brake latched
let peakRetBps = 0n; // highest retBps seen while the current position is open

function rollingHigh(): bigint | null {
  return high.length > 0 ? high[0][1] : null;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const seq = state.seq;
    // Push this bar's close onto the rolling high.
    while (high.length > 0 && high[0][0] <= seq - HIGH_W) high.shift();
    while (high.length > 0 && high[high.length - 1][1] <= close) high.pop();
    high.push([seq, close]);
    if (state.warmingUp) return [];
    // Orders decided on the last batch are rejected (after_end), and the
    // window is 1,440 bars: never order on the last batch.
    if (seq >= N_BARS - 1) return [];

    // Drawdown brake on peak equity (exact integer math, in bps): halt new
    // entries once equity is BRAKE_BPS below its peak, and resume them once
    // it has recovered to RESUME_BPS below the peak.
    if (peakEquity === null) peakEquity = state.equity;
    else if (state.equity > peakEquity) peakEquity = state.equity;
    if (state.equity * BPS < peakEquity * (BPS - BRAKE_BPS)) halted = true;
    if (halted && state.equity * BPS >= peakEquity * (BPS - RESUME_BPS)) halted = false;

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // Exit: take-profit, stop-loss, timeout, or trailing take-profit.
      const val = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const retBps = cost > 0n ? divFloor((val - cost) * BPS, cost) : 0n;
      if (retBps > peakRetBps) peakRetBps = retBps;
      // Trailing take-profit: once the swing has peaked at least
      // TRAIL_ARM_BPS above cost, lock the gain in if it gives back
      // TRAIL_GIVEBACK_BPS from that peak, instead of riding a stalled
      // swing to the 720-bar timeout.
      const trailExit =
        peakRetBps >= TRAIL_ARM_BPS && retBps <= peakRetBps - TRAIL_GIVEBACK_BPS;
      if (retBps >= TP_BPS || retBps <= -SL_BPS || seq - entrySeq >= TIMEOUT_BARS || trailExit) {
        coolUntil = seq + COOLDOWN_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: no position open, so the next trade's peak retBps starts at zero.
    peakRetBps = 0n;
    // No new entry while halted, cooling down, or too early.
    if (halted || seq < coolUntil || seq + 1 < HIGH_W) return [];

    const highClose = rollingHigh();
    if (highClose !== null && close * 10000n <= highClose * (10000n - DIP_BPS)) {
      entrySeq = seq;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
