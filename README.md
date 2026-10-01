# Aura voice agent: frontend

React + Vite app for the voice call UI. See the repository README for the full picture.

- `npm run dev`: dev server on http://localhost:5174 (proxies `/api` to the backend on port 5000)
- `npm run build`: production build into `dist/` (served by the Express backend)
- `VITE_API_URL`: set only if the API is hosted on a different origin
