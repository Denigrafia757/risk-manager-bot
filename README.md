# Risk Manager Telegram Bot

В архиве только 3 файла в корне, без папок:

- `index.js` — код бота
- `wrangler.toml` — настройки Worker
- `README.md` — инструкция

## После загрузки

1. В Cloudflare Worker должен быть Secret `BOT_TOKEN`.
2. Должен быть подключён KV binding с именем `RISK_KV` для сохранения выбранных параметров.
3. После деплоя открой в браузере:

`https://risk-manager-telegram.danzeldan.workers.dev/webhook-info`

Если видишь `Telegram webhook status`, значит опубликована новая версия кода.

4. Затем открой:

`https://risk-manager-telegram.danzeldan.workers.dev/set-webhook`

После этого снова открой `/webhook-info`. В строке `URL:` должен быть:

`https://risk-manager-telegram.danzeldan.workers.dev/`

## Управление ботом

После `/start` всё выбирается кнопками:

- депозит: $50 / $100 / $250 / $500 / $1000
- риск: 1 / 2 / 5 / 10 / 15 / 20%
- плечо: 5x / 8x / 10x / 15x / 20x
- стоп: 4 / 8 / 10%
- Win Rate: 50 / 60 / 70 / 80 / 90 / 100%
- TP: 50–500%
- цель: $100 / $250 / $500 / $1000 / $5000 / $10000
- комиссия: Taker / Maker / своя
- сценарий: средний / оптимистичный / пессимистичный

После выбора нажми `РАССЧИТАТЬ`.

## Важно

Токен Telegram-бота не добавляй в файлы. Он должен храниться только в Cloudflare Secrets как `BOT_TOKEN`.
