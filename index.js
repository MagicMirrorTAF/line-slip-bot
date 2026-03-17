require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

async function replyMessage(replyToken, text) {
  const response = await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/webhook', (req, res) => {
  res.send('Webhook is alive. LINE must use POST here.');
});

app.post('/webhook', async (req, res) => {
  console.log('=== WEBHOOK HIT ===');
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      console.log('Event type:', event.type);

      if (event.type !== 'message') continue;
      if (!event.replyToken) continue;

      if (event.message.type === 'text') {
        console.log('Text message received');
        await replyMessage(event.replyToken, 'Bot is working. Send me a slip image.');
        console.log('Reply sent successfully');
      } else if (event.message.type === 'image') {
        console.log('Image received');
        await replyMessage(event.replyToken, 'Received your slip. Checking...');
        console.log('Image reply sent successfully');
      } else {
        console.log('Other message type:', event.message.type);
        await replyMessage(event.replyToken, 'Please send text or an image.');
        console.log('Fallback reply sent successfully');
      }
    }
  } catch (err) {
    console.error('=== ERROR ===');
    console.error(err.response?.data || err.message || err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
