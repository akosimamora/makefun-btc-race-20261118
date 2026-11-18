# makefun-btc-race-20261118

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/akosimamora/makefun-btc-race-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/akosimamora/makefun-btc-race-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A BTC trading bot that trades Coinbase Wrapped BTC (cbBTC) minute by minute on 1-minute Orca Whirlpool bars. Deep-dip swing, long only: buys pullbacks of 1.8% or more below the 60-bar high, sells at +1.75% take-profit, -1.5% stop-loss, or after 720 bars, with a drawdown brake calibrated from the strategy's own loss distribution. Net PnL +$16.71 (+1.67%) on the new dev window and +$16.67 (+1.67%) on the previous race's dev window — one round trip per window, edge ~5.6x the all-in round-trip cost.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=1nmmcbpw&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
