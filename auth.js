import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import dotenv from "dotenv";

dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// пустая сессия при первом запуске
const stringSession = new StringSession("");

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Telegram номер (+380...): "),
    phoneCode: async () => await input.text("Код из Telegram: "),
    password: async () => await input.text("2FA пароль (если есть): "),
    onError: (err) => console.log(err),
  });

  console.log("✅ Авторизация успешна");
  console.log("👇 СОХРАНИ ЭТУ СТРОКУ В .env");
  console.log(client.session.save());

  process.exit(0);
})();
