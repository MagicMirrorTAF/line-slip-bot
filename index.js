require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { slipVerify } = require('promptparse/validate');

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
// KBANK OAuth
// ------------------------
async function getKbankToken() {
  const basic = Buffer.from(
    `${process.env.KBANK_CLIENT_ID}:${process.env.KBANK_CLIENT_SECRET}`
  ).toString('base64');

  const response = await axios.post(
    'https://openapi-sandbox.kasikornbank.com/v2/oauth/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-test-mode': 'true',
        'env-id': 'OAUTH2'
      }
    }
  );

  return response.data.access_token;
}

// ------------------------
// KBANK inquiry
// NOTE: this body may need one small tweak depending on your exact KBANK product
// ------------------------
async function inquiryKbankWithParsedSlip(parsedSlip) {
  const token = await getKbankToken();

  const requestBody = {
    sendingBank: parsedSlip.sendingBank,
    transRef: parsedSlip.transRef,
    sender: parsedSlip.sender,
    receiver: parsedSlip.receiver,
    amount: parsedSlip.amount
  };

  const response = await axios.post(
    'https://openapi-sandbox.kasikornbank.com/v1/slip/verify',
    requestBody,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-test-mode': 'true'
      }
    }
  );

  return response.data;
}

function formatResult(parsedSlip, bankResult) {
  const lines = [];

  lines.push('✅ Slip processed');

  if (parsedSlip.amount) lines.push(`Amount: ${parsedSlip.amount}`);
  if (parsedSlip.transRef) lines.push(`Ref: ${parsedSlip.transRef}`);
  if (parsedSlip.sendingBank) lines.push(`Bank: ${parsedSlip.sendingBank}`);

  if (bankResult?.status) lines.push(`Status: ${bankResult.status}`);
  if (bankResult?.statusCode) lines.push(`Code: ${bankResult.statusCode}`);

  return lines.join('\n');
}

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/webhook', (req, res) => {
  res.send('Webhook is alive. Use POST.');
});

app.post('/webhook', async (req, res) => {
  console.log('=== WEBHOOK HIT ===');
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== 'message') continue;
      if (!event.replyToken) continue;

      if (event.message.type === 'text') {
        await replyMessage(event.replyToken, 'Send me a payment slip image.');
        continue;
      }

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

          const parsedSlip = slipVerify(qrPayload);
          console.log('Parsed slip:', parsedSlip);

          if (!parsedSlip) {
            await replyMessage(
              event.replyToken,
              '❌ QR found, but it is not a valid Thai slip QR payload.'
            );
            continue;
          }

          const bankResult = await inquiryKbankWithParsedSlip(parsedSlip);
          console.log('KBANK result:', JSON.stringify(bankResult, null, 2));

          await replyMessage(
            event.replyToken,
            formatResult(parsedSlip, bankResult)
          );
        } catch (imageErr) {
          console.error(
            'IMAGE FLOW ERROR:',
            imageErr.response?.data || imageErr.message || imageErr
          );

          await replyMessage(
            event.replyToken,
            '❌ Could not verify this slip right now.'
          );
        }

        continue;
      }

      await replyMessage(event.replyToken, 'Please send a payment slip image.');
    }
  } catch (err) {
    console.error('WEBHOOK ERROR:', err.response?.data || err.message || err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
