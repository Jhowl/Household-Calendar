# Home Organizer

Full-screen household calendar for chores, payments, and recurring tasks.

## Local development (Docker)

1. Copy env files and adjust if needed:
   - `api/.env.example` -> `api/.env`
   - `ui/.env.example` -> `ui/.env`

2. Start the stack:
   - `docker compose up --build`

3. Open the app:
   - UI: `http://localhost:5173`
   - API: `http://localhost:4000/api/health`

## Telegram ingestion

Configure your Telegram bot webhook to point to:

`POST http://<your-host>:4000/api/telegram/webhook`

If you set `TELEGRAM_WEBHOOK_SECRET`, also configure Telegram to send
the `x-telegram-bot-api-secret-token` header.

Example commands:
- `/chore Change towels weekly wed assignee=Ana`
- `/chore Cardboard outside every 2 weeks sat`
- `/chore Pay rent monthly day=1`
