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
  risk: "⚠️ Риск / маржа",
  tp: "📈 TP",
  target: "🏁 Цель",
  leverage: "🔧 Плечо",
  stopMove: "🛑 Стоп по активу",
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
  return raw ? { ...cloneDefaults(), ...JSON.parse(raw) } : cloneDefaults();
}

async function saveSettings(env, chatId, settings) {
  if (env.RISK_KV) {
    await env.RISK_KV.put(`settings:${chatId}`, JSON.stringify(settings));
  }
}

async function tg(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function sendMessage(env, chatId, text, replyMarkup = undefined) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(env, "sendMessage", body);
}

async function editMessage(env, chatId, messageId, text, replyMarkup = undefined) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg(env, "editMessageText", body);
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: BUTTONS.deposit, callback_data: "set:deposit" },
        { text: BUTTONS.winrate, callback_data: "set:winrate" },
      ],
      [
        { text: BUTTONS.risk, callback_data: "set:risk" },
        { text: BUTTONS.tp, callback_data: "set:tp" },
      ],
      [
        { text: BUTTONS.target, callback_data: "set:target" },
        { text: BUTTONS.leverage, callback_data: "set:leverage" },
      ],
      [
        { text: BUTTONS.stopMove, callback_data: "set:stopMove" },
        { text: BUTTONS.fees, callback_data: "menu:fees" },
      ],
      [
        { text: BUTTONS.scenario, callback_data: "menu:scenario" },
      ],
      [
        { text: BUTTONS.calculate, callback_data: "calculate" },
        { text: BUTTONS.reset, callback_data: "reset" },
      ],
    ],
  };
}

function feesKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Taker 0.055% / 0.055%", callback_data: "fees:taker" },
      ],
      [
        { text: "Maker 0.020% / 0.020%", callback_data: "fees:maker" },
      ],
      [
        { text: "Ввести свои", callback_data: "fees:custom" },
      ],
      [
        { text: "⬅️ Назад", callback_data: "back" },
      ],
    ],
  };
}

function scenarioKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 Средний 70/30", callback_data: "scenario:average" },
      ],
      [
        { text: "🚀 Оптимистичный", callback_data: "scenario:optimistic" },
      ],
      [
        { text: "🐻 Пессимистичный", callback_data: "scenario:pessimistic" },
      ],
      [
        { text: "⬅️ Назад", callback_data: "back" },
      ],
    ],
  };
}

function settingsText(s) {
  return [
    "<b>Risk Manager</b>",
    "",
    `💰 Депозит: <b>$${s.deposit.toFixed(2)}</b>`,
    `🎯 Win Rate: <b>${s.winrate}%</b>`,
    `⚠️ Риск / маржа: <b>${s.risk}%</b>`,
    `📈 TP: <b>${s.tp}%</b> от маржи`,
    `🏁 Цель: <b>$${s.target.toFixed(2)}</b>`,
    `🔧 Плечо: <b>${s.leverage}x</b>`,
    `🛑 Стоп по активу: <b>${s.stopMove}%</b>`,
    `💸 Комиссия: <b>${s.feeOpen}% + ${s.feeClose}%</b>`,
    `📊 Сценарий: <b>${scenarioName(s.scenario)}</b>`,
    "",
    "Выбери параметр или нажми «Рассчитать».",
  ].join("\n");
}

function scenarioName(s) {
  return {
    average: "средний",
    optimistic: "оптимистичный",
    pessimistic: "пессимистичный",
  }[s] || "средний";
}

function buildPattern(winrate, scenario) {
  const p = Math.max(0, Math.min(100, Number(winrate)));
  if (scenario === "optimistic") {
    return [...Array(Math.round(p)).fill("W"), ...Array(100 - Math.round(p)).fill("L")];
  }
  if (scenario === "pessimistic") {
    return [...Array(100 - Math.round(p)).fill("L"), ...Array(Math.round(p)).fill("W")];
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
    const stopLoss = Math.min(notional * Number(s.stopMove) / 100, margin);
    const grossWin = margin * Number(s.tp) / 100;
    const fee = notional * (Number(s.feeOpen) + Number(s.feeClose)) / 100;
    const gross = result === "W" ? grossWin : -stopLoss;
    const net = gross - fee;
    const after = deposit + net;

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

function formatMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}

function resultText(s, calc) {
  const last = calc.rows[calc.rows.length - 1];
  const total = calc.rows.length;
  const wr = total ? (calc.wins / total) * 100 : 0;

  let text = [
    "<b>🧮 Результат расчёта</b>",
    "",
    `Старт: <b>${formatMoney(s.deposit)}</b>`,
    `Цель: <b>${formatMoney(s.target)}</b>`,
    `Сделок: <b>${total}</b>`,
    `Побед: <b>${calc.wins}</b>`,
    `Убытков: <b>${calc.losses}</b>`,
    `Фактический Win Rate: <b>${wr.toFixed(1)}%</b>`,
    `Финальный депозит: <b>${formatMoney(calc.finalDeposit)}</b>`,
  ];

  if (last) {
    text.push(
      "",
      "<b>Последняя сделка:</b>",
      `${last.result === "W" ? "🟢 WIN" : "🔴 LOSS"} №${last.n}`,
      `Маржа: ${formatMoney(last.margin)}`,
      `Позиция: ${formatMoney(last.notional)}`,
      `Комиссия: ${formatMoney(last.fee)}`,
      `Результат: ${last.net >= 0 ? "+" : ""}${formatMoney(last.net)}`,
      `После сделки: ${formatMoney(last.after)}`
    );
  }

  text.push(
    "",
    "<i>Модель: риск = % текущего депозита; позиция = маржа × плечо; стоп = % движения актива; комиссия учитывается отдельно.</i>"
  );

  return text.join("\n");
}

function promptText(field) {
  const names = {
    deposit: "💰 Введи стартовый депозит в $:",
    winrate: "🎯 Введи Win Rate в % (например, 70):",
    risk: "⚠️ Введи риск / маржу в % от текущего депозита (например, 10):",
    tp: "📈 Введи TP в % от маржи (например, 300):",
    target: "🏁 Введи целевой депозит в $ (например, 1000):",
    leverage: "🔧 Введи плечо (например, 10):",
    stopMove: "🛑 Введи движение актива до стопа в % (например, 10):",
    feeOpen: "💸 Введи комиссию открытия в %:",
    feeClose: "💸 Введи комиссию закрытия в %:",
  };
  return names[field] || "Введи значение:";
}

function valid(field, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (field === "deposit" || field === "target") return n > 0;
  if (field === "winrate") return n >= 0 && n <= 100;
  if (field === "risk") return n > 0 && n <= 100;
  if (field === "tp") return n >= 0;
  if (field === "leverage") return n > 0;
  if (field === "stopMove") return n > 0 && n <= 100;
  if (field === "feeOpen" || field === "feeClose") return n >= 0;
  return true;
}

async function handleCallback(env, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || "";

  await tg(env, "answerCallbackQuery", { callback_query_id: query.id });

  if (data === "back") {
    const s = await getSettings(env, chatId);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard());
  }

  if (data === "reset") {
    const s = cloneDefaults();
    await saveSettings(env, chatId, s);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard());
  }

  if (data === "calculate") {
    const s = await getSettings(env, chatId);
    const calc = calculate(s);
    return editMessage(env, chatId, messageId, resultText(s, calc), mainKeyboard());
  }

  if (data === "menu:fees") {
    return editMessage(env, chatId, messageId, "💸 <b>Комиссия Bybit</b>\n\nВыбери тариф или введи свои значения.", feesKeyboard());
  }

  if (data === "menu:scenario") {
    return editMessage(env, chatId, messageId, "📊 <b>Сценарий распределения сделок</b>", scenarioKeyboard());
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
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard());
  }

  if (data === "fees:custom") {
    await env.RISK_KV?.put(`state:${chatId}`, JSON.stringify({ field: "feeOpen" }));
    return editMessage(env, chatId, messageId, promptText("feeOpen"));
  }

  if (data.startsWith("scenario:")) {
    const s = await getSettings(env, chatId);
    s.scenario = data.split(":")[1];
    await saveSettings(env, chatId, s);
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard());
  }

  if (data.startsWith("set:")) {
    const field = data.split(":")[1];
    if (!env.RISK_KV) {
      return sendMessage(env, chatId, "Для сохранения параметров нужно подключить Cloudflare KV.");
    }
    await env.RISK_KV.put(`state:${chatId}`, JSON.stringify({ field }));
    return editMessage(env, chatId, messageId, promptText(field));
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (text === "/start" || text === "/help") {
    const s = await getSettings(env, chatId);
    return sendMessage(env, chatId, settingsText(s), mainKeyboard());
  }

  if (!env.RISK_KV) {
    return sendMessage(env, chatId, "KV пока не подключён. Подключи RISK_KV в Cloudflare Workers.");
  }

  const stateRaw = await env.RISK_KV.get(`state:${chatId}`);
  if (!stateRaw) {
    return sendMessage(env, chatId, "Используй кнопки ниже.", mainKeyboard());
  }

  const state = JSON.parse(stateRaw);
  const field = state.field;

  if (!valid(field, text)) {
    return sendMessage(env, chatId, `${promptText(field)}\n\n❌ Некорректное значение.`);
  }

  const s = await getSettings(env, chatId);
  const value = Number(text);

  if (field === "feeOpen") {
    s.feeOpen = value;
    await env.RISK_KV.put(`state:${chatId}`, JSON.stringify({ field: "feeClose" }));
    return sendMessage(env, chatId, promptText("feeClose"));
  }

  s[field] = value;
  await saveSettings(env, chatId, s);
  await env.RISK_KV.delete(`state:${chatId}`);

  return sendMessage(env, chatId, settingsText(s), mainKeyboard());
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("Risk Manager is running.", { status: 200 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const update = await request.json();

      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }

      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error(error);
      return new Response("ok", { status: 200 });
    }
  },
};
