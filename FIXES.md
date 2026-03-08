# Wesley Bug Fixes — Audit Report

## Bug #1 — CRASH: `:root` in CSS Module (index.module.css)
**Error:** `Syntax error: Selector ":root" is not pure`
**Cause:** CSS Modules only allow scoped selectors (classes/IDs). Global selectors
like `:root`, `*`, `body` are rejected at compile time.
**Fix:** Deleted `index.module.css`. Moved `:root { color-scheme: dark }` and all
global resets into `styles/globals.css`, which is imported in `_app.js`.

---

## Bug #2 — CRASH: Missing Solana wallet adapter packages
**Error:** `Module not found: Can't resolve '@keystonehq/bc-ur-registry'` → 500 on every page load
**Cause:** `pages/index.js` imported from `@solana/wallet-adapter-*` but `package.json`
had none of those packages installed. The `@solana/wallet-adapter-wallets` mega-bundle
also pulls in `@keystonehq` which has a broken peer dependency.
**Fix:**
1. Added specific wallet packages to `package.json`:
   - `@solana/web3.js`
   - `@solana/spl-token`
   - `@solana/wallet-adapter-base`
   - `@solana/wallet-adapter-react`
   - `@solana/wallet-adapter-react-ui`
   - `@solana/wallet-adapter-phantom`
   - `@solana/wallet-adapter-solflare`
2. Changed imports in `index.js` to use specific adapter packages instead of the
   broken `@solana/wallet-adapter-wallets` bundle.

---

## Bug #3 — CRASH: Corrupted .next cache after config change
**Error:** `Cannot find module 'next/dist/server/lib/start-server.js'` → all routes 404
**Cause:** Editing `next.config.js` while the dev server was running triggered a hot
restart that corrupted the `.next` build cache.
**Fix:** Delete `.next` folder and do a clean reinstall before starting:
```bash
rm -rf .next node_modules
npm install
npm run dev
```

---

## Bug #4 — WASTE: Dead `scanLine` state (50ms interval, never used)
**Code:**
```js
const [scanLine, setScanLine] = useState(0);
useEffect(() => {
  const t = setInterval(() => setScanLine(n => (n + 1) % 100), 50);
  return () => clearInterval(t);
}, []);
```
`scanLine` was set 20 times per second but never read anywhere in the render.
**Fix:** Removed both the state and the interval.

---

## Bug #5 — WASTE: Dead `alertRef` never attached to DOM
```js
const alertRef = useRef(null); // created but never used as ref={alertRef}
```
**Fix:** Removed.

---

## Bug #6 — MISSING: webpack externals stripped from next.config.js
**Original (broken):**
```js
const nextConfig = { reactStrictMode: true };
```
**Fix:** Restored required externals for `@solana/web3.js`:
```js
webpack: (config) => {
  config.externals.push("pino-pretty", "lokijs", "encoding");
  return config;
}
```
Without this, the Solana SDK throws `Module not found` errors during build.

---

## Clean start commands
```bash
# 1. Wipe corrupted state
rm -rf .next node_modules

# 2. Fresh install (now includes Solana packages)
npm install

# 3. Copy your .env
cp .env.local.example .env.local
# Add your NEXT_PUBLIC_RPC_ENDPOINT

# 4. Run
npm run dev
```
