require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

// Send reply back to LINE user
async function replyMessage(replyToken, text) {
  const response = await axios.post(
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

  return response.data;
}

// Download image/file content from LINE using message ID
async function getImageBuffer(messageId) {
  const response = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  return Buffer.from(response.data);
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

  // Important: respond to LINE fast
  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      console.log('Event type:', event.type);

      if (event.type !== 'message') continue;
      if (!event.replyToken) continue;

      if (event.message.type === 'text') {
        console.log('Text message received');

        await replyMessage(
          event.replyToken,
          'Bot is working. Send me a payment slip image.'
        );

        console.log('Text reply sent successfully');
      } else if (event.message.type === 'image') {
        console.log('Image received');

        const messageId = event.message.id;
        console.log('Message ID:', messageId);

        // Download image from LINE
        const imageBuffer = await getImageBuffer(messageId);
        console.log('Downloaded image size:', imageBuffer.length);

        // Optional: save image temporarily on server
        const filePath = `/tmp/${messageId}.jpg`;
        fs.writeFileSync(filePath, imageBuffer);
        console.log('Image saved to:', filePath);

        await replyMessage(
          event.replyToken,
          'Received your slip. Image downloaded successfully.'
        );

        console.log('Image reply sent successfully');
      } else {
        console.log('Other message type:', event.message.type);

        await replyMessage(
          event.replyToken,
          'Please send text or an image.'
        );

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
