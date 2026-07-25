# The Goal — Installable PWA

Habit and goal tracker that installs on your phone like a native app.

## Local development

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Production build

```bash
npm run build
npm run preview
```

`npm run preview` serves the built app locally so you can test install behavior before deploying.

## Deploy (required for phone install)

PWAs must be served over **HTTPS** (except `localhost`). Deploy the `dist/` folder to any static host:

| Host | Steps |
|------|-------|
| **Netlify** | Drag `dist/` onto [app.netlify.com/drop](https://app.netlify.com/drop), or connect the repo |
| **Vercel** | `npx vercel --prod` from the project root |
| **Cloudflare Pages** | Connect repo, set build command to `npm run build`, output directory to `dist` |

After deploy, open the HTTPS URL on your phone.

## Install on your phone

### Android (Chrome)
1. Open the deployed HTTPS URL in Chrome
2. Tap the menu (⋮) → **Install app** or **Add to Home screen**
3. Confirm — The Goal appears on your home screen and opens full-screen

### iPhone (Safari)
1. Open the deployed HTTPS URL in Safari
2. Tap **Share** (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add** — The Goal launches from your home screen like an app

## Offline support

After the first visit, the service worker caches the app shell. Your goals and tasks are stored in `localStorage` on the device.

## Project structure

```
index.html          # HTML shell + Apple install meta tags
src/
  main.jsx          # App entry + service worker registration
  TheGoalV11.jsx    # Main app component
public/icons/       # PWA icons (192, 512)
vite.config.js      # Vite + PWA manifest/service worker config
```
