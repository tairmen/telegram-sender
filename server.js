import express from "express";
import dotenv from "dotenv";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import OpenAI from "openai";

dotenv.config();

/* =======================
   BOOT LOGS
======================= */
console.log("🚀 Starting server...");
console.log("TELEGRAM_API_ID:", process.env.TELEGRAM_API_ID ? "OK" : "❌");
console.log("TELEGRAM_API_HASH:", process.env.TELEGRAM_API_HASH ? "OK" : "❌");
console.log("TELEGRAM_SESSION:", process.env.TELEGRAM_SESSION ? "OK" : "❌");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "OK" : "❌");

/* =======================
   APP
======================= */
const app = express();
app.use(express.json());

/* =======================
   OpenAI
======================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =======================
   Telegram client
======================= */
const tgClient = new TelegramClient(
  new StringSession(process.env.TELEGRAM_SESSION),
  Number(process.env.TELEGRAM_API_ID),
  process.env.TELEGRAM_API_HASH,
  { connectionRetries: 5 }
);

console.log("⏳ Connecting to Telegram...");
await tgClient.connect();
console.log("✅ Telegram connected");

/* =======================
   Dialogs (userId -> messages[])
======================= */
const dialogs = new Map();

/* =======================
   Helper: send TG message
   returns userId
======================= */
async function sendTelegramMessage(phone, text) {
  console.log(`📤 Sending first message to ${phone}`);
  console.log("📨 Text:", text);

  const result = await tgClient.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: Date.now(),
          phone,
          firstName: "Temp",
          lastName: "User",
        }),
      ],
    })
  );

  console.log("📇 Import result users:", result.users.length);

  if (!result.users.length) {
    throw new Error("User not found after import");
  }

  const user = result.users[0];
  console.log("👤 userId:", user.id.value.toString());

  await tgClient.sendMessage(user.id, {
    message: text,
  });

  console.log("✅ First message sent");

  return user.id.value.toString();
}

/* =======================
   POST /send
======================= */
app.post("/send", async (req, res) => {
  console.log("📥 /send called");
  console.log("📦 Body:", req.body);

  const { phone, firstMessage, prompt } = req.body;

  if (!phone || !firstMessage || !prompt) {
    console.warn("⚠️ Missing fields");
    return res.status(400).json({
      error: "phone, firstMessage и prompt обязательны",
    });
  }

  try {
    const userId = await sendTelegramMessage(phone, firstMessage);

    dialogs.set(userId, [
      { role: "system", content: prompt },
      { role: "assistant", content: firstMessage },
    ]);

    console.log("🧠 Dialog created for userId:", userId);

    res.json({ success: true, userId });
  } catch (err) {
    console.error("❌ /send error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function findUserIdByPhone(phone) {
  try {
    const result = await tgClient.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: Date.now(),
            phone,
            firstName: "Temp",
            lastName: "User",
          }),
        ],
      })
    );

    if (!result.users.length) return null;

    return result.users[0].id.value.toString();
  } catch (err) {
    console.error("❌ findUserIdByPhone error:", err);
    return null;
  }
}

app.post("/update-prompt", async (req, res) => {
  const { phone, userId: providedUserId, newPrompt } = req.body;

  if (!newPrompt) {
    return res.status(400).json({ error: "newPrompt обязателен" });
  }

  if (!phone && !providedUserId) {
    return res.status(400).json({ error: "Необходим либо phone, либо userId" });
  }

  try {
    let userId = providedUserId;

    // Если передан phone, находим userId
    if (phone && !providedUserId) {
      userId = await findUserIdByPhone(phone);
      if (!userId) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }
    }

    if (!dialogs.has(userId)) {
      return res.status(404).json({ error: "Диалог с этим пользователем не найден" });
    }

    const history = dialogs.get(userId);

    // Обновляем system prompt (первый элемент с role: system)
    if (history.length > 0 && history[0].role === "system") {
      history[0].content = newPrompt;
    } else {
      history.unshift({ role: "system", content: newPrompt });
    }

    console.log(`🧠 Prompt updated for userId: ${userId}`);
    res.json({ success: true, userId });
  } catch (err) {
    console.error("❌ /update-prompt error:", err);
    res.status(500).json({ error: err.message });
  }
});



/* =======================
   Incoming Telegram msgs
======================= */
tgClient.addEventHandler(
  async (event) => {
    try {
      const message = event.message;
      if (!message || !message.message) return;

      const text = message.message;
      const sender = await message.getSender();
      if (!sender) return;

      const userId = sender.id.value.toString();

      console.log("📩 Incoming message");
      console.log("👤 userId:", userId);
      console.log("💬 text:", text);

      if (!dialogs.has(userId)) {
        console.log("⛔ No dialog for this userId, ignoring");
        return;
      }

      const history = dialogs.get(userId);
      history.push({ role: "user", content: text });

      console.log("🤖 Sending to ChatGPT...");

      const completion = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: history,
      });

      const reply = completion.choices[0].message.content;

      console.log("🤖 ChatGPT reply:", reply);

      history.push({ role: "assistant", content: reply });

      console.log("📤 Sending reply to Telegram...");

      await tgClient.sendMessage(sender.id, {
        message: reply,
      });

      console.log("✅ Reply sent");
    } catch (err) {
      console.error("❌ Incoming handler error:", err);
    }
  },
  new NewMessage({ incoming: true })
);

/* =======================
   START HTTP SERVER
======================= */
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 HTTP server running on port ${process.env.PORT || 3000}`);
});
