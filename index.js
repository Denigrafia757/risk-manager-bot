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

async function getSettings(env, chatId) {
  if (!env.RISK_KV) return cloneDefaults();
  const raw = await env.RISK_KV.get(`settings:${chatId}`);
  if (!raw) return cloneDefaults();
  try {
    return { ...cloneDefaults(), ...JSON.parse(raw) };
  } catch {
    return cloneDefaults();
  }
}

async function saveSettings(env, chatId, settings) {
  if (env.RISK_KV) {
    await env.RISK_KV.put(`settings:${chatId}`, JSON.stringify(settings));
  }
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
  return {
    inline_keyboard: [
      [
        { text: `💰 Депозит: $${Number(s.deposit).toFixed(0)}`, callback_data: "menu:deposit" },
        { text: `⚠️ Риск: ${s.risk}%`, callback_data: "menu:risk" },
      ],
      [
        { text: `🔧 Плечо: ${s.leverage}x`, callback_data: "menu:leverage" },
        { text: `🛑 Стоп: ${s.stopMove}%`, callback_data: "menu:stop" },
      ],
      [
        { text: `🎯 Win Rate: ${s.winrate}%`, callback_data: "menu:winrate" },
        { text: `📈 TP: ${s.tp}%`, callback_data: "menu:tp" },
      ],
      [
        { text: `🏁 Цель: $${Number(s.target).toFixed(0)}`, callback_data: "menu:target" },
        { text: BUTTONS.fees, callback_data: "menu:fees" },
      ],
      [
        { text: `📊 Сценарий: ${scenarioName(s)}`, callback_data: "menu:scenario" },
      ],
      [
        { text: "🧮 РАССЧИТАТЬ", callback_data: "calculate" },
      ],
      [
        { text: "🔄 Сбросить", callback_data: "reset" },
      ],
    ],
  };
}

function valueKeyboard(title, field, values) {
  return {
    inline_keyboard: [
      ...values.map(v => [{
        text: `${v}${field === "deposit" || field === "target" ? " $" : field === "leverage" ? "x" : "%"}`,
        callback_data: `choose:${field}:${v}`,
      }]),
      [{ text: "⬅️ Назад", callback_data: "back" }],
    ],
  };
}

function presetKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💵 $50 • 10% • 10x", callback_data: "preset:50:10:10" }],
      [{ text: "💵 $100 • 10% • 10x", callback_data: "preset:100:10:10" }],
      [{ text: "💵 $250 • 10% • 10x", callback_data: "preset:250:10:10" }],
      [{ text: "💵 $500 • 5% • 10x", callback_data: "preset:500:5:10" }],
      [{ text: "⬅️ Назад", callback_data: "back" }],
    ],
  };
}

function feesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Taker 0.055% / 0.055%", callback_data: "fees:taker" }],
      [{ text: "Maker 0.020% / 0.020%", callback_data: "fees:maker" }],
      [{ text: "Ввести свои", callback_data: "fees:custom" }],
      [{ text: "⬅️ Назад", callback_data: "back" }],
    ],
  };
}

function scenarioKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Средний", callback_data: "scenario:average" }],
      [{ text: "🚀 Оптимистичный", callback_data: "scenario:optimistic" }],
      [{ text: "🐻 Пессимистичный", callback_data: "scenario:pessimistic" }],
      [{ text: "⬅️ Назад", callback_data: "back" }],
    ],
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

  await tg(env, "answerCallbackQuery", {
    callback_query_id: query.id,
  });

  if (data === "back") {
    const s = await getSettings(env, chatId);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data === "reset") {
    const s = cloneDefaults();
    await saveSettings(env, chatId, s);
    if (env.RISK_KV) await env.RISK_KV.delete(`state:${chatId}`);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data === "calculate") {
    const s = await getSettings(env, chatId);
    const calc = calculate(s);
    return editMessage(
      env,
      chatId,
      messageId,
      resultText(s, calc),
      mainKeyboard(s)
    );
  }

  if (data === "menu:deposit") {
    return editMessage(
      env, chatId, messageId,
      "💰 <b>Выбери депозит</b>\n\nНажми нужную сумму — вводить ничего не надо.",
      valueKeyboard("Депозит", "deposit", [50, 100, 250, 500, 1000])
    );
  }

  if (data === "menu:risk") {
    return editMessage(
      env, chatId, messageId,
      "⚠️ <b>Риск на одну сделку</b>",
      valueKeyboard("Риск", "risk", [1, 2, 5, 10, 15, 20])
    );
  }

  if (data === "menu:leverage") {
    return editMessage(
      env, chatId, messageId,
      "🔧 <b>Плечо</b>",
      valueKeyboard("Плечо", "leverage", [5, 8, 10, 15, 20])
    );
  }

  if (data === "menu:stop") {
    return editMessage(
      env, chatId, messageId,
      "🛑 <b>Стоп по движению актива</b>",
      valueKeyboard("Стоп", "stopMove", [4, 8, 10])
    );
  }

  if (data === "menu:winrate") {
    return editMessage(
      env, chatId, messageId,
      "🎯 <b>Win Rate</b>",
      valueKeyboard("Win Rate", "winrate", [50, 60, 70, 80, 90, 100])
    );
  }

  if (data === "menu:tp") {
    return editMessage(
      env, chatId, messageId,
      "📈 <b>Take Profit</b>",
      valueKeyboard("TP", "tp", [50, 100, 150, 200, 250, 300, 350, 400, 450, 500])
    );
  }

  if (data === "menu:target") {
    return editMessage(
      env, chatId, messageId,
      "🏁 <b>Целевой депозит</b>",
      valueKeyboard("Цель", "target", [100, 250, 500, 1000, 5000, 10000])
    );
  }

  if (data.startsWith("preset:")) {
    const [, deposit, risk, leverage] = data.split(":");
    const s = await getSettings(env, chatId);
    s.deposit = Number(deposit);
    s.risk = Number(risk);
    s.leverage = Number(leverage);
    await saveSettings(env, chatId, s);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("choose:")) {
    const [, field, rawValue] = data.split(":");
    const value = Number(rawValue);
    const s = await getSettings(env, chatId);

    if (!Number.isFinite(value)) {
      return editMessage(env, chatId, messageId, "❌ Некорректное значение.", mainKeyboard(s));
    }

    if (!valid(field, String(value))) {
      return editMessage(env, chatId, messageId, "❌ Некорректное значение.", mainKeyboard(s));
    }

    s[field] = value;
    await saveSettings(env, chatId, s);

    return editMessage(
      env,
      chatId,
      messageId,
      settingsText(s),
      mainKeyboard(s)
    );
  }

  if (data === "menu:fees") {
    return editMessage(
      env,
      chatId,
      messageId,
      "💸 <b>Комиссия</b>\n\nВыбери готовый вариант или введи свои значения.",
      feesKeyboard()
    );
  }

  if (data === "menu:scenario") {
    return editMessage(
      env,
      chatId,
      messageId,
      "📊 <b>Сценарий распределения сделок</b>",
      scenarioKeyboard()
    );
  }

  if (data === "fees:taker" || data === "fees:maker") {
    const s = await getSettings(env, chatId);
    if (data === "fees:taker") {
      s.feeOpen = 0.055;
      s.feeClose = 0.055;
    } else {
      s.feeOpen = 0.020;
      s.feeClose = 0.020;
    }
    await saveSettings(env, chatId, s);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data === "fees:custom") {
    if (!env.RISK_KV) {
      return editMessage(
        env,
        chatId,
        messageId,
        "KV не подключён. Для своих комиссий используй готовый тариф.",
        feesKeyboard()
      );
    }
    await env.RISK_KV.put(
      `state:${chatId}`,
      JSON.stringify({ field: "feeOpen" })
    );
    return editMessage(env, chatId, messageId, promptText("feeOpen"));
  }

  if (data.startsWith("scenario:")) {
    const s = await getSettings(env, chatId);
    s.scenario = data.split(":")[1];
    await saveSettings(env, chatId, s);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("set:")) {
    const field = data.slice(4);

    if (!env.RISK_KV) {
      return sendMessage(
        env,
        chatId,
        "⚠️ KV не подключён. Но быстрый расчёт одной строкой работает.\n\nПример:\n<code>50 10 10 200 300</code>"
      );
    }

    await env.RISK_KV.put(
      `state:${chatId}`,
      JSON.stringify({ field })
    );

    return editMessage(env, chatId, messageId, promptText(field));
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (text === "/start") {
    const s = await getSettings(env, chatId);
    return sendMessage(
      env,
      chatId,
      "<b>📊 Риск-менеджер</b>\n\nНичего вводить вручную не нужно.\nВыбирай параметры кнопками ниже.",
      mainKeyboard(s)
    );
  }

  if (text === "/calc") {
    const s = await getSettings(env, chatId);
    return sendMessage(
      env,
      chatId,
      "<b>🧮 Настройка сделки</b>\n\nВыбирай всё кнопками. После выбора нажми «Рассчитать».",
      mainKeyboard(s)
    );
  }

  if (text === "/help") {
    const s = await getSettings(env, chatId);
    return sendMessage(
      env,
      chatId,
      "<b>Помощь</b>\n\nВсе основные параметры выбираются кнопками.\nМожно изменить депозит, риск, плечо, стоп, Win Rate, TP и цель.",
      mainKeyboard(s)
    );
  }

  // Quick calculation works even without KV.
  const quick = quickCalculationText(parseNumbers(text));
  if (quick) {
    return sendMessage(env, chatId, quick, mainKeyboard(await getSettings(env, chatId)));
  }

  if (!env.RISK_KV) {
    return sendMessage(
      env,
      chatId,
      "Не понял сообщение.\n\nПример расчёта:\n<code>50 10 10 200 300</code>"
    );
  }

  const stateRaw = await env.RISK_KV.get(`state:${chatId}`);

  if (!stateRaw) {
    return sendMessage(
      env,
      chatId,
      "Используй кнопки после /start или отправь 5 чисел одной строкой.\n\nПример:\n<code>50 10 10 200 300</code>",
      mainKeyboard(await getSettings(env, chatId))
    );
  }

  let state;
  try {
    state = JSON.parse(stateRaw);
  } catch {
    await env.RISK_KV.delete(`state:${chatId}`);
    return sendMessage(env, chatId, "Состояние сброшено. Нажми /start.");
  }

  const field = state.field;

  if (!valid(field, text)) {
    return sendMessage(
      env,
      chatId,
      `${promptText(field)}\n\n❌ Некорректное значение.`
    );
  }

  const s = await getSettings(env, chatId);
  const value = Number(text.replace(",", "."));

  if (field === "feeOpen") {
    s.feeOpen = value;
    await env.RISK_KV.put(
      `state:${chatId}`,
      JSON.stringify({ field: "feeClose" })
    );
    return sendMessage(env, chatId, promptText("feeClose"));
  }

  s[field] = value;
  await saveSettings(env, chatId, s);
  await env.RISK_KV.delete(`state:${chatId}`);

  return sendMessage(env, chatId, settingsText(s), mainKeyboard(s));
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
