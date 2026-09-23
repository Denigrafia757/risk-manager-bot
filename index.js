const DEFAULTS = {
  deposit: 50,
  winrate: 70,
  risk: 10,
  tp: 300,
  target: 1000,
  leverage: 10,
  stopMove: 10,
  feeOpen: 0.055,
  feeClose: 0.055,
  scenario: "average",
};

const BUTTONS = {
  deposit: "💰 Депозит",
  winrate: "🎯 Win Rate",
  risk: "⚠️ Риск",
  tp: "📈 TP",
  target: "🏁 Цель",
  leverage: "🔧 Плечо",
  stopMove: "🛑 Стоп",
  fees: "💸 Комиссия",
  scenario: "📊 Сценарий",
  calculate: "🧮 Рассчитать",
  reset: "🔄 Сбросить",
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function packState(s) {
  // Compact callback payload; stays well below Telegram's 64-byte callback_data limit.
  return [
    Number(s.deposit), Number(s.risk), Number(s.leverage), Number(s.stopMove),
    Number(s.winrate), Number(s.tp), Number(s.target),
    Number(s.feeOpen), Number(s.feeClose),
    s.scenario === "optimistic" ? 1 : s.scenario === "pessimistic" ? 2 : 0
  ].join(":");
}

function unpackState(raw) {
  const a = String(raw || "").split(":").map(Number);
  if (a.length !== 10 || a.some(n => !Number.isFinite(n))) return cloneDefaults();
  return {
    deposit: a[0], risk: a[1], leverage: a[2], stopMove: a[3],
    winrate: a[4], tp: a[5], target: a[6],
    feeOpen: a[7], feeClose: a[8],
    scenario: a[9] === 1 ? "optimistic" : a[9] === 2 ? "pessimistic" : "average"
  };
}

function stateFromData(data) {
  const parts = String(data || "").split(":");
  return unpackState(parts.slice(1).join(":"));
}

async function tg(env, method, body) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is missing");

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok !== true) {
    throw new Error(`Telegram ${method}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendMessage(env, chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(env, "sendMessage", body);
}

async function editMessage(env, chatId, messageId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(env, "editMessageText", body);
}

function mainKeyboard(s) {
  const st = packState(s);
  return {
    inline_keyboard: [
      [
        { text: `💰 Депозит: $${s.deposit}`, callback_data: `menu:deposit:${st}` },
        { text: `⚠️ Риск: ${s.risk}%`, callback_data: `menu:risk:${st}` }
      ],
      [
        { text: `🔧 Плечо: ${s.leverage}x`, callback_data: `menu:leverage:${st}` },
        { text: `🛑 Стоп: ${s.stopMove}%`, callback_data: `menu:stop:${st}` }
      ],
      [
        { text: `🎯 Win Rate: ${s.winrate}%`, callback_data: `menu:winrate:${st}` },
        { text: `📈 TP: ${s.tp}%`, callback_data: `menu:tp:${st}` }
      ],
      [
        { text: `🏁 Цель: $${s.target}`, callback_data: `menu:target:${st}` },
        { text: `💸 Комиссия`, callback_data: `menu:fees:${st}` }
      ],
      [
        { text: `📊 ${scenarioName(s.scenario)}`, callback_data: `menu:scenario:${st}` }
      ],
      [
        { text: "⚡ $50 • 10% • 10x", callback_data: `preset:50:10:10:${st}` },
        { text: "⚡ $100 • 10% • 10x", callback_data: `preset:100:10:10:${st}` }
      ],
      [
        { text: "⚡ $250 • 10% • 10x", callback_data: `preset:250:10:10:${st}` },
        { text: "⚡ $500 • 5% • 10x", callback_data: `preset:500:5:10:${st}` }
      ],
      [
        { text: "🧮 РАССЧИТАТЬ", callback_data: `calculate:${st}` }
      ],
      [
        { text: "🔄 Сбросить", callback_data: "reset" }
      ]
    ]
  };
}



function valueKeyboard(title, field, values, s) {
  const st = packState(s);
  const buttons = values.map(v => ({
    text: `${v}${field === "leverage" ? "x" : field === "deposit" || field === "target" ? "$" : "%"}`,
    callback_data: `choose:${field}:${v}:${st}`
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  rows.push([{ text: "⬅️ Назад", callback_data: `back:${st}` }]);
  return { inline_keyboard: rows };
}



function presetKeyboard() { return { inline_keyboard: [] }; }



function feesKeyboard(s) {
  const st = packState(s);
  return {
    inline_keyboard: [
      [{ text: "Taker 0.055% / 0.055%", callback_data: `fees:taker:${st}` }],
      [{ text: "Maker 0.020% / 0.020%", callback_data: `fees:maker:${st}` }],
      [{ text: "0.010% / 0.010%", callback_data: `fees:low:${st}` }],
      [{ text: "✏️ Своя комиссия", callback_data: `fees:custom:${st}` }],
      [{ text: "⬅️ Назад", callback_data: `back:${st}` }]
    ]
  };
}



function scenarioKeyboard(s) {
  const st = packState(s);
  return {
    inline_keyboard: [
      [{ text: "📊 Средний", callback_data: `scenario:average:${st}` }],
      [{ text: "🚀 Оптимистичный", callback_data: `scenario:optimistic:${st}` }],
      [{ text: "🛡 Пессимистичный", callback_data: `scenario:pessimistic:${st}` }],
      [{ text: "⬅️ Назад", callback_data: `back:${st}` }]
    ]
  };
}



function scenarioName(s) {
  return {
    average: "средний",
    optimistic: "оптимистичный",
    pessimistic: "пессимистичный",
  }[s] || "средний";
}

function settingsText(s) {
  return [
    "<b>📊 Риск-менеджер</b>",
    "",
    `💰 Депозит: <b>$${Number(s.deposit).toFixed(2)}</b>`,
    `🎯 Win Rate: <b>${s.winrate}%</b>`,
    `⚠️ Риск: <b>${s.risk}%</b>`,
    `📈 TP: <b>${s.tp}%</b> от маржи`,
    `🏁 Цель: <b>$${Number(s.target).toFixed(2)}</b>`,
    `🔧 Плечо: <b>${s.leverage}x</b>`,
    `🛑 Стоп: <b>${s.stopMove}%</b> движения актива`,
    `💸 Комиссия: <b>${s.feeOpen}% + ${s.feeClose}%</b>`,
    `📊 Сценарий: <b>${scenarioName(s.scenario)}</b>`,
    "",
    "Выбери параметр или нажми «Рассчитать».",
  ].join("\n");
}

function buildPattern(winrate, scenario) {
  const p = Math.max(0, Math.min(100, Number(winrate)));

  if (scenario === "optimistic") {
    return [
      ...Array(Math.round(p)).fill("W"),
      ...Array(100 - Math.round(p)).fill("L"),
    ];
  }

  if (scenario === "pessimistic") {
    return [
      ...Array(100 - Math.round(p)).fill("L"),
      ...Array(Math.round(p)).fill("W"),
    ];
  }

  if (p >= 100) return Array(100).fill("W");
  if (p <= 0) return Array(100).fill("L");

  const result = [];
  let acc = 0;
  for (let i = 0; i < 100; i++) {
    acc += p;
    if (acc >= 100) {
      result.push("W");
      acc -= 100;
    } else {
      result.push("L");
    }
  }
  return result;
}

function calculate(s) {
  let deposit = Number(s.deposit);
  const target = Number(s.target);
  const pattern = buildPattern(s.winrate, s.scenario);
  const rows = [];
  let wins = 0;
  let losses = 0;

  for (let i = 0; i < 1000 && deposit > 0 && deposit < target; i++) {
    const result = pattern[i % pattern.length];

    const margin = deposit * Number(s.risk) / 100;
    const notional = margin * Number(s.leverage);

    // Stop loss is limited to the margin, so one SL cannot make
    // the calculated deposit negative.
    const stopLoss = Math.min(
      notional * Number(s.stopMove) / 100,
      margin
    );

    const grossWin = margin * Number(s.tp) / 100;
    const fee =
      notional * (Number(s.feeOpen) + Number(s.feeClose)) / 100;

    const gross = result === "W" ? grossWin : -stopLoss;
    const net = gross - fee;
    const after = Math.max(0, deposit + net);

    if (result === "W") wins++;
    else losses++;

    rows.push({
      n: i + 1,
      result,
      deposit,
      margin,
      notional,
      fee,
      gross,
      net,
      after,
    });

    deposit = after;
  }

  return { rows, finalDeposit: deposit, wins, losses };
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function resultText(s, calc) {
  const last = calc.rows.at(-1);
  const total = calc.rows.length;
  const wr = total ? (calc.wins / total) * 100 : 0;

  const text = [
    "<b>🧮 Результат</b>",
    "",
    `Старт: <b>${money(s.deposit)}</b>`,
    `Цель: <b>${money(s.target)}</b>`,
    `Сделок: <b>${total}</b>`,
    `Побед: <b>${calc.wins}</b>`,
    `Убытков: <b>${calc.losses}</b>`,
    `Win Rate: <b>${wr.toFixed(1)}%</b>`,
    `Финальный депозит: <b>${money(calc.finalDeposit)}</b>`,
  ];

  if (last) {
    text.push(
      "",
      "<b>Последняя сделка</b>",
      `${last.result === "W" ? "🟢 WIN" : "🔴 LOSS"} №${last.n}`,
      `Маржа: ${money(last.margin)}`,
      `Позиция: ${money(last.notional)}`,
      `Комиссия: ${money(last.fee)}`,
      `P/L: ${last.net >= 0 ? "+" : ""}${money(last.net)}`,
      `После сделки: ${money(last.after)}`
    );
  }

  text.push(
    "",
    "<i>Риск считается от текущего депозита. Плечо определяет размер позиции через маржу. TP и стоп задаются отдельно.</i>"
  );

  return text.join("\n");
}

function promptText(field) {
  const names = {
    deposit: "💰 Введи депозит в $:",
    winrate: "🎯 Введи Win Rate в %:",
    risk: "⚠️ Введи риск в % от текущего депозита:",
    tp: "📈 Введи Take Profit в % от маржи:",
    target: "🏁 Введи целевой депозит в $:",
    leverage: "🔧 Введи плечо:",
    stopMove: "🛑 Введи движение актива до стопа в %:",
    feeOpen: "💸 Введи комиссию открытия в %:",
    feeClose: "💸 Введи комиссию закрытия в %:",
  };
  return names[field] || "Введи значение:";
}

function valid(field, value) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return false;

  if (field === "deposit" || field === "target") return n > 0;
  if (field === "winrate") return n >= 0 && n <= 100;
  if (field === "risk") return n > 0 && n <= 100;
  if (field === "tp") return n >= 0;
  if (field === "leverage") return n > 0 && n <= 1000;
  if (field === "stopMove") return n > 0 && n <= 100;
  if (field === "feeOpen" || field === "feeClose") return n >= 0;

  return false;
}

function parseNumbers(text) {
  return String(text)
    .replace(/,/g, ".")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number) || [];
}

function quickCalculationText(nums) {
  if (nums.length < 5) return null;

  const [deposit, risk, stopMove, leverage, tp] = nums;

  if (
    !(deposit > 0) ||
    !(risk > 0 && risk <= 100) ||
    !(stopMove > 0 && stopMove <= 100) ||
    !(leverage > 0 && leverage <= 1000) ||
    !(tp >= 0)
  ) {
    return null;
  }

  const riskMoney = deposit * risk / 100;
  const position = riskMoney / (stopMove / 100);
  const margin = position / leverage;
  const profit = position * tp / 100;
  const rr = tp / stopMove;

  return [
    "<b>🧮 Расчёт сделки</b>",
    "",
    `💰 Депозит: <b>${money(deposit)}</b>`,
    `⚠️ Риск: <b>${risk}% = ${money(riskMoney)}</b>`,
    `🛑 Стоп: <b>${stopMove}%</b>`,
    `🔧 Плечо: <b>${leverage}x</b>`,
    `📈 Take Profit: <b>${tp}%</b>`,
    "",
    `📦 Размер позиции: <b>${money(position)}</b>`,
    `🔒 Маржа: <b>${money(margin)}</b>`,
    `💵 Прибыль при TP: <b>${money(profit)}</b>`,
    `📐 R:R: <b>1:${rr.toFixed(2)}</b>`,
  ].join("\n");
}

async function handleCallback(env, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || "";

  await tg(env, "answerCallbackQuery", { callback_query_id: query.id });

  if (data === "reset") {
    const s = cloneDefaults();
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  // All menu/choice buttons carry the complete current state, so KV is not needed.
  if (data.startsWith("menu:")) {
    const [, menu, ...rest] = data.split(":");
    const s = unpackState(rest.join(":"));

    if (menu === "deposit") return editMessage(env, chatId, messageId,
      "💰 <b>Выбери депозит</b>", valueKeyboard("Депозит", "deposit", [50,100,250,500,1000], s));
    if (menu === "risk") return editMessage(env, chatId, messageId,
      "⚠️ <b>Риск на одну сделку</b>", valueKeyboard("Риск", "risk", [1,2,5,10,15,20], s));
    if (menu === "leverage") return editMessage(env, chatId, messageId,
      "🔧 <b>Плечо</b>", valueKeyboard("Плечо", "leverage", [5,8,10,15,20], s));
    if (menu === "stop") return editMessage(env, chatId, messageId,
      "🛑 <b>Стоп по движению актива</b>", valueKeyboard("Стоп", "stopMove", [4,8,10], s));
    if (menu === "winrate") return editMessage(env, chatId, messageId,
      "🎯 <b>Win Rate</b>", valueKeyboard("Win Rate", "winrate", [50,60,70,80,90,100], s));
    if (menu === "tp") return editMessage(env, chatId, messageId,
      "📈 <b>Take Profit</b>", valueKeyboard("TP", "tp", [50,100,150,200,250,300,350,400,450,500], s));
    if (menu === "target") return editMessage(env, chatId, messageId,
      "🏁 <b>Целевой депозит</b>", valueKeyboard("Цель", "target", [100,250,500,1000,5000,10000], s));
    if (menu === "fees") return editMessage(env, chatId, messageId,
      "💸 <b>Комиссия</b>\n\nВыбери тариф:", feesKeyboard(s));
    if (menu === "scenario") return editMessage(env, chatId, messageId,
      "📊 <b>Сценарий распределения сделок</b>", scenarioKeyboard(s));
  }

  if (data.startsWith("choose:")) {
    const parts = data.split(":");
    const field = parts[1];
    const value = Number(parts[2]);
    const s = unpackState(parts.slice(3).join(":"));
    if (!valid(field, String(value))) {
      return editMessage(env, chatId, messageId, "❌ Некорректное значение.", mainKeyboard(s));
    }
    s[field] = value;
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("preset:")) {
    const parts = data.split(":");
    const s = unpackState(parts.slice(4).join(":"));
    s.deposit = Number(parts[1]); s.risk = Number(parts[2]); s.leverage = Number(parts[3]);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("fees:")) {
    const parts = data.split(":");
    const s = unpackState(parts.slice(2).join(":"));
    const kind = parts[1];
    if (kind === "taker") { s.feeOpen = 0.055; s.feeClose = 0.055; }
    else if (kind === "maker") { s.feeOpen = 0.020; s.feeClose = 0.020; }
    else if (kind === "low") { s.feeOpen = 0.010; s.feeClose = 0.010; }
    else if (kind === "custom") {
      return editMessage(env, chatId, messageId,
        "✏️ Своя комиссия\n\nОтправь одной строкой: <code>0.055 0.055</code>\nПервое число — открытие, второе — закрытие.\n\nПосле ввода нажми /start и выбери параметры заново.");
    }
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("scenario:")) {
    const parts = data.split(":");
    const s = unpackState(parts.slice(2).join(":"));
    s.scenario = parts[1];
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("calculate:")) {
    const s = unpackState(data.slice("calculate:".length));
    return editMessage(env, chatId, messageId, resultText(s, calculate(s)), mainKeyboard(s));
  }

  if (data.startsWith("back:")) {
    const s = unpackState(data.slice(5));
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();

  if (text === "/start" || text === "/reset") {
    const s = cloneDefaults();
    return sendMessage(env, chatId, settingsText(s), mainKeyboard(s));
  }

  if (text === "/calc") {
    return sendMessage(env, chatId,
      "Используй кнопки ниже — все основные параметры выбираются без ручного ввода.",
      mainKeyboard(cloneDefaults())
    );
  }

  const nums = parseNumbers(text);
  const quick = quickCalculationText(nums);
  if (quick) return sendMessage(env, chatId, quick);

  return sendMessage(env, chatId,
    "Выбери параметры кнопками ниже.",
    mainKeyboard(cloneDefaults())
  );
}

async function setWebhook(env, request) {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";

  const result = await tg(env, "setWebhook", {
    url: url.toString(),
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });

  return new Response(
    `Webhook установлен.\n\nURL:\n${url.toString()}\n\nTelegram:\n${JSON.stringify(result)}\n`,
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

async function webhookInfo(env) {
  const result = await tg(env, "getWebhookInfo", {});
  const info = result.result || {};

  return new Response(
    [
      "Telegram webhook status",
      "",
      `URL: ${info.url || "(empty)"}`,
      `Pending updates: ${info.pending_update_count ?? 0}`,
      `Last error: ${info.last_error_message || "(none)"}`,
      `Last error date: ${info.last_error_date || "(none)"}`,
    ].join("\n"),
    {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }
  );
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET") {
        if (url.pathname === "/set-webhook") {
          return await setWebhook(env, request);
        }

        if (url.pathname === "/webhook-info") {
          return await webhookInfo(env);
        }

        return new Response("Risk Manager Bot is running", { status: 200 });
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const update = await request.json();

      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("WORKER_ERROR", error);

      // Telegram needs a 2xx response for webhook delivery.
      // The error itself is written to Cloudflare logs.
      return new Response("OK", { status: 200 });
    }
  },
};
