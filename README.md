# Portfel — budżet osobisty (PWA)

Aplikacja do śledzenia przychodów i kosztów. Czysty JavaScript (bez bundlera),
Firebase Hosting + Firestore + logowanie Google.

- Produkcja: https://portfel-2506.web.app
- Projekt Firebase: `portfel-2506`

## Struktura

```
public/                 ← to jest wdrażane na hosting
  index.html            ← cała struktura UI (ekran logowania, 3 zakładki, modal)
  app.js                ← logika: Firebase, render, wykresy, formularz
  styles.css            ← style (ciemny motyw, mobile-first)
  sw.js                 ← Service Worker (offline + strategie cache)
  firebase-config.js    ← klucze projektu Firebase (publiczne z definicji)
  manifest.json         ← manifest PWA
firestore.rules         ← reguły bezpieczeństwa bazy  ← WAŻNE
firebase.json           ← konfiguracja hostingu i Firestore
```

Dane w Firestore: `users/{uid}/transactions/{id}` oraz `users/{uid}/settings/categories`.

## Uruchomienie lokalne

```bash
npm start          # firebase emulators:start --only hosting  → http://localhost:5000
```

Bez zainstalowanego `firebase-tools` wystarczy dowolny serwer statyczny, np.:

```bash
python -m http.server 5000 --directory public
```

`localhost` jest domyślnie na liście autoryzowanych domen Firebase Auth, więc
logowanie Google działa też lokalnie.

## Wdrożenie

```bash
npm run deploy           # hosting + reguły Firestore
npm run deploy:rules     # same reguły bezpieczeństwa
npm run deploy:hosting   # sam hosting
```

Push do gałęzi `main` wdraża hosting automatycznie (GitHub Actions).
**Uwaga: workflow NIE wdraża reguł Firestore** — te trzeba wysłać ręcznie
poleceniem `npm run deploy:rules`.

## Bezpieczeństwo — do zrobienia w konsoli

1. **Reguły Firestore** — plik `firestore.rules` daje dostęp wyłącznie właścicielowi
   danych (`request.auth.uid == userId`). Po każdej zmianie: `npm run deploy:rules`.

   Jeśli `firebase login` nie działa (na tej maszynie kończy się asercją libuv),
   wklej treść `firestore.rules` ręcznie w
   https://console.firebase.google.com/project/portfel-2506/firestore/rules
   i kliknij **Publish**. Weryfikacja bez logowania — poniższe zapytanie musi
   zwrócić `403 PERMISSION_DENIED`:

   ```bash
   curl "https://firestore.googleapis.com/v1/projects/portfel-2506/databases/(default)/documents/users?key=KLUCZ_Z_firebase-config.js"
   ```

2. **Ograniczenie klucza API** — klucz w `firebase-config.js` jest publiczny z
   założenia (tak działa Firebase web), ale warto go ograniczyć do własnych domen:
   - https://console.cloud.google.com/apis/credentials → projekt `portfel-2506`
   - klucz „Browser key (auto created by Firebase)" → **Edytuj**
   - *Application restrictions* → **Websites** → dodaj:
     `portfel-2506.web.app/*`, `portfel-2506.firebaseapp.com/*`, `localhost/*`
   - *API restrictions* → **Restrict key** → zostaw tylko: Identity Toolkit API,
     Token Service API, Cloud Firestore API, Firebase Installations API

3. **Autoryzowane domeny logowania** — Firebase Console → Authentication → Settings →
   Authorized domains. Powinny tam być tylko domeny aplikacji.

## Wersja Firebase SDK

Aplikacja nie ma bundlera — SDK ładuje się z CDN w `index.html`
(**compat 10.12.2**, trzy tagi `<script>`). To jedyne miejsce, gdzie wersja jest
zdefiniowana; `package.json` nie zawiera zależności runtime. Zmiana wersji wymaga
podmiany wszystkich trzech linków i przetestowania: logowania, zapisu transakcji
i trybu offline.

## Service Worker

`sw.js` używa:
- **network-first** dla HTML → nowa wersja aplikacji dociera od razu,
- **stale-while-revalidate** dla CSS/JS/ikon → szybki start, aktualizacja w tle,
- pomijania cache dla Firebase/CDN.

Po zmianie strategii cache podnieś `VERSION` w `sw.js` — stare cache zostaną
usunięte przy aktywacji.
