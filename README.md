# Dashboard (Vite + React + Tailwind + Firebase)

This is a starter scaffold created in /Users/foodworld/Desktop/dashboard.

Quick start:

1. Copy environment example and fill your Firebase values:

   cp .env.example .env.local
   # then edit .env.local and add actual values

2. Install dependencies:

   npm install

3. Run dev server:

   npm run dev

Notes:
- Firebase config values must be provided as VITE_FIREBASE_* variables (Vite exposes env vars prefixed with VITE_ to client code).
- Tailwind is configured via `tailwind.config.cjs` and `postcss.config.cjs`.

Next steps:
- Add components in `src/`.
- Replace the placeholder Firebase config with your project's values.
- Add linting, tests, and CI as needed.
