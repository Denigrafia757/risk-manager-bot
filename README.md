# Risk Manager Telegram Bot

Telegram risk manager with a private D1 trading diary.

Diary includes manual trade entry, starting-balance tracking, balance/P&L charts, statistics, CSV export and Bybit read-only synchronization.

## Cloudflare secrets
Add these Worker Production Secrets:
- `BOT_TOKEN`
- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`

The Bybit key must be Read Only and must not have trading or withdrawal permissions.

Cloudflare Worker + D1.
