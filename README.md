# Risk Manager Telegram Bot

Файлы находятся прямо в корне архива — без папок.

## Файлы
- index.js
- wrangler.toml
- README.md

## Важно после загрузки
1. Убедись, что Secret `BOT_TOKEN` уже есть в Cloudflare Worker.
2. Если используешь KV для кнопочного режима, binding должен называться `RISK_KV`.
3. После деплоя открой в браузере:
   `https://risk-manager-telegram.danzeldan.workers.dev/set-webhook`
4. После этого открой:
   `https://risk-manager-telegram.danzeldan.workers.dev/webhook-info`
   и проверь, что URL webhook указывает на этот Worker.

## Быстрый расчёт
Можно отправить боту одну строку:

`50 10 10 200 300`

Порядок:
депозит → риск % → стоп % → плечо → Take Profit %.

Быстрый расчёт работает даже без KV.
