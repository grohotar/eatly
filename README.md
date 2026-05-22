# Eatly

Private MVP PWA for gentle food journaling with Gemini photo analysis.

## Local Run

```bash
npm install
cp .env.example .env
npm run seed:users -- --random grohotar anita masha
npm run dev
```

Open `http://localhost:3000`.

## Server Notes

Secrets stay in `.env` on the server and are not committed. Gemini is called only from the backend.

Photo originals are not stored by the app. The browser compresses the selected image and sends it to `/api/analyze-food`; the server forwards it to Gemini and stores only the edited meal entry.

## Production Shape

The app is intended to run behind Caddy on `https://app.pavuka.cv`.

```text
Caddy :443 -> 127.0.0.1:3000 -> Node/Express -> /var/lib/eatly/eatly.json
```

Deployment files live in `deploy/`.
