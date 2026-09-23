// Telegram Risk Manager Bot — Cloudflare Worker
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Risk Manager Bot is running", { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        let reply = "Риск-менеджер готов. Отправьте команду /start.";

        if (text === "/start") {
          reply =
            "📊 Риск-менеджер\n\n" +
            "Личный калькулятор риска для сделки.\n\n" +
            "Команда /calc — начать расчёт.";
        } else if (text === "/calc") {
          reply =
            "Введите данные для расчёта риска.\n\n" +
            "Пример:\n" +
            "Депозит: 100000\n" +
            "Риск: 1%\n" +
            "Стоп: 2%";
        }

        if (env.BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: reply })
          });
        }
      }

      return new Response("OK", { status: 200 });
    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }
  }
};
