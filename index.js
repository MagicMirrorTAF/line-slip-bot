require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const jsQR = require('jsqr');

const app = express();
app.use(express.json());

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

async function decodeQrFromBuffer(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return qr ? qr.data : null;
}

async function verifyWithThunder(qrPayload) {
  const response = await axios.post(
    'https://api.thunder.in.th/v2/verify/bank',
    {
      payload: qrPayload
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.THUNDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  );

  return response.data;
}

function formatThunderResult(result) {
  if (!result || result.success !== true || !result.data || !result.data.rawSlip) {
    if (result && result.error && result.error.message) {
      return `❌ ตรวจสอบไม่สำเร็จ\n${result.error.message}`;
    }
    return '❌ ตรวจสอบไม่สำเร็จ';
  }

  const slip = result.data.rawSlip;
  const lines = ['✅ ตรวจสอบสลิปสำเร็จ'];

  if (slip.transRef) lines.push(`เลขอ้างอิง: ${slip.transRef}`);
  if (slip.date) lines.push(`วันที่: ${slip.date}`);

  if (slip.amount && slip.amount.local && slip.amount.local.amount != null) {
    lines.push(`ยอดเงิน: ${slip.amount.local.amount} ${slip.amount.local.currency || 'THB'}`);
  } else if (slip.amount && slip.amount.amount != null) {
    lines.push(`ยอดเงิน: ${slip.amount.amount}`);
  }

  const senderBank = slip.sender?.bank?.short || slip.sender?.bank?.name;
  const senderName = slip.sender?.account?.name?.th || slip.sender?.account?.name?.en;
  const receiverBank = slip.receiver?.bank?.short || slip.receiver?.bank?.name;
  const receiverName = slip.receiver?.account?.name?.th || slip.receiver?.account?.name?.en;

  if (senderBank || senderName) {
    lines.push(`ผู้โอน: ${senderName || '-'}${senderBank ? ` (${senderBank})` : ''}`);
  }

  if (receiverBank || receiverName) {
    lines.push(`ผู้รับ: ${receiverName || '-'}${receiverBank ? ` (${receiverBank})` : ''}`);
  }

  return lines.join('\n');
}

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/webhook', (req, res) => {
  res.send('Webhook is alive. Use POST.');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== 'message') continue;
      if (!event.replyToken) continue;

      if (event.message.type === 'text') {
        await replyMessage(
          event.replyToken,
          'ส่งรูปสลิปมาได้เลย'
        );
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
              '❌ อ่าน QR ไม่ได้ กรุณาส่งรูปสลิปที่ชัดกว่านี้'
            );
            continue;
          }

          const thunderResult = await verifyWithThunder(qrPayload);
          console.log('Thunder result:', JSON.stringify(thunderResult, null, 2));

          const message = formatThunderResult(thunderResult);
          await replyMessage(event.replyToken, message);
        } catch (err) {
          console.error('IMAGE FLOW ERROR:', err.response?.data || err.message || err);

          let msg = '❌ ตรวจสอบสลิปไม่ได้ในตอนนี้';
          if (err.response?.data?.error?.message) {
            msg = `❌ ${err.response.data.error.message}`;
          }

          await replyMessage(event.replyToken, msg);
        }

        continue;
      }

      await replyMessage(
        event.replyToken,
        'กรุณาส่งเป็นรูปสลิป'
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
