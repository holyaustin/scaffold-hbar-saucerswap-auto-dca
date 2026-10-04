# SaucerSwap Auto-DCA for Hedera

Recurring token buys on **SaucerSwap V2** that run themselves. No keeper bot, no cron job, no server.

- The **Hedera Schedule Service (HSS)** wakes the contract up for every purchase.
- **Pyth** prices both tokens before each swap. If the price is stale, uncertain or the pool is paying less than the oracle allows, the purchase is **skipped** instead of executed.
- **HTS** tokens are deposited, held and claimed by the vault (including the association step that trips up most newcomers).
- Before you spend gas, the web app asks **SaucerSwap's quoter** what the pool would pay right now and compares it with the oracle, so you can see "this purchase would be skipped" in advance.
- Every run emits an on-chain event that the Hedera **mirror node** serves, which is the audit trail the web app shows.
- An **optional relay** republishes those events to a **Hedera Consensus Service (HCS)** topic, giving you a tamper-evident public log that only your relay can write to.

A Next.js app lets you create a plan, watch the cadence of purchases, and see exactly why a run was skipped.

**No testnet account yet? Run `npm run demo:local`.** It starts the whole thing offline in about a minute, including the scheduler, and lets you break the market on purpose to watch the guard work. See [Try it first](#try-it-first-the-offline-demo).

> **Status:** testnet is live. Mainnet is fully configured but switched off ("coming soon") until you open it deliberately. See [Networks](#networks-testnet-live-mainnet-coming-soon).

## Judge's five-minute tour

0. **Run it with nothing set up:** `npm install`, then `npm run demo:local`, then open http://localhost:3000. Create a plan (the form is prefilled), then use **Demo controls** to make the oracle stale or the pool pay 20% less. See [Try it first](#try-it-first-the-offline-demo).
1. **See the safety logic:** open [`AutoDcaVault.sol`](packages/hardhat/contracts/AutoDcaVault.sol) and read `execute`, `_evaluate` and `_trySwap`. That is the whole idea: price both tokens, set a floor, swap or skip, schedule the next run.
2. **See it tested:** run `npm test`. 24 of the 61 Hardhat tests exercise the vault itself: every skip reason, the five-skip circuit breaker, scheduling failures and access control.
3. **See the network gating:** run `npm run setup` and try to pick Mainnet. It is listed, labelled "coming soon", and refused.
4. **See it live (needs testnet HBAR):** follow Steps 7 to 11 below, then open the vault's Events tab on HashScan after one interval.
5. **See the audit trail:** run the optional relay in [Step 13](#step-13-optional-publish-the-audit-trail-to-hcs) and open the topic on HashScan.

## Contents

1. [How it works](#how-it-works)
2. [Try it first: the offline demo](#try-it-first-the-offline-demo)
3. [Prerequisites](#prerequisites)
4. [Step-by-step setup](#step-by-step-setup)
5. [Networks](#networks-testnet-live-mainnet-coming-soon)
6. [Configuration reference](#configuration-reference)
7. [Contract reference](#contract-reference)
8. [Safety model and limits](#safety-model-and-limits)
9. [What is tested, and what you must verify on testnet](#what-is-tested-and-what-you-must-verify-on-testnet)
10. [Troubleshooting](#troubleshooting)
11. [Project structure](#project-structure)
12. [How this differs from the built-in templates](#how-this-differs-from-the-built-in-templates)

## How it works

```mermaid
sequenceDiagram
    participant U as You (wallet)
    participant V as AutoDcaVault
    participant H as HSS (0x16b)
    participant P as Pyth
    participant S as SaucerSwap V2

    U->>V: createPlan (deposits the whole budget)
    V->>V: associate tokens with HTS (0x167)
    V->>H: scheduleCall(execute(planId), now + interval)
    Note over H: The network holds the schedule. No bot.
    H->>V: execute(planId) at the scheduled second
    V->>P: getPriceNoOlderThan (both tokens)
    alt price stale, uncertain or invalid
        V-->>V: emit RunSkipped, keep the funds
    else price ok
        V->>S: exactInput(amountOutMinimum = oracle floor)
        alt pool pays less than the floor
            V-->>V: emit RunSkipped(SwapFailed)
        else swap succeeds
            V-->>V: emit RunExecuted, accrue tokens
        end
    end
    V->>H: scheduleCall(next run)
    U->>V: claim (collect the bought tokens)
```

More detail, including the plan state machine, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Why a guard instead of a plain swap?** A DCA bot that buys at any price will happily buy into a broken pool. The vault derives a minimum acceptable output from two Pyth prices and passes it to the router as `amountOutMinimum`. A bad pool price makes the router revert, and the vault records a skip instead of losing money. After five skips in a row the plan pauses itself so it cannot burn gas forever.

**A note on Pyth and autonomy.** Pyth is a *pull* oracle: prices only exist on-chain after somebody pushes a signed update. A scheduled run cannot fetch one from the internet, so it uses the newest price already on-chain and skips if it is older than your *max price age*. The app's **Refresh price** button (or anyone calling `refreshPrice`) keeps it fresh. This is a property of Pyth, not a bug, and the skip behaviour makes it safe.

**See the guard before you spend gas.** The web app shows a one-line verdict on every active plan. It combines the vault's oracle check (`previewRun`) with a live quote from SaucerSwap's QuoterV2 (an `eth_call`, no gas): for example, *"Price guard would skip: the pool pays 40 WHBAR, 20% less than the oracle's 50 WHBAR. Your limit is 5%."* If no quote is available the app says so and still shows the oracle side.

## Try it first: the offline demo

Want to see the whole loop before creating any accounts? The offline demo needs **no testnet account, no HBAR, no wallet extension and no API keys**.

```bash
npm install
npm run demo:local
```

Then open http://localhost:3000. The first run compiles the contracts, which downloads the Solidity compiler, so it needs internet once. After about a minute the terminal prints `Web app: http://localhost:3000`.

**What to do in the demo** (the whole thing takes about two minutes):

1. Click **Connect demo account**. It uses a built-in test account on the local node and holds 1000 mUSDC.
2. In **New plan**, everything is prefilled. Click **Deposit and start plan**. The plan buys every 10 seconds.
3. Watch the cadence strip fill in as purchases happen by themselves, and the **Recent activity** list grow.
4. In **Demo controls**, click **Make the pool pay 20% less**. The plan's verdict immediately changes to *would skip*, before any transaction, and the next purchase is skipped.
5. Click it again to restore, then try **Make the oracle price stale** for the other kind of skip.
6. When the plan finishes, click **Claim** to collect your mWHBAR.

Press Ctrl+C in the terminal to stop everything.

**What is real and what is a stand-in in the demo:**

| Piece | In the demo | On Hedera testnet |
|-------|-------------|-------------------|
| `AutoDcaVault` contract | The real contract, unchanged | Same |
| Web app and its price-guard verdict | The real app | Same |
| Scheduling | A script (the "scheduler" in the terminal) fires each scheduled call when it is due | The Hedera Schedule Service does it, inside the network |
| Token Service | A mock (association always succeeds) | Real HTS |
| Pyth | A mock oracle, kept fresh automatically | Real Pyth with signed updates |
| SaucerSwap router and quoter | Mocks that pay a fixed rate | Real pools and real liquidity |
| Explorer links | None (it is a local chain) | HashScan |

So the demo proves the contract's logic and the user experience. It does **not** prove the Hedera integrations: that needs a testnet run (Steps 7 to 11 below).

If a port is busy, the launcher tells you. Use `PORT=3001 npm run demo:local` for the web app. The local node needs port 8545.

## Prerequisites

Install or create each item below before you start. Commands assume macOS, Linux or Windows with WSL.

| # | You need | Why | How to get it / check it |
|---|----------|-----|--------------------------|
| 1 | **Node.js 20.18.3 or newer** | Runs the scaffold CLI, Hardhat and Next.js | Download from https://nodejs.org. Check with `node -v`. |
| 2 | **npm** (ships with Node) or Yarn | Installs dependencies | Check with `npm -v`. |
| 3 | **Git**, with your name and email set | The scaffold CLI initialises a repository | `git --version`, then `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` |
| 4 | **An EVM wallet** such as MetaMask | Signs transactions in the web app | https://metamask.io. The app adds the Hedera testnet network for you. |
| 5 | **A Hedera Portal account with an ECDSA key** | Gives you a deployer account and testnet HBAR | Sign up at https://portal.hedera.com, create an **ECDSA** account, copy its **HEX encoded private key**. |
| 6 | **Testnet HBAR** | Pays for deploying and for scheduled-run gas | Faucet: https://portal.hedera.com/faucet. About 50 HBAR is plenty. |
| 7 | **Two HTS tokens that share a SaucerSwap V2 pool on testnet** | The pair you will buy and sell | See [Step 8](#step-8-choose-your-token-pair-and-price-feeds). You need the **EVM address** of each token. |
| 8 | **Two Pyth price feed IDs** (USD pairs for those tokens) | The price guard | List: https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids |
| 9 | *(Optional)* **A Pyth API key** | Lets the app push fresh prices on-chain | Hermes now requires a key: https://docs.pyth.network/price-feeds/core/upgrade/preparing. `npm run setup` asks for it (Step 3). Without it everything else works. |
| 10 | *(Optional)* **Your Hedera account ID** (`0.0.12345`) | Only for the HCS audit relay, which pays for topic messages | Shown in the Hedera Portal next to your ECDSA account. |

Not needed: an LLM API key, Docker, or Foundry. This template uses Hardhat only.

## Step-by-step setup

Every command is run in a terminal. Lines starting with `#` are comments, not commands.

### Step 1. Create the project

```bash
npm create scaffold-hbar@latest my-auto-dca -- --template YOUR-GITHUB-NAME/YOUR-REPO-NAME
```

Replace the template argument with the `owner/repo` of the public GitHub repository that contains this project (the repository slug is `scaffold-hbar-saucerswap-auto-dca`).

> **Do not drop the `--` before `--template`.** npm swallows flags that come before it, so `npm create scaffold-hbar@latest --template owner/repo` silently builds the *default* template instead of this one. A GitHub pull request on the scaffold-hbar repository documents the same pitfall, and the bounty brief's example command omits the `--`. `npx create-scaffold-hbar@latest --template owner/repo` also works. When the CLI asks you questions, choose **Next.js**, **Hardhat** and **npm** (these are the only options this template allows). The CLI offers a network prompt too: choose **testnet**. See [Networks](#networks-testnet-live-mainnet-coming-soon) for why.

Then move into the new folder:

```bash
cd my-auto-dca
```

*Working from a downloaded zip instead?* Unzip it, `cd` into the folder, and continue at Step 2.

### Step 2. Install dependencies

```bash
npm install
```

This takes a few minutes. It installs all three packages (`config`, `hardhat`, `nextjs`) at once.

### Step 3. Run the setup wizard

```bash
npm run setup
```

It asks two things:

1. **Which network to use.** Press `1` for testnet. If you press `2`, it tells you mainnet is coming soon and asks again.
2. **Your Pyth API key (optional).** Paste it (nothing is shown on screen as you type) or press Enter to skip. Pyth's Hermes service needs a key to push fresh prices on-chain; get a free trial at https://docs.pyth.network/price-feeds/core/upgrade/preparing. The key is stored only in `packages/nextjs/.env.local`, is read by the server only and is never sent to the browser. Skipping is fine: everything works except the **Refresh price** button.

It then creates two local files from the examples:

- `packages/hardhat/.env` (holds your deployer key)
- `packages/nextjs/.env.local` (holds the web app settings, including your Pyth key if you gave one)

Both are git-ignored, so you cannot commit them by accident. Re-running the wizard never overwrites a file you edited: it only updates a value that changed. To add a key later without the prompt, run `npm run setup -- --pyth-key YOUR_KEY`.

### Step 4. Add your deployer key

Pick **one** option.

**Option A: use your Hedera Portal account (recommended).** Open `packages/hardhat/.env` and paste your HEX private key after `DEPLOYER_PRIVATE_KEY=`. It must be 64 hex characters (a leading `0x` is fine). Do not use a DER-encoded key (a long string starting `3030...`).

**Option B: generate a fresh key.**

```bash
npm run hardhat:account
```

This writes a new key into `packages/hardhat/.env` and prints its EVM address.

### Step 5. Fund the deployer

- Option A: your Portal account already has HBAR if you used the faucet.
- Option B: send testnet HBAR to the printed address from your Portal account. The account is created on Hedera the first time it receives HBAR.

### Step 6. Run the tests (about one minute, no network or HBAR needed)

```bash
npm test
```

You should see everything pass: **11 setup and launcher tests**, **7 config tests**, **61 Hardhat package tests** and **50 web app tests**. The contract tests replace the Hedera system contracts with mocks, because the Schedule Service does not exist on a local node.

### Step 7. Deploy the vault to testnet

```bash
npm run hardhat:deploy
```

On success it prints the vault address and HashScan links, sends 5 HBAR to the vault for scheduled-run gas, and records the address in `packages/hardhat/deployments/testnet.json` and `packages/nextjs/lib/deployments.json`. The web app reads the second file.

Optional settings (put them in `packages/hardhat/.env`): `FUND_HBAR`, `SCHEDULED_CALL_GAS_LIMIT`, `MIN_INTERVAL_SECONDS`.

**Keep the printed deploy transaction link.** It is part of your submission evidence.

### Step 8. Choose your token pair and price feeds

This step is where most people lose time, so read it fully before starting. You need three things: two HTS tokens, a SaucerSwap V2 pool that connects them, and a Pyth USD price feed for **each** token.

**8a. Know which testnet tokens exist.** Token IDs are different on testnet and mainnet. Never reuse a mainnet ID. These were checked against public SaucerSwap and community sources on 24 to 26 September 2026, so confirm each on HashScan before relying on it:

| Token | Testnet ID | EVM address | Notes |
|-------|-----------|-------------|-------|
| USDC (SaucerSwap's testnet USDC) | `0.0.5449` | `0x0000000000000000000000000000000000001549` | **Not** Circle's testnet USDC `0.0.429274`, which has no SaucerSwap pool |
| WHBAR (wrapped HBAR) | `0.0.15058` | `0x0000000000000000000000000000000000003ad2` | The token SaucerSwap pools use. Wrapping HBAR into *this* token is not covered here |
| SAUCE | `0.0.1183558` | run the command below | Has a WHBAR pool, but no Pyth feed has been confirmed for it |

Convert any `0.0.N` to an EVM address with:

```bash
node -e "console.log(require('./packages/config').idToEvmAddress('0.0.5449'))"
```

**8b. Know the pools.** SaucerSwap's V2 factory on testnet is `0.0.1197038`. A WHBAR/USDC V2 pool at fee tier `3000` was reported to exist on 26 September 2026. The SaucerSwap testnet app (https://testnet.saucerswap.finance) lists pools.

**Check your pair before anything else.** This read-only command needs no key and spends nothing. It tests all four fee tiers for your pair, shows each pool's liquidity, and explains common mistakes (for example using the WHBAR *contract* `0.0.15057` instead of the WHBAR *token* `0.0.15058`, or Circle's USDC instead of SaucerSwap's):

```bash
TOKEN_IN=0x0000000000000000000000000000000000001549 TOKEN_OUT=0x0000000000000000000000000000000000003ad2 npm run hardhat:check-pair
```

Run it with no variables to check USDC against WHBAR. It exits with an error when the pair is not usable, and its last lines say what to change. `npm run hardhat:demo-plan` runs the same check and stops with the same advice.

**8c. Get the tokens into your account.** Testnet tokens have no faucet of their own. You get them by swapping testnet HBAR on the SaucerSwap testnet app:

1. Use **one account everywhere**: your Portal ECDSA account. Import its HEX private key into MetaMask (Import account) and, if the SaucerSwap app needs it, into HashPack. The account then has the same EVM address in every tool.
2. Fund it with HBAR at https://portal.hedera.com/faucet.
3. Open https://testnet.saucerswap.finance/trade and connect a wallet that the app offers.
4. Sell HBAR and buy USDC, choosing the one with ID `0.0.5449`. Several tokens can share the name USDC, so check the ID. Approve any association prompts.
5. Confirm on HashScan (https://hashscan.io/testnet) that your account page lists USDC `0.0.5449` with a balance.

**If the app's swap fails** (for example with a "Slippage" error), try these in order:

1. Open the failed transaction on HashScan (the hash is in the error). The revert reason is on that page, and it tells you whether this is slippage, an expired quote or a missing association.
2. Swap a smaller amount (1 to 5 HBAR). Testnet pools are thin, so a large swap moves the price.
3. Raise the slippage tolerance in the app's settings and retry.
4. Use the command line instead. It buys USDC through SaucerSwap's V1 router, which is separate from the contract the web app used:

   ```bash
   HBAR_TO_SWAP=10 SLIPPAGE_PCT=10 npm run hardhat:get-usdc
   ```

   It associates your account with USDC if needed, asks the router for a quote, and swaps with the slippage you allow. It prints the transaction and account links.

**8d. Pick the Pyth feeds.** Each token needs a USD feed from https://docs.pyth.network/price-feeds/core/price-feed-ids. Use the regular (stable) IDs on Hedera testnet.

- USDC/USD is `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` (listed in several Pyth documentation pages).
- Find HBAR/USD on the same Pyth page by searching "HBAR". Treat WHBAR as HBAR for pricing.
- **Check any ID before using it.** With your Pyth key, ask Hermes for the latest price and confirm it matches the real market:

  ```bash
  curl -sg -H "Authorization: Bearer YOUR_PYTH_KEY" \
    "https://hermes.pyth.network/v2/updates/price/latest?ids[]=THE_FEED_ID&parsed=true"
  ```

  In the answer, the real price is `price` multiplied by 10 to the power of `expo`. HBAR should be roughly ten US cents. A wrong or unsupported ID returns an error or an absurd price.

**8e. Know what to expect on testnet.** Testnet pools are seeded with arbitrary prices, and Pyth reports real market prices. On 26 September 2026 the testnet WHBAR/USDC pools priced HBAR at about two US dollars while Pyth said about nine US cents. So for a plan that **sells USDC to buy WHBAR**, the pool pays roughly 95% less than the oracle expects, and the guard will **skip every run**. That is the guard working, and it is a genuine live demonstration of it, but it also means this pair will not produce an executed purchase on testnet. The plan card shows the verdict ("would skip: the pool pays X% less than the oracle") before any run happens. Treat a skip here as a correct result, not a bug.

**8f. Before the scheduled run, push a fresh price.** Pyth only has a price on-chain after someone pushes one, so click **Refresh price** in the app (this needs your Pyth key from Step 3) shortly before the first run. Without it the run skips as "price too old".

### Step 9. Create your first plan

**From the command line:** add these lines to `packages/hardhat/.env`, filling in your own values:

```bash
TOKEN_IN=0x...          # token you sell (EVM address)
TOKEN_OUT=0x...         # token you buy (EVM address)
POOL_FEE=3000           # 500, 1500, 3000 or 10000
AMOUNT_PER_RUN=1        # whole tokens per purchase
RUNS=3
INTERVAL_SECONDS=120    # 2 minutes, handy for a demo
PRICE_ID_IN=0x...       # Pyth feed ID for the token you sell
PRICE_ID_OUT=0x...      # Pyth feed ID for the token you buy
```

Then run:

```bash
npm run hardhat:demo-plan
```

The script first checks that SaucerSwap really has a pool for your pair and fee tier, so a typo fails loudly instead of silently. It approves the budget and creates the plan.

**From the web app:** do Step 10 first, then use the **New plan** form (it does the same approval and creation from your wallet).

### Step 10. Start the web app

```bash
npm run next:dev
```

Open http://localhost:3000, click **Connect wallet**, and approve the network switch to Hedera testnet. You will see your plans with their cadence strip: one dot per purchase (filled when bought, ringed for the next).

If you skipped the Pyth key in Step 3, the **Refresh price** button will explain that no key is configured. Add `PYTH_API_KEY=...` to `packages/nextjs/.env.local` (or run `npm run setup -- --pyth-key YOUR_KEY`) and restart the app.

### Step 11. Watch it run itself

Wait one interval. Without you doing anything, the Schedule Service calls the vault. Then check:

- the **Recent activity** list in the app (bought, or skipped with the reason),
- the vault's **Events** tab on HashScan: `https://hashscan.io/testnet/contract/<vault address>/events`,
- the scheduled transaction on HashScan, whose "from" is the schedule service, not a wallet.

To see the guard work, set a very tight price age (for example 1 second) and watch a run get skipped with "Price too old".

### Step 12. Collect your purchases

Click **Claim** on a plan. The app associates you with the bought token if needed, then transfers it to your wallet.

### Step 13. Optional: publish the audit trail to HCS

A smart contract cannot write to the Hedera Consensus Service, so this template uses a small **relay**. It reads the vault's events from the mirror node and posts each one as a JSON message to an HCS topic. The topic's *submit key* is your key, so nobody else can add messages, which makes the topic a tamper-evident public log of every purchase and skip.

1. Add your Hedera account ID to `packages/hardhat/.env` (the account that owns `DEPLOYER_PRIVATE_KEY`):

   ```bash
   HEDERA_ACCOUNT_ID=0.0.12345
   ```

2. Publish everything so far:

   ```bash
   npm run hardhat:audit-relay
   ```

   The first run creates the topic, prints its HashScan link and saves its ID (`packages/hardhat/deployments/testnet.json` and `packages/nextjs/lib/deployments.json`). The web app then shows an **HCS audit trail** link. Later runs publish only new events.

3. To keep publishing as events happen, add `RELAY_WATCH=true` to `packages/hardhat/.env` and run the same command. It checks every 30 seconds (`RELAY_INTERVAL_SECONDS`).

What a message looks like (one per event, always under 1000 bytes):

```json
{"v":1,"vault":"0x...","chainId":296,"event":"RunSkipped","planId":"1","args":{"reason":"1"},"txHash":"0x...","consensusTimestamp":"1790000000.123456789"}
```

Good to know:

- **It is an attestation by your relay, not by the contract.** Each record includes the transaction hash, so anyone can check it against the mirror node.
- **Delivery is at-least-once.** If the relay stops between publishing and saving its position, one record can appear twice. Consumers should de-duplicate on `txHash`, `event` and `planId`.
- The relay's resume position is stored locally in `packages/hardhat/deployments/hcs-relay-state.testnet.json` (git-ignored). Delete it to republish from the beginning.

### Before you publish or submit

```bash
npm run lint      # ESLint + TypeScript
npm test          # all tests
npm run build     # compiles contracts, builds the web app
```

Then re-create the project from your GitHub repo with the `npm create scaffold-hbar` command from Step 1 in an empty folder and repeat `npm install`, `npm run lint`, `npm run build`. Confirm there is no `.env` file in your repository (`git ls-files | grep env` should only show `.env.example` files).

## Networks: testnet live, mainnet coming soon

Both Hedera networks are defined in one file, [`packages/config/index.js`](packages/config/index.js): chain IDs, RPC and mirror node URLs, explorer links, the Pyth contract and the SaucerSwap V2 contract IDs. Each network has a `status`:

| Network | Status | What that means in this template |
|---------|--------|----------------------------------|
| Testnet (chain 296) | `live` | Deploy, create plans, run. |
| Mainnet (chain 295) | `coming-soon` | Configured, but every entry point refuses it. |

Where "coming soon" is enforced:

- **Setup wizard** (`npm run setup`): lists Mainnet with a "coming soon" label and will not accept it.
- **Web app**: the network switch shows a disabled Mainnet button with a "Coming soon" tag. If the app is started with `NEXT_PUBLIC_HEDERA_NETWORK=mainnet` it shows a notice and offers no way to connect or sign.
- **Deploy and demo scripts**: `--network hederaMainnet` fails with a clear message (see `packages/hardhat/lib/target.ts`).

**The scaffold CLI's own network prompt.** `create-scaffold-hbar` asks for `testnet` or `mainnet` itself, and a template cannot rename or disable options in that prompt (the `template.json` manifest only controls frontend, Solidity framework and package manager). If a user picks mainnet there, this template still behaves safely, because the checks above do not depend on the CLI's answer.

**To open mainnet later:** change `status` to `"live"` for mainnet in `packages/config/index.js`, review the contract against your own audit standards, set `NEXT_PUBLIC_HEDERA_NETWORK=mainnet`, and deploy with `--network hederaMainnet`. Nothing else needs to change.

## Configuration reference

### `packages/hardhat/.env`

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DEPLOYER_PRIVATE_KEY` | to deploy | none | HEX ECDSA private key of the deploying account |
| `HEDERA_TESTNET_RPC_URL` | no | `https://testnet.hashio.io/api` | JSON-RPC endpoint |
| `SCHEDULED_CALL_GAS_LIMIT` | no | `2000000` | Gas given to each scheduled run |
| `MIN_INTERVAL_SECONDS` | no | `60` | Shortest allowed plan interval |
| `FUND_HBAR` | no | `5` | HBAR sent to the vault after deploy, for scheduled-run gas |
| `HEDERA_ACCOUNT_ID` | for the relay | none | Your Hedera account ID (`0.0.N`), which pays for HCS messages |
| `HCS_TOPIC_ID` | no | created on first relay run | Reuse an existing audit topic |
| `RELAY_WATCH` | no | `false` | `true` keeps the relay running |
| `RELAY_INTERVAL_SECONDS` | no | `30` | Polling interval in watch mode |
| `HBAR_TO_SWAP` | no | `10` | HBAR spent by `hardhat:get-usdc` |
| `SLIPPAGE_PCT` | no | `10` | Slippage allowed by `hardhat:get-usdc`, in percent |
| `TOKEN_IN`, `TOKEN_OUT`, `POOL_FEE`, `AMOUNT_PER_RUN`, `RUNS`, `INTERVAL_SECONDS`, `MAX_SLIPPAGE_BPS`, `MAX_CONF_BPS`, `MAX_PRICE_AGE`, `PRICE_ID_IN`, `PRICE_ID_OUT` | for `demo-plan` | see `.env.example` | Demo plan parameters |

### `packages/nextjs/.env.local`

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_HEDERA_NETWORK` | no | `testnet` | `testnet`, or `mainnet` for the coming-soon notice |
| `NEXT_PUBLIC_VAULT_ADDRESS` | no | from `deployments.json` | Use a vault you deployed elsewhere |
| `PYTH_API_KEY` | no | none | Server-side Hermes key, enables **Refresh price** |
| `PYTH_HERMES_URL` | no | `https://hermes.pyth.network` | Hermes endpoint |
| `NEXT_PUBLIC_HCS_TOPIC_ID` | no | from `deployments.json` | Show a link to your audit topic |

The offline demo sets `NEXT_PUBLIC_HEDERA_NETWORK=local` itself and needs no `.env` files. `PORT` (default `3000`) changes the demo's web port.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run demo:local` | Offline demo: local node, mock services, scheduler and web app (no accounts needed) |
| `npm run setup` | Network choice and local env files |
| `npm run hardhat:compile` | Compile contracts |
| `npm run hardhat:test` | Contract tests |
| `npm run hardhat:account` | Generate a deployer key |
| `npm run hardhat:check-pair` | Read-only check that a token pair has a usable SaucerSwap V2 pool (all fee tiers) |
| `npm run hardhat:get-usdc` | Buy testnet USDC with testnet HBAR from the command line |
| `npm run hardhat:deploy` | Deploy the vault to testnet |
| `npm run hardhat:demo-plan` | Create a plan from `.env` values |
| `npm run hardhat:audit-relay` | Publish run events to an HCS topic (optional) |
| `npm run hardhat:abi` | Regenerate the web app's ABI after a contract change |
| `npm run setup -- --pyth-key KEY` | Save a Pyth key without the prompt |
| `npm run next:dev` / `next:build` / `next:start` | Web app |
| `npm run lint` / `test` / `build` | Everything |

## Contract reference

Source: [`packages/hardhat/contracts/AutoDcaVault.sol`](packages/hardhat/contracts/AutoDcaVault.sol).

| Function | Who | What it does |
|----------|-----|--------------|
| `createPlan(params)` | anyone | Validates, associates both tokens, pulls `amountPerRun x runs`, schedules the first run |
| `execute(planId)` | HSS, or anyone once due | Runs the Pyth guard, swaps, records the result, schedules the next run |
| `pausePlan` / `resumePlan` | plan owner | Stop or restart a plan (resume reschedules) |
| `cancelPlan` | plan owner | Stop and refund the unsold tokens |
| `claim` | plan owner | Withdraw bought tokens |
| `refreshPrice(updateData)` | anyone, pays the fee | Push a signed Pyth update on-chain, refunds excess |
| `previewRun(planId)` | view | What `execute` would do now (powers the guard badge) |
| `getPlan`, `getPlanIds` | view | Read plans |
| `withdrawHbar` | contract owner | Recover gas HBAR. Cannot touch user tokens. |

Events: `PlanCreated`, `RunScheduled`, `ScheduleFailed`, `RunExecuted`, `RunSkipped`, `PlanPaused`, `PlanResumed`, `PlanCompleted`, `PlanCancelled`, `Claimed`, `PriceRefreshed`.

## Safety model and limits

- The full budget is deposited up front, so a plan can never spend more than you put in.
- The contract owner can only withdraw the vault's HBAR gas reserve, never user tokens.
- `execute` is permissionless once a plan is due. Callers cannot change amounts, tokens or limits.
- A failed schedule never loses a plan: `ScheduleFailed` is emitted, `scheduled` becomes `false`, and anyone can call `execute` when it is due.
- Cancelled, paused and finished plans ignore stale scheduled calls silently.
- This is a **reference design, not audited**. Do not put real funds into a deployment of it without a professional review.

## What is tested, and what you must verify on testnet

**Verified automatically (run `npm test`):**

- 24 vault tests covering plan creation and validation, HSS scheduling and retries, the busy-second search, execution accounting, every skip reason, the five-skip circuit breaker, pause, resume, cancel, claim, access control, oracle refresh and refunds, and the HBAR admin path.
- 6 deploy-helper tests (key parsing and the mainnet guard) and 1 drift test that fails if the web app's ABI no longer matches the compiled contract.
- 13 tests for the testnet helpers: the pair checker (fee tiers, token order, liquidity, and the classic address mix-ups) and the HBAR-to-USDC swap (association first, quote, slippage, drift, empty pool).
- 12 relay tests: event decoding, ordering and resuming inside a transaction, message size limits, and the Hedera SDK transaction builders (built and frozen offline).
- 50 web app tests covering formatting, form validation, mirror node log decoding, the pool-versus-oracle comparison and its wording, demo config validation, local event reading, network gating and both API routes.
- 5 demo tests: the demo deployment, a full plan run by the emulated scheduler, a stale-oracle skip, a bad-pool skip, and the mock quoter matching SaucerSwap's documented `quoteExactInput` signature.
- 11 setup and launcher tests: network gating, saving the Pyth key without ever printing it, safe re-runs, and the launcher's port and polling helpers.
- 7 config tests for the Hedera ID to EVM address conversion, the network registry and the separate local demo network.

**Not verifiable without a live network. Check each one on testnet and fix the template if the result differs:**

1. **A real scheduled execution.** The Hardhat network has no HSS, so tests use a mock placed at `0x16b`. Confirm that after one interval the vault runs by itself, and that `SCHEDULED_CALL_GAS_LIMIT` (2,000,000) is enough for your pair.
2. **A real SaucerSwap swap** for your pair, including that the router can pull the approved tokens from the vault.
3. **Your Pyth feed IDs.** The template ships no defaults on purpose. A wrong ID makes every run skip as "Price too old".
4. **Pyth fee units.** `refreshPrice` assumes `getUpdateFee` returns the EVM's native unit (tinybar) and the app sends double the fee converted to weibar, with the vault refunding the excess. If the transaction fails with an insufficient-fee or insufficient-balance error, adjust `TINYBAR_TO_WEIBAR` in `packages/nextjs/lib/wallet.ts`.
5. **Token association from your wallet** (`associate()` and `isAssociated()` from HIP-719) as used by **Claim** and `npm run hardhat:associate`.
6. **The mirror node log response shape and the `timestamp=gte:` filter** used by the activity feed and the relay. Both are tested against fixtures only. If the feed stays empty, plan data still loads from the chain.
7. **Publishing to a real HCS topic.** The relay's SDK calls are validated offline, but creating a topic and submitting messages needs your funded account. Run `npm run hardhat:audit-relay` and confirm the messages appear on HashScan.
9. **The command-line swap and pair checker on testnet.** `hardhat:get-usdc` uses SaucerSwap's V1 router (`0.0.19264`) with `getAmountsOut` and `swapExactETHForTokens`, and `hardhat:check-pair` reads the V2 factory. Both are tested against mocks only. If either fails, the error message and the HashScan transaction page say why.
8. **The live pool quote on testnet.** The QuoterV2 signature matches SaucerSwap's documentation and the demo mock, but the call against the real testnet quoter and your pair's liquidity is unverified. If the app shows "pool quote is not available", the vault still checks the pool price when a purchase runs.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `DEPLOYER_PRIVATE_KEY must be a 32-byte hex string` | You pasted a DER key or an account ID | Use the HEX encoded ECDSA private key (64 hex characters) |
| Deploy fails with `INSUFFICIENT_PAYER_BALANCE` | Deployer has no HBAR | Use the faucet, then retry |
| `Hedera mainnet is coming soon` | You targeted mainnet | Use `--network hederaTestnet` (the npm scripts already do) |
| `No SaucerSwap V2 pool for this pair` | No pool at that fee tier | Try another `POOL_FEE`, or another pair |
| Transaction reverts with `AssociationFailed` | HTS association rejected | Check the token addresses are HTS tokens, not ordinary contracts |
| Revert on `claim` with a token association error | Your wallet is not associated with the bought token | The app does this automatically. From the CLI run `TOKEN=0x... npm run hardhat:associate` |
| A plan shows "Waiting for a manual run" | HSS could not schedule (busy or failed) | Click **Run now** when it is due, or **Resume** to reschedule |
| Every run is skipped with "Price too old" | No fresh on-chain price | Use **Refresh price** (needs `PYTH_API_KEY`), or raise max price age |
| Every run is skipped with "Pool price worse than oracle" | Pool price differs from the oracle by more than your slippage | Raise max slippage, or pick a deeper pool |
| **Refresh price** says `PYTH_API_KEY is not set` | No key configured | Add it to `packages/nextjs/.env.local` and restart |
| `demo-plan` says "This pair cannot be used at fee 3000" | No V2 pool at that fee, a wrong token address, or an empty pool | Run `npm run hardhat:check-pair` with the same `TOKEN_IN`, `TOKEN_OUT` and `POOL_FEE`. It lists every fee tier and says what to change |
| The SaucerSwap app swap fails with "Slippage" | Thin testnet pool, an expired quote, or the pool moved | See the numbered steps under Step 8c. The command-line swap `npm run hardhat:get-usdc` bypasses the app |
| `hardhat:get-usdc` says the pool moved more than your allowance | Price changed between quote and swap | Retry with a higher `SLIPPAGE_PCT` or a smaller `HBAR_TO_SWAP` |
| Demo says port 8545 or 3000 is in use | Another local node or web app is running | Stop it, or use `PORT=3001 npm run demo:local` for the web port |
| Demo page says "Waiting for the demo to finish deploying" | The scheduler has not written its config yet | Wait a few seconds, then check the `[scheduler]` lines in the terminal |
| Demo plans never run | The scheduler process stopped | Restart `npm run demo:local`. It deploys fresh contracts each time |
| "Pool quote is not available" on testnet | No pool for the pair and fee tier, or the quoter call failed | Check the pool exists (`npm run hardhat:demo-plan` checks it), and try another fee tier |
| Relay says `Set HEDERA_ACCOUNT_ID` | The relay needs the account that pays for HCS messages | Add `HEDERA_ACCOUNT_ID=0.0.N` to `packages/hardhat/.env` |
| Relay fails with `INVALID_SIGNATURE` | The account ID and private key belong to different accounts | Use the ID of the account that owns `DEPLOYER_PRIVATE_KEY` |
| Relay prints `No new events to publish` | Nothing happened since the last run | Wait for a scheduled run, or delete `deployments/hcs-relay-state.testnet.json` to republish everything |
| `npm run hardhat:test` cannot download the compiler | Offline or firewall blocks `binaries.soliditylang.org` | Allow that host, or use a machine with normal internet access |
| Wallet shows the wrong network | Not on chain 296 | Click **Connect wallet** again and approve the switch |

## Project structure

```
.
├── template.json                  scaffold-hbar manifest (Next.js, Hardhat, npm or yarn)
├── README.md  AGENTS.md  LICENSE
├── docs/ARCHITECTURE.md           sequence diagram and state machine
├── scripts/setup.mjs              network choice, Pyth key prompt and env file creation (with tests)
├── scripts/demo-local.mjs         one-command offline demo launcher
├── .github/workflows/ci.yml       lint, test, build
└── packages/
    ├── config/                    networks, addresses, ID conversion (single source of truth)
    ├── hardhat/
    │   ├── contracts/
    │   │   ├── AutoDcaVault.sol the template
    │   │   ├── interfaces/        Pyth, SaucerSwap router, Hedera system contracts
    │   │   ├── libraries/         PriceMath (oracle math, no reverts)
    │   │   └── mocks/             HSS, HTS, Pyth, router, quoter, ERC-20 for tests and the demo
    │   ├── test/                  vault, helper and ABI drift tests
    │   ├── scripts/               deploy, demo plan, account, associate, ABI export, HCS audit relay
    │   └── lib/                   env parsing, deploy-target guard, audit records, HCS and deployment helpers, demo deployment and scheduler, pair checker, HBAR swap
    └── nextjs/
        ├── app/                   page, layout, /api/health, /api/pyth-update
        ├── components/            dashboard, plan card, cadence strip, form, network switch, demo controls
        ├── lib/                   wallet, mirror node, quote and guard wording, Pyth proxy, formatting, validation, demo config
        └── tests/                 web app tests
```

## How this differs from the built-in templates

scaffold-hbar already ships `payments-scheduler` (a Foundry vault with pluggable strategies), `cross-chain-dca` (Axelar and Uniswap on Sepolia) and `oracles` (provider adapters). This template is narrower and complements them: a **single-chain** DCA on **SaucerSwap V2 on Hedera**, with a Pyth guard that decides per run whether to buy, an automatic circuit breaker, a permissionless fallback if scheduling fails, a live pool-versus-oracle check in the UI, a mirror-node activity feed, an optional tamper-evident HCS audit relay, a one-command offline demo, and a Hardhat toolchain.

## License

MIT. See [LICENSE](LICENSE).
