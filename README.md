# WESLEY.SOL

WESLEY.SOL is a Next.js dashboard for monitoring newly launched Solana memecoins, with a focus on Pump.fun-style activity and rug-risk signals.

## What this web app does

- Streams token data from a server-side API that polls Dexscreener and falls back to Birdeye when needed.
- Shows a live terminal-style table with token price, 24h change, market cap, volume, liquidity, holders, age, and risk status.
- Runs rug-risk enrichment on the backend and displays a risk level (`LOW`, `MED`, `HIGH`, `CRITICAL`).
- Tracks possible dev-wallet selloffs and surfaces recent alerts in the sidebar.
- Detects major volume spikes and highlights tokens that suddenly accelerate.
- Supports Phantom and Solflare wallet connection in the UI.
- Provides token drill-down details via an on-demand API route.

## Tech stack

- Next.js 14
- React 18
- SWR for polling/caching in the client
- Solana Web3 + SPL Token for on-chain checks
- Dexscreener + Birdeye for market/token data

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.local.example .env.local
```

3. Fill required values in `.env.local`:

- `NEXT_PUBLIC_RPC_ENDPOINT`
- `BIRDEYE_API_KEY` (recommended fallback)

Optional:

- `HELIUS_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TWITTER_BEARER_TOKEN`
- `DEXSCREENER_BASE_URL`

4. Run the app:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## Available scripts

- `npm run dev` - start development server
- `npm run build` - production build
- `npm run start` - run production server

## API routes

- `GET /api/tokens` - returns cached + enriched token list
- `GET /api/token/[mint]` - returns detailed data for one token
- `GET /api/alerts` - returns recent dev-sell alerts

## Notes

- Risk detection is heuristic/probabilistic and should not be treated as financial advice.
- `.env.local` is gitignored and should never be committed.
