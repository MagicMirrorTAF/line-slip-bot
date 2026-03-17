require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { inquiry } = require('slipverify');

const app = express();
app.use(express.json());

// ------------------------
// LINE reply helper
// ------------------------
async function replyMessage(replyToken, text) {
  return axios.post(
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
// Decode QR from image
// ------------------------
async function decodeQrFromBuffer(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return qr ? qr.data : null;
}

// ------------------------
// Verify with slipverify + KBANK
// ------------------------
async function verifySlipWithKbank(qrPayload) {
  const result = await inquiry({
    provider: 'kbank',
    clientId: process.env.KBANK_CLIENT_ID,
    clientSecret: process.env.KBANK_CLIENT_SECRET,
    payload: qrPayload
  });

  return result;
}

// ------------------------
// Optional: format result
// ------------------------
function formatVerificationMessage(result) {
  if (!result) {
    return '❌ Verification failed';
  }

  // keep this defensive because provider response shapes can vary
  const lines = [];

  if (result.valid === true) {
    lines.push('✅ Slip verified');
  } else if (result.valid === false) {
    lines.push('❌ Slip invalid');
  } else {
    lines.push('ℹ️ Verification completed');
  }

  if (result.amount) lines.push(`Amount: ${result.amount}`);
  if (result.transRef) lines.push(`Ref: ${result.transRef}`);
  if (result.receiver?.name) lines.push(`Receiver: ${result.receiver.name}`);
  if (result.sender?.name) lines.push(`Sender: ${result.sender.name}`);
  if (result.date) lines.push(`Date: ${result.date}`);
  if (result.time) lines.push(`Time: ${result.time}`);

  return lines.join('\n');
}

// ------------------------
// Health checks
// ------------------------
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/webhook', (req, res) => {
  res.send('Webhook is alive. Use POST.');
});

// ------------------------
// Main webhook
// ------------------------
app.post('/webhook', async (req, res) => {
  console.log('=== WEBHOOK HIT ===');
  console.log(JSON.stringify(req.body, null, 2));

  // respond to LINE immediately
  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== 'message') continue;
      if (!event.replyToken) continue;

      // text messages
      if (event.message.type === 'text') {
        await replyMessage(
          event.replyToken,
          'Send me a payment slip image.'
        );
        continue;
      }

      // image messages
      if (event.message.type === 'image') {
        try {
          const messageId = event.message.id;
          console.log('Image message ID:', messageId);

          const imageBuffer = await getImageBuffer(messageId);
          console.log('Downloaded bytes:', imageBuffer.length);

          const qrPayload = await decodeQrFromBuffer(imageBuffer);
          console.log('QR payload:', qrPayload);

          if (!qrPayload) {
            await replyMessage(
              event.replyToken,
              '❌ I could not read the QR code. Please send a clearer slip image.'
            );
            continue;
          }

          const result = await verifySlipWithKbank(qrPayload);
          console.log('Verification result:', JSON.stringify(result, null, 2));

          const message = formatVerificationMessage(result);
          await replyMessage(event.replyToken, message);
        } catch (imageErr) {
          console.error('IMAGE FLOW ERROR:', imageErr.response?.data || imageErr.message || imageErr);

          await replyMessage(
            event.replyToken,
            '❌ Could not verify this slip right now.'
          );
        }

        continue;
      }

      await replyMessage(
        event.replyToken,
        'Please send a payment slip image.'
      );
    }
  } catch (err) {
    console.error('WEBHOOK ERROR:', err.response?.data || err.message || err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
