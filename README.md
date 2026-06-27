# Star Party

A night-vision-friendly web app for hosting a star party. Show visitors what your
telescope is pointing at, keep research notes on tonight's objects, and annotate
sky photos with labeled pointers — all in dim red on black, and fully offline.

## Features
- **Now Viewing** — a big red object name (airport-board style) to turn toward visitors,
  plus a brightness dimmer to go darker than your phone's minimum.
- **Library** — add objects ahead of time with type, constellation, magnitude, distance,
  "what to look for in the eyepiece," and talking points.
- **Browse/read** — quick list → readable detail card; one tap sets it as "Now Viewing."
- **Photos** — load a sky photo, tap to drop labeled pointers, link it to an object.

Everything is stored on your device (IndexedDB). No account, no cloud, no internet
needed once loaded.

## Run it locally (to test on your computer)
From this folder:

```sh
npx serve .
```

Then open the printed URL (e.g. http://localhost:3000) in your browser.
(Any static server works; a server — not opening the file directly — is needed so the
service worker and camera can run.)

## Use it on your Android phone
The app must be served over HTTPS for "Add to Home Screen" + offline to work.
Easiest path: host these files free on **GitHub Pages**, then on the phone open the
page in Chrome → menu → **Add to Home Screen**. After the first load it works offline.

(While developing, you can also reach your computer's local server from the phone over
Wi-Fi using your PC's LAN IP, e.g. http://192.168.1.x:3000.)

## Files
- `index.html` — screens/markup
- `styles.css` — night-vision red theme
- `app.js` — logic + IndexedDB storage
- `sw.js` — offline service worker
- `manifest.webmanifest`, `icon.svg` — installable PWA metadata
