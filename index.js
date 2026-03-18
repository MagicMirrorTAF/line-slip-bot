require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

// ------------------------
// Reply to LINE
// ------------------------
async function replyMessage(replyToken, text) {
  await axios.post(
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
}

// ------------------------
// Download image from LINE
// ------------------------
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

// ------------------------
// Thunder verify (IMAGE)
// ------------------------
async function verifyWithThunder(imageBuffer) {
  console.log('Thunder key loaded:', process.env.THUNDER_API_KEY);

  const form = new FormData();
  form.append('image', imageBuffer, {
    filename: 'slip.jpg',
    contentType: 'image/jpeg'
  });

  const response = await axios.post(
    'https://api.thunder.in.th/v2/verify/bank',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.THUNDER_API_KEY}`,
        ...form.getHeaders()
      },
      timeout: 30000
    }
  );

  return response.data;
}

// ------------------------
// Format result
// ------------------------
function formatResult(result) {
  if (!result || result.success !== true) {
    return `❌ ${result?.error?.message || 'Verification failed'}`;
  }

  const slip = result.data.rawSlip;
  const lines = ['✅ Slip verified'];

  if (result.data.amountInSlip)
    lines.push(`Amount: ${result.data.amountInSlip} THB`);

  if (slip?.transRef)
    lines.push(`Ref: ${slip.transRef}`);

  const sender = slip?.sender?.account?.name?.th;
  const receiver = slip?.receiver?.account?.name?.th;

  if (sender) lines.push(`Sender: ${sender}`);
  if (receiver) lines.push(`Receiver: ${receiver}`);

  return lines.join('\n');
}

// ------------------------
// TEST ROUTE (IMPORTANT)
// ------------------------
app.get('/test-thunder-auth', async (req, res) => {
  try {
    const response = await axios.get(
      'https://api.thunder.in.th/v2/info',
      {
        headers: {
          Authorization: `Bearer ${process.env.THUNDER_API_KEY}`
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(
      err.response?.data || { message: err.message }
    );
  }
});

// ------------------------
// Basic routes
// ------------------------
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/webhook', (req, res) => {
  res.send('Webhook active');
});

// ------------------------
// LINE webhook
// ------------------------
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== 'message') continue;

      if (event.message.type === 'text') {
        await replyMessage(event.replyToken, 'Send slip image');
        continue;
      }

      if (event.message.type === 'image') {
        try {
          const buffer = await getImageBuffer(event.message.id);
          const result = await verifyWithThunder(buffer);

          console.log('Thunder result:', result);

          await replyMessage(event.replyToken, formatResult(result));
        } catch (err) {
          console.error('ERROR:', err.response?.data || err.message);

          await replyMessage(
            event.replyToken,
            `❌ ${err.response?.data?.error?.message || 'Error'}`
          );
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server running on port', port);
});
