require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

async function replyMessage(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [
        {
          type: 'text',
          text
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== 'message') continue;

    if (event.message.type === 'image') {
      await replyMessage(event.replyToken, 'Received your slip. Checking...');
    } else {
      await replyMessage(event.replyToken, 'Please send a payment slip image.');
    }
  }
});

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});