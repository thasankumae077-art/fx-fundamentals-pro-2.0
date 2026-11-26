# FX Fundamentals Pro
Research aid only. ECB = daily reference rates, not live quotes. Not trade signals.

## 1. Deploy backend (free Render)
1. Push this folder to GitHub. Render → New → Blueprint → select repo (uses `render.yaml`, rootDir `backend`).
2. Set `ALLOWED_ORIGINS` to your web-app origin (comma-separated; native app needs no CORS).
3. Check `https://<name>.onrender.com/api/health`. Free tier sleeps after idle; first call takes ~30s.

## 2. Run the app
```
npm install
npx expo install --fix          # aligns package versions with your Expo SDK
EXPO_PUBLIC_API_URL=https://<name>.onrender.com npx expo start
```
## 3. Build installable APK
1. Put your Render URL in `eas.json` → `build.preview.env.EXPO_PUBLIC_API_URL`.
2. `npm i -g eas-cli && eas login && eas build:configure`
3. `eas build -p android --profile preview` → download the .apk link, open on the phone, allow "install unknown apps".

## 4. Website
`npx expo export -p web` → deploy `dist/` as a Render Static Site (add its URL to `ALLOWED_ORIGINS`).

## Update (v2)
Replace `App.js` and `backend/server.js` in your GitHub repo and commit; Render redeploys. New endpoint: `GET /api/fundamentals`.

## Notes
- RN has no native EventSource, so the app polls `/api/news` every 30s; `/api/news/stream` (SSE) serves web clients.
- Gold: FRED no longer publishes a free gold series reliably; the app shows "n/a" if upstream has none.
- Verify central-bank calendar URLs in `App.js` (BANKS) – they change occasionally.
