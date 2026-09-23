# Risk Manager Telegram Bot

Файлы специально находятся в корне репозитория — без папок.

## Файлы
- index.js — код Cloudflare Worker
- wrangler.toml — конфигурация Worker и KV

## Что понадобится
1. GitHub repository.
2. Cloudflare Workers.
3. Cloudflare KV Namespace.
4. Telegram Bot Token.

## Важно
Telegram BOT_TOKEN не записывается в GitHub. Его нужно добавить в Cloudflare как Secret с именем `BOT_TOKEN`.

После создания KV Namespace скопируй его ID и замени:
REPLACE_WITH_KV_NAMESPACE_ID
в файле wrangler.toml.

После деплоя нужно установить Telegram webhook на URL Worker.
