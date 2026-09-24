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

const DIARY_PAGE_SIZE = 10;

function diaryKeyboard() {
  return { inline_keyboard: [
    [{ text: "➕ Добавить сделку", callback_data: "diary:add" }],
    [{ text: "📖 Мои сделки", callback_data: "diary:list:0" }, { text: "📊 Статистика", callback_data: "diary:stats" }],
    [{ text: "📈 График депозита", callback_data: "diary:chart:balance" }],
    [{ text: "📊 График P/L", callback_data: "diary:chart:pnl" }],
    [{ text: "📥 Скачать CSV", callback_data: "diary:csv" }],
    [{ text: "⬅️ К калькулятору", callback_data: "diary:back" }]
  ] };
}

function diaryPromptKeyboard() {
  return { inline_keyboard: [
    [{ text: "❌ Отмена", callback_data: "diary:cancel" }]
  ] };
}

function diaryAddKeyboard() {
  return { inline_keyboard: [
    [{ text: "🟢 LONG", callback_data: "diary:dir:LONG" }, { text: "🔴 SHORT", callback_data: "diary:dir:SHORT" }],
    [{ text: "❌ Отмена", callback_data: "diary:cancel" }]
  ] };
}

function diaryListKeyboard(page, total) {
  const pages = Math.max(1, Math.ceil(total / DIARY_PAGE_SIZE));
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Назад", callback_data: `diary:list:${page - 1}` });
  nav.push({ text: `📄 ${page + 1}/${pages}`, callback_data: `diary:list:${page}` });
  if (page < pages - 1) nav.push({ text: "Вперёд ➡️", callback_data: `diary:list:${page + 1}` });
  return { inline_keyboard: [nav, [{ text: "📓 Дневник", callback_data: "diary:menu" }]] };
}

async function ensureDiary(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, created_at TEXT NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL, entry REAL NOT NULL, exit REAL NOT NULL, leverage REAL, pnl REAL NOT NULL, fee REAL DEFAULT 0, comment TEXT DEFAULT '', volume REAL, stop_pct REAL, gross_pnl REAL, margin REAL)`).run();
  const cols = await env.DB.prepare("PRAGMA table_info(trades)").all();
  const have = new Set((cols.results || []).map(x => x.name));
  const additions = [
    ["volume", "REAL"], ["stop_pct", "REAL"], ["gross_pnl", "REAL"], ["margin", "REAL"]
  ];
  for (const [name, type] of additions) {
    if (!have.has(name)) await env.DB.prepare(`ALTER TABLE trades ADD COLUMN ${name} ${type}`).run();
  }
}

async function getDiaryState(env, chatId) {
  if (!env.DB) return null;
  await ensureDiary(env);
  const key = `diary_state:${chatId}`;
  const row = await env.DB.prepare("SELECT value FROM bot_state WHERE chat_id=? AND state_key=?").bind(String(chatId), key).first().catch(()=>null);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function saveDiaryState(env, chatId, state) {
  if (!env.DB) return;
  await ensureStateTable(env);
  const key = `diary_state:${chatId}`;
  await env.DB.prepare("INSERT INTO bot_state(chat_id,state_key,value) VALUES(?,?,?) ON CONFLICT(chat_id,state_key) DO UPDATE SET value=excluded.value").bind(String(chatId), key, JSON.stringify(state)).run();
}

async function ensureStateTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bot_state (chat_id TEXT NOT NULL, state_key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(chat_id,state_key))`).run();
}

async function deleteDiaryState(env, chatId) {
  if (!env.DB) return;
  await ensureStateTable(env);
  await env.DB.prepare("DELETE FROM bot_state WHERE chat_id=? AND state_key=?").bind(String(chatId), `diary_state:${chatId}`).run();
}

async function getCalcInputState(env, chatId) {
  if (!env.DB) return null;
  await ensureStateTable(env);
  const key = `calc_input:${chatId}`;
  const row = await env.DB.prepare("SELECT value FROM bot_state WHERE chat_id=? AND state_key=?").bind(String(chatId), key).first().catch(()=>null);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function saveCalcInputState(env, chatId, state) {
  if (!env.DB) return;
  await ensureStateTable(env);
  const key = `calc_input:${chatId}`;
  await env.DB.prepare("INSERT INTO bot_state(chat_id,state_key,value) VALUES(?,?,?) ON CONFLICT(chat_id,state_key) DO UPDATE SET value=excluded.value").bind(String(chatId), key, JSON.stringify(state)).run();
}

async function deleteCalcInputState(env, chatId) {
  if (!env.DB) return;
  await ensureStateTable(env);
  await env.DB.prepare("DELETE FROM bot_state WHERE chat_id=? AND state_key=?").bind(String(chatId), `calc_input:${chatId}`).run();
}

async function addDiaryTrade(env, chatId, state) {
  await ensureDiary(env);
  const entry = Number(state.entry);
  const exit = Number(state.exit);
  const volume = Number(state.volume);
  const leverage = Number(state.leverage);
  const stopPct = Number(state.stopPct);
  const qty = volume / entry;
  const closeNotional = qty * exit;
  const grossPnl = state.direction === "SHORT"
    ? qty * (entry - exit)
    : qty * (exit - entry);
  // Bybit VIP 0 perpetual/futures taker: 0.055% on entry + 0.055% on exit.
  const fee = volume * 0.00055 + closeNotional * 0.00055;
  const netPnl = grossPnl - fee;
  const margin = volume / leverage;
  await env.DB.prepare("INSERT INTO trades(chat_id,created_at,symbol,direction,entry,exit,leverage,pnl,fee,comment,volume,stop_pct,gross_pnl,margin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(String(chatId), new Date().toISOString(), state.symbol.toUpperCase(), state.direction, entry, exit, leverage, netPnl, fee, String(state.comment||"").slice(0,500), volume, stopPct, grossPnl, margin).run();
  return { grossPnl, fee, netPnl, margin, closeNotional };
}

async function diaryTrades(env, chatId, limit=DIARY_PAGE_SIZE, offset=0) {
  await ensureDiary(env);
  const r = await env.DB.prepare("SELECT id,created_at,symbol,direction,entry,exit,leverage,pnl,fee,comment,volume,stop_pct,gross_pnl,margin FROM trades WHERE chat_id=? ORDER BY id DESC LIMIT ? OFFSET ?").bind(String(chatId), limit, offset).all();
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM trades WHERE chat_id=?").bind(String(chatId)).first();
  return { rows:r.results||[], total:Number(c?.n||0) };
}

async function diaryStats(env, chatId) {
  await ensureDiary(env);
  const r = await env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(pnl),0) pnl, COALESCE(SUM(fee),0) fee, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) wins, SUM(CASE WHEN pnl<0 THEN 1 ELSE 0 END) losses, COALESCE(AVG(CASE WHEN pnl>0 THEN pnl END),0) avg_win, COALESCE(AVG(CASE WHEN pnl<0 THEN pnl END),0) avg_loss FROM trades WHERE chat_id=?`).bind(String(chatId)).first();
  return r || {n:0,pnl:0,fee:0,wins:0,losses:0,avg_win:0,avg_loss:0};
}

function csvEscape(v) { return `"${String(v ?? "").replace(/"/g,'""')}"`; }


function chartConfig(title, labels, values, colorByChange = false) {
  const baseOptions = {
    responsive: false,
    animation: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: title, color: "#f8fafc", font: { size: 24, weight: "700" } },
      tooltip: {
        enabled: true,
        displayColors: false,
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        backgroundColor: "#111827",
        callbacks: {
          label: (ctx) => `Баланс: $${Number(ctx.parsed.y).toFixed(2)}`
        }
      }
    },
    scales: {
      x: { ticks: { color: "#ffffff", maxTicksLimit: 14, font: { size: 14, weight: "600" } }, grid: { color: "#263044" } },
      y: { position: "left", ticks: { color: "#ffffff", font: { size: 14, weight: "600" }, callback: (v) => "$" + Number(v).toFixed(0) }, grid: { color: "#263044" }, title: { display: true, text: "Баланс", color: "#ffffff" } }
    }
  };

  const datasets = [];
  if (!colorByChange) {
    datasets.push({ type: "line", label: title, data: values, yAxisID: "y", borderColor: "#22c55e", backgroundColor: "transparent", borderWidth: 4, pointRadius: values.length > 60 ? 0 : 5, pointHoverRadius: 8, pointBackgroundColor: "#22c55e", pointBorderColor: "#22c55e", fill: false, tension: 0.12 });
  } else {
    for (let i = 0; i < Math.max(0, values.length - 1); i++) {
      const up = Number(values[i + 1]) >= Number(values[i]);
      const color = up ? "#22c55e" : "#ef4444";
      const segmentData = values.map(() => null);
      segmentData[i] = values[i]; segmentData[i + 1] = values[i + 1];
      datasets.push({ type: "line", label: "", data: segmentData, yAxisID: "y", borderColor: color, backgroundColor: "transparent", borderWidth: 4, pointRadius: values.length > 60 ? 0 : 5, pointHoverRadius: 8, pointBackgroundColor: color, pointBorderColor: color, fill: false, tension: 0.12, spanGaps: false });
    }
    if (!datasets.length) datasets.push({ type: "line", label: title, data: values, yAxisID: "y", borderColor: "#22c55e", borderWidth: 4, pointRadius: 5, pointBackgroundColor: "#22c55e", pointBorderColor: "#22c55e", fill: false, tension: 0.12 });
  }
  return { type: "line", data: { labels, datasets }, options: baseOptions };
}

function chartConfigString(title, labels, values, colorByChange = false) {
  return JSON.stringify(chartConfig(title, labels, values, colorByChange));
}

function chartTradeKeyboard(kind, tradePnl, page = 0, state = null) {
  const pnl = Array.isArray(tradePnl) ? tradePnl : [];
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(pnl.length / pageSize));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const from = safePage * pageSize;
  const rows = [];
  for (let i = from; i < Math.min(from + pageSize, pnl.length); i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, Math.min(from + pageSize, pnl.length)); j++) {
      const v = Number(pnl[j]) || 0;
      const icon = v >= 0 ? "🟢" : "🔴";
      const text = `${icon} #${j + 1} ${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
      const callback_data = kind === "calc" ? `calcpt:${j}` : `diarypt:${j}`;
      row.push({ text, callback_data });
    }
    rows.push(row);
  }
  const nav = [];
  if (safePage > 0) nav.push({ text: "⬅️ Сделки", callback_data: `chartpage:${kind}:${safePage - 1}` });
  nav.push({ text: `📄 ${safePage + 1}/${pages}`, callback_data: `chartpage:${kind}:${safePage}` });
  if (safePage < pages - 1) nav.push({ text: "Сделки ➡️", callback_data: `chartpage:${kind}:${safePage + 1}` });
  rows.push(nav);
  rows.push([{ text: "⬅️ Назад", callback_data: "chart:back" }]);
  return { inline_keyboard: rows };
}

async function sendChartPhoto(env, chatId, title, subtitle, labels, values, backCallback, colorByChange = false, tradePnl = [], kind = "diary", state = null, tradePage = 0) {
  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 1100, height: 900, format: "png", version: "4", backgroundColor: "#0b0f17", chart: chartConfigString(title, labels, values, colorByChange) })
  });
  if (!response.ok) throw new Error(`QuickChart HTTP ${response.status}`);
  const image = await response.blob();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", image, "risk-manager-chart.png");
  form.append("caption", `📈 <b>${title}</b>\n${subtitle}\n\n👆 Нажми кнопку сделки ниже — увидишь точный P/L.`);
  form.append("parse_mode", "HTML");
  form.append("reply_markup", JSON.stringify(chartTradeKeyboard(kind, tradePnl, tradePage, state)));
  const tgResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
  const data = await tgResponse.json().catch(() => ({}));
  if (!tgResponse.ok || !data.ok) throw new Error(`Telegram sendPhoto: ${JSON.stringify(data)}`);
}

async function personalChartData(env, chatId) {
  await ensureDiary(env);
  const r=await env.DB.prepare("SELECT id,created_at,pnl FROM trades WHERE chat_id=? ORDER BY id ASC").bind(String(chatId)).all();
  let bal=0;
  const balance=[0], pnl=[0], labels=["Старт"];
  for(const x of (r.results||[])){ bal += Number(x.pnl)||0; balance.push(bal); pnl.push(Number(x.pnl)||0); labels.push(`#${x.id}`); }
  return {balance,pnl,labels,tradePnl:(r.results||[]).map(x=>Number(x.pnl)||0),count:(r.results||[]).length};
}

function calcChartData(s) {
  const c=calculate(s); return {values:[Number(s.deposit),...c.rows.map(r=>Number(r.after))], labels:["Старт",...c.rows.map(r=>`#${r.n}`)], tradePnl:c.rows.map(r=>Number(r.net)||0)};
}

async function diaryCsv(env, chatId) {
  await ensureDiary(env);
  const r = await env.DB.prepare("SELECT id,created_at,symbol,direction,entry,exit,leverage,volume,stop_pct,gross_pnl,pnl,fee,margin,comment FROM trades WHERE chat_id=? ORDER BY id ASC").bind(String(chatId)).all();
  const lines = ["№;Дата;Инструмент;Направление;Вход;Выход;Плечо;Объём;Стоп %;Валовый P/L;Чистый P/L;Комиссия Bybit;Маржа;Комментарий"];
  for (const x of (r.results||[])) lines.push([x.id,new Date(x.created_at).toLocaleString('ru-RU'),x.symbol,x.direction,x.entry,x.exit,x.leverage??'',x.volume??'',x.stop_pct??'',x.gross_pnl??'',x.pnl,x.fee,x.margin??'',x.comment].map(csvEscape).join(';'));
  return lines.join("\n");
}

async function sendCsv(env, chatId, csv) {
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", blob, "trading_diary.csv");
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {method:"POST", body:form});
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.ok) throw new Error(`Telegram sendDocument: ${JSON.stringify(data)}`);
}

function diaryTextMenu() { return ["<b>📓 МОЙ ТОРГОВЫЙ ДНЕВНИК</b>","","Здесь хранятся только твои сделки.","Можно добавлять сделки вручную, смотреть историю, статистику и скачивать CSV."].join("\n"); }

function diaryRowsText(rows, page, total) {
  if (!rows.length) return "<b>📖 Мои сделки</b>\n\nПока сделок нет. Нажми «➕ Добавить сделку».";
  const lines=[`<b>📖 Мои сделки</b>\nСтраница ${page+1}\n`];
  for (const x of rows) {
    const icon=Number(x.pnl)>=0?"🟢":"🔴";
    lines.push(`<b>№${x.id} ${icon} ${x.symbol} ${x.direction}</b>`,`${new Date(x.created_at).toLocaleString('ru-RU')}`,`Объём: ${x.volume!=null?money(x.volume):"—"}`,`Вход: ${x.entry} → выход: ${x.exit}`,`Плечо: ${x.leverage??"—"}x | Стоп: ${x.stop_pct!=null?x.stop_pct+"%":"—"}`,`Комиссия Bybit: ${money(x.fee)}`,`P/L: <b>${Number(x.pnl)>=0?"+":""}${money(x.pnl)}</b>`,x.comment?`📝 ${x.comment}`:"","");
  }
  return lines.join("\n");
}

function diaryAddStartText() { return "<b>➕ Добавление сделки</b>\n\nСначала выбери направление:"; }

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
        { text: "📓 МОЙ ДНЕВНИК", callback_data: "diary:menu" }
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

function tradesKeyboard(s, page, total) {
  const st = packState(s);
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = [];

  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Назад", callback_data: `trades:${page - 1}:${st}` });
  nav.push({ text: `📄 ${page + 1}/${pages}`, callback_data: `trades:${page}:${st}` });
  if (page < pages - 1) nav.push({ text: "Вперёд ➡️", callback_data: `trades:${page + 1}:${st}` });
  rows.push(nav);
  rows.push([{ text: "📈 График депозита", callback_data: `calcchart:${st}` }]);
  rows.push([{ text: "⚙️ К параметрам", callback_data: `back:${st}` }]);
  return { inline_keyboard: rows };
}

function resultText(s, calc, page = 0) {
  const total = calc.rows.length;
  const wr = total ? (calc.wins / total) * 100 : 0;
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const from = safePage * pageSize;
  const pageRows = calc.rows.slice(from, from + pageSize);

  const text = [
    "<b>🧮 РЕЗУЛЬТАТ</b>",
    "",
    `Старт: <b>${money(s.deposit)}</b>`,
    `Цель: <b>${money(s.target)}</b>`,
    `Сделок: <b>${total}</b>`,
    `Побед: <b>${calc.wins}</b>`,
    `Убытков: <b>${calc.losses}</b>`,
    `Win Rate: <b>${wr.toFixed(1)}%</b>`,
    `Финальный депозит: <b>${money(calc.finalDeposit)}</b>`,
    "",
    `<b>📋 СДЕЛКИ ${total ? `${from + 1}–${Math.min(from + pageSize, total)}` : ""}</b>`,
    ""
  ];

  for (const r of pageRows) {
    const sign = r.net >= 0 ? "+" : "-";
    text.push(
      `<b>№${r.n} ${r.result === "W" ? "🟢 WIN" : "🔴 LOSS"}</b>`,
      `Депозит до: ${money(r.deposit)} → после: ${money(r.after)}`,
      `Маржа: ${money(r.margin)} | Позиция: ${money(r.notional)}`,
      `Комиссия: ${money(r.fee)}`,
      `P/L: <b>${sign}${money(Math.abs(r.net))}</b>`,
      ""
    );
  }

  text.push(
    `<i>Страница ${safePage + 1} из ${pages}. Риск считается от текущего депозита; каждая следующая сделка использует депозит после предыдущей.</i>`
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

function customPrompt(field) {
  const hints = {
    deposit: "целое число от <b>$10</b> до <b>$10 000</b> (например <code>347</code>)",
    risk: "от <b>0.01%</b> до <b>100%</b> (например <code>2.5</code>)",
    leverage: "от <b>0.1x</b> до <b>1000x</b> (например <code>12.5</code>)",
    stopMove: "от <b>0.01%</b> до <b>100%</b> (например <code>3.5</code>)",
    winrate: "от <b>0%</b> до <b>100%</b> (например <code>67</code>)",
    tp: "от <b>0%</b> и выше (например <code>275</code> или <code>275.5</code>)",
    target: "положительное число в $ (например <code>2500</code>)",
  };
  return `✏️ <b>Своё значение</b>

${promptText(field)}

Диапазон: ${hints[field] || "введи число"}.
Можно использовать точку или запятую для дробного значения.`;
}

function customKeyboard(s) {
  return { inline_keyboard: [[{ text: "❌ Отмена", callback_data: `back:${packState(s)}` }]] };
}

function valid(field, value) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return false;

  if (field === "deposit") return Number.isInteger(n) && n >= 10 && n <= 10000;
  if (field === "target") return n > 0;
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

  if (!data.startsWith("calcpt:") && !data.startsWith("diarypt:")) {
    await tg(env, "answerCallbackQuery", { callback_query_id: query.id });
  }

  if (data === "reset") {
    await deleteCalcInputState(env, chatId).catch(()=>{});
    const s = cloneDefaults();
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data === "chart:back") {
    // Chart is a photo message. Delete it first, then send a fresh diary menu.
    // Do not rely on query.message.photo being present in the callback payload.
    try {
      await tg(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
      return await sendMessage(env, chatId, diaryTextMenu(), diaryKeyboard());
    } catch (e) {
      console.error("CHART_BACK", e);
      // Fallback: edit the photo caption instead of attempting editMessageText.
      try {
        return await tg(env, "editMessageCaption", {
          chat_id: chatId, message_id: messageId,
          caption: diaryTextMenu(), parse_mode: "HTML", reply_markup: diaryKeyboard()
        });
      } catch (e2) {
        console.error("CHART_BACK_FALLBACK", e2);
        return sendMessage(env, chatId, diaryTextMenu(), diaryKeyboard());
      }
    }
  }

  if (data.startsWith("chartpage:")) {
    const parts = data.split(":");
    const kind = parts[1];
    const page = Math.max(0, Number(parts[2]) || 0);
    try {
      if (kind === "calc") {
        const s = (await getCalcInputState(env, chatId)) || cloneDefaults();
        const d = calcChartData(s);
        return tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: chartTradeKeyboard("calc", d.tradePnl, page, null) });
      }
      const d = await personalChartData(env, chatId);
      return tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: chartTradeKeyboard("diary", d.tradePnl, page, null) });
    } catch (e) {
      console.error("CHART_PAGE", e);
      return;
    }
  }

  if (data.startsWith("calcpt:")) {
    const parts = data.split(":");
    const index = Math.max(0, Number(parts[1]) || 0);
    const s = (await getCalcInputState(env, chatId)) || cloneDefaults();
    const calc = calculate(s);
    const row = calc.rows[index];
    if (!row) return;
    const sign = Number(row.net) >= 0 ? "+" : "-";
    return tg(env, "answerCallbackQuery", { callback_query_id: query.id, text: `Сделка №${row.n}\nP/L: ${sign}$${Math.abs(Number(row.net)).toFixed(2)}\nДепозит после: $${Number(row.after).toFixed(2)}`, show_alert: true });
  }

  if (data.startsWith("diarypt:")) {
    const index = Math.max(0, Number(data.split(":")[1]) || 0);
    const d = await personalChartData(env, chatId);
    if (index >= d.tradePnl.length) return;
    const v = Number(d.tradePnl[index]) || 0;
    const after = Number(d.balance[index + 1]) || 0;
    const sign = v >= 0 ? "+" : "-";
    return tg(env, "answerCallbackQuery", { callback_query_id: query.id, text: `Сделка №${index + 1}\nP/L: ${sign}$${Math.abs(v).toFixed(2)}\nБаланс после: $${after.toFixed(2)}`, show_alert: true });
  }

  if (data === "diary:menu") {
    return editMessage(env, chatId, messageId, diaryTextMenu(), diaryKeyboard());
  }

  if (data === "diary:add") {
    await saveDiaryState(env, chatId, {step:"direction"});
    return editMessage(env, chatId, messageId, diaryAddStartText(), diaryAddKeyboard());
  }

  if (data === "diary:cancel") {
    await deleteDiaryState(env, chatId);
    return editMessage(env, chatId, messageId, diaryTextMenu(), diaryKeyboard());
  }

  if (data === "diary:back") {
    const s = cloneDefaults();
    return editMessage(env, chatId, messageId, settingsText(s), mainKeyboard(s));
  }

  if (data.startsWith("diary:dir:")) {
    const direction = data.split(":")[2];
    await saveDiaryState(env, chatId, {step:"symbol", direction});
    return editMessage(env, chatId, messageId, "<b>➕ Добавление сделки</b>\n\nВведи тикер, например: <code>BTCUSDT</code>", diaryPromptKeyboard());
  }

  if (data.startsWith("diary:list:")) {
    const page=Math.max(0,Number(data.split(":")[2])||0);
    const result=await diaryTrades(env,chatId,DIARY_PAGE_SIZE,page*DIARY_PAGE_SIZE);
    return editMessage(env,chatId,messageId,diaryRowsText(result.rows,page,result.total),diaryListKeyboard(page,result.total));
  }

  if (data === "diary:stats") {
    const x=await diaryStats(env,chatId);
    const wr=(Number(x.wins)+Number(x.losses))?Number(x.wins)/(Number(x.wins)+Number(x.losses))*100:0;
    return editMessage(env,chatId,messageId,["<b>📊 Статистика дневника</b>","",`Сделок: <b>${x.n}</b>`,`🟢 Прибыльных: <b>${x.wins}</b>`,`🔴 Убыточных: <b>${x.losses}</b>`,`Win Rate: <b>${wr.toFixed(1)}%</b>`,`Общий P/L: <b>${Number(x.pnl)>=0?"+":""}${money(x.pnl)}</b>`,`Комиссии: <b>${money(x.fee)}</b>`,`Средняя прибыль: <b>+${money(x.avg_win)}</b>`,`Средний убыток: <b>${money(x.avg_loss)}</b>`,"", "Все показатели считаются только по твоим сделкам."].join("\n"),diaryKeyboard());
  }

  if (data === "diary:chart:balance") {
    const d=await personalChartData(env,chatId);
    if(!d.count) return editMessage(env,chatId,messageId,"<b>📈 График депозита</b>\n\nСначала добавь хотя бы одну сделку.",diaryKeyboard());
    try {
      await sendChartPhoto(env, chatId, "График баланса", "🟢 прибыльная · 🔴 убыточная · нажми кнопку сделки для точного P/L", d.labels, d.balance, "diary:menu", true, d.tradePnl, "diary", null, 0);
    } catch (e) {
      console.error("DIARY_BALANCE_CHART", e);
      await sendMessage(env, chatId, "❌ Не удалось построить график. Нажми кнопку ещё раз.", diaryKeyboard());
    }
    return;
  }

  if (data === "diary:chart:pnl") {
    const d=await personalChartData(env,chatId);
    if(!d.count) return editMessage(env,chatId,messageId,"<b>📊 График P/L</b>\n\nСначала добавь хотя бы одну сделку.",diaryKeyboard());
    try {
      await sendChartPhoto(env, chatId, "Кривая P/L", "Фактические сделки · накопительный P/L", d.labels, d.pnl, "diary:menu", false, d.tradePnl, "diary", null, 0);
    } catch (e) {
      console.error("DIARY_PNL_CHART", e);
      await sendMessage(env, chatId, "❌ Не удалось построить график. Нажми кнопку ещё раз.", diaryKeyboard());
    }
    return;
  }

  if (data === "diary:csv") {
    const csv=await diaryCsv(env,chatId);
    await sendCsv(env,chatId,csv);
    return;
  }

  if (data.startsWith("deposit:custom:")) {
    const s = unpackState(data.slice("deposit:custom:".length));
    await saveCalcInputState(env, chatId, { step: "deposit", state: s });
    return editMessage(env, chatId, messageId,
      "✏️ <b>Ввод депозита</b>\n\nОтправь целое число от <b>$10</b> до <b>$10 000</b>.\nНапример: <code>347</code> или <code>1250</code>.",
      { inline_keyboard: [[{ text: "❌ Отмена", callback_data: `back:${packState(s)}` }]] });
  }

  if (data.startsWith("custom:")) {
    const parts = data.split(":");
    const field = parts[1];
    const s = unpackState(parts.slice(2).join(":"));
    const allowed = ["deposit","risk","leverage","stopMove","winrate","tp","target"];
    if (!allowed.includes(field)) return editMessage(env, chatId, messageId, "❌ Неизвестный параметр.", mainKeyboard(s));
    await saveCalcInputState(env, chatId, { step: field, state: s });
    return editMessage(env, chatId, messageId, customPrompt(field), customKeyboard(s));
  }

  // All menu/choice buttons carry the complete current state, so KV is not needed.
  if (data.startsWith("menu:")) {
    const [, menu, ...rest] = data.split(":");
    const s = unpackState(rest.join(":"));

    if (menu === "deposit") {
      const kb = valueKeyboard("Депозит", "deposit", [10,50,100,250,500,1000,5000,10000], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести свой депозит", callback_data: `deposit:custom:${packState(s)}` }]);
      return editMessage(env, chatId, messageId,
        "💰 <b>Депозит</b>\n\nВыбери сумму или введи свою.\nДиапазон: <b>$10–$10 000</b>, с шагом $1.", kb);
    }
    if (menu === "risk") {
      const kb = valueKeyboard("Риск", "risk", [1,2,5,10,15,20], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:risk:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "⚠️ <b>Риск на одну сделку</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
    if (menu === "leverage") {
      const kb = valueKeyboard("Плечо", "leverage", [5,8,10,15,20], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:leverage:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "🔧 <b>Плечо</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
    if (menu === "stop") {
      const kb = valueKeyboard("Стоп", "stopMove", [4,8,10], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:stopMove:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "🛑 <b>Стоп по движению актива</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
    if (menu === "winrate") {
      const kb = valueKeyboard("Win Rate", "winrate", [50,60,70,80,90,100], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:winrate:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "🎯 <b>Win Rate</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
    if (menu === "tp") {
      const kb = valueKeyboard("TP", "tp", [50,100,150,200,250,300,350,400,450,500], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:tp:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "📈 <b>Take Profit</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
    if (menu === "target") {
      const kb = valueKeyboard("Цель", "target", [100,250,500,1000,5000,10000], s);
      kb.inline_keyboard.splice(-1, 0, [{ text: "✏️ Ввести своё значение", callback_data: `custom:target:${packState(s)}` }]);
      return editMessage(env, chatId, messageId, "🏁 <b>Целевой депозит</b>\n\nВыбери готовое значение или введи своё.", kb);
    }
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
      await saveCalcInputState(env, chatId, { step: "fees", state: s });
      return editMessage(env, chatId, messageId,
        "✏️ <b>Своя комиссия</b>\n\nОтправь одной строкой: <code>0.055 0.055</code>\nПервое число — открытие, второе — закрытие.\nМожно использовать дробные значения и запятую.", customKeyboard(s));
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
    const calc = calculate(s);
    return editMessage(env, chatId, messageId, resultText(s, calc, 0), tradesKeyboard(s, 0, calc.rows.length));
  }

  if (data.startsWith("calcchart:")) {
    const s=unpackState(data.slice("calcchart:".length));
    const d=calcChartData(s);
    await saveCalcInputState(env, chatId, s).catch(()=>{});
    try {
      await sendChartPhoto(env, chatId, "График расчётного депозита", "🟢 прибыльная · 🔴 убыточная · нажми кнопку сделки для точного P/L", d.labels, d.values, `trades:0:${packState(s)}`, true, d.tradePnl, "calc", packState(s), 0);
    } catch (e) {
      console.error("CALC_CHART", e);
      await sendMessage(env, chatId, "❌ Не удалось построить график. Нажми кнопку ещё раз.", tradesKeyboard(s, 0, calculate(s).rows.length));
    }
    return;
  }

  if (data.startsWith("trades:")) {
    const parts = data.split(":");
    const page = Number(parts[1]);
    const s = (await getCalcInputState(env, chatId)) || cloneDefaults();
    const calc = calculate(s);
    return editMessage(env, chatId, messageId, resultText(s, calc, page), tradesKeyboard(s, page, calc.rows.length));
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

  if (text === "/diary" || text === "мой дневник" || text === "дневник") {
    return sendMessage(env, chatId, diaryTextMenu(), diaryKeyboard());
  }

  if (text === "/calc") {
    return sendMessage(env, chatId,
      "Используй кнопки ниже — все основные параметры выбираются без ручного ввода.",
      mainKeyboard(cloneDefaults())
    );
  }

  const diaryState = await getDiaryState(env, chatId).catch(() => null);
  if (diaryState) {
    const diarySteps = new Set(["symbol", "entry", "exit", "volume", "leverage", "stopPct", "comment"]);
    if (!diarySteps.has(diaryState.step)) {
      await deleteDiaryState(env, chatId);
      return sendMessage(env, chatId, diaryAddStartText(), diaryAddKeyboard());
    }
    if (diaryState.step === "symbol") { diaryState.symbol=text; diaryState.step="entry"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Введи <b>цену входа</b>:",diaryPromptKeyboard()); }
    if (diaryState.step === "entry") { const n=Number(text.replace(",",".")); if(!(n>0)) return sendMessage(env,chatId,"❌ Введи положительную цену входа.",diaryPromptKeyboard()); diaryState.entry=n; diaryState.step="exit"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Введи <b>цену выхода</b> (фактическая цена закрытия):",diaryPromptKeyboard()); }
    if (diaryState.step === "exit") { const n=Number(text.replace(",",".")); if(!(n>0)) return sendMessage(env,chatId,"❌ Введи положительную цену выхода.",diaryPromptKeyboard()); diaryState.exit=n; diaryState.step="volume"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Введи <b>объём позиции в $</b>. Например: <code>500</code>",diaryPromptKeyboard()); }
    if (diaryState.step === "volume") { const n=Number(text.replace(",",".")); if(!(n>0)) return sendMessage(env,chatId,"❌ Введи положительный объём позиции в $.",diaryPromptKeyboard()); diaryState.volume=n; diaryState.step="leverage"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Введи <b>плечо</b>, например <code>10</code>:",diaryPromptKeyboard()); }
    if (diaryState.step === "leverage") { const n=Number(text.replace(",",".")); if(!(n>0)||n>1000) return sendMessage(env,chatId,"❌ Введи плечо от 0.1x до 1000x.",diaryPromptKeyboard()); diaryState.leverage=n; diaryState.step="stopPct"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Введи <b>стоп в %</b> от цены входа. Например: <code>2.5</code>",diaryPromptKeyboard()); }
    if (diaryState.step === "stopPct") { const n=Number(text.replace(",",".")); if(!(n>0)||n>100) return sendMessage(env,chatId,"❌ Введи стоп от 0.01% до 100%.",diaryPromptKeyboard()); diaryState.stopPct=n; diaryState.step="comment"; await saveDiaryState(env,chatId,diaryState); return sendMessage(env,chatId,"Комментарий к сделке или <code>-</code>, если без комментария.\n\n💸 Комиссию вводить <b>не нужно</b> — бот сам посчитает её по стандартной ставке Bybit Taker 0.055% на вход и 0.055% на выход.",diaryPromptKeyboard()); }
    if (diaryState.step === "comment") { diaryState.comment=text === "-" ? "" : text; const result=await addDiaryTrade(env,chatId,diaryState); await deleteDiaryState(env,chatId); const sign=result.netPnl>=0?"+":"-"; const stopPrice=diaryState.direction==="LONG" ? diaryState.entry*(1-diaryState.stopPct/100) : diaryState.entry*(1+diaryState.stopPct/100); return sendMessage(env,chatId,["<b>✅ Сделка сохранена</b>","",`📦 Объём: <b>${money(diaryState.volume)}</b>`,`💵 Валовый P/L: <b>${result.grossPnl>=0?"+":"-"}${money(Math.abs(result.grossPnl))}</b>`,`💸 Комиссия Bybit: <b>${money(result.fee)}</b>`,`💰 Чистый P/L: <b>${sign}${money(Math.abs(result.netPnl))}</b>`,`🔧 Маржа: <b>${money(result.margin)}</b>`,`🛑 Стоп ${diaryState.stopPct}% → ориентир ${money(stopPrice)}`].join("\n"),diaryKeyboard()); }
  }

  const calcInputState = await getCalcInputState(env, chatId).catch(() => null);
  if (calcInputState?.step) {
    const field = calcInputState.step;
    const s = calcInputState.state || cloneDefaults();

    if (field === "fees") {
      const nums = parseNumbers(text);
      if (nums.length < 2 || nums[0] < 0 || nums[1] < 0) {
        return sendMessage(env, chatId,
          "❌ Некорректная комиссия.\n\nВведи две комиссии через пробел, например: <code>0.055 0.055</code>.",
          customKeyboard(s));
      }
      s.feeOpen = nums[0];
      s.feeClose = nums[1];
      await deleteCalcInputState(env, chatId);
      return sendMessage(env, chatId, settingsText(s), mainKeyboard(s));
    }

    const normalized = text.replace(/[$₽%xX\s]/g, "").replace(",", ".");
    const n = Number(normalized);
    if (!valid(field, n)) {
      return sendMessage(env, chatId,
        `❌ Некорректное значение.\n\n${customPrompt(field)}`,
        customKeyboard(s));
    }
    s[field] = n;
    await deleteCalcInputState(env, chatId);
    return sendMessage(env, chatId, settingsText(s), mainKeyboard(s));
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
