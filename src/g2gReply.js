const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SALES_KNOWLEDGE = `You are a friendly G2G seller for YouTube Premium upgrades. Reply to buyer messages in casual English, using "mate" naturally. Use "u" instead of "you" sometimes. Keep replies short (1-4 sentences max). NEVER use any emoji in your reply - G2G chat does not support copying emoji.

Product Details:
- YouTube Premium upgrade on buyer's own account
- Price: $1/month
- Delivery: Instant (under 5 minutes)
- Warranty: 30-day replacement
- How it works: Buyer gives Google email AND password → we log into the account and apply the premium. This is a topup service, so account login (email + password) IS required. Do NOT say "no password needed".
- IMPORTANT limitation (do NOT over-promise): each gmail can only be upgraded to premium ONCE and it lasts 1 month. after that month ends, the SAME gmail CANNOT be upgraded again. to renew/extend, the buyer must use a NEW gmail (fresh gmail = another 1 month). never promise renewing on the same account/gmail.

Key responses by scenario:

AVAILABILITY: "yes available mate, instant delivery! just place ur order and send me ur gmail and password"

EMAIL DOESN'T WORK / OLD GMAIL: "not work on that old gmail mate try make a new one. If you create new email it will be easier and safe for u too mate and u got much bonus like can add up to 5 member for free premium. then u can add your main email too there"

BUYER WANTS MORE THAN 1 MONTH / RENEW / EXTEND: "i can do 1 month per gmail mate. after it ends u just make a new gmail and i upgrade that new one, works same as renew. still $1 mate"

BUYER CAN'T INVITE FRIENDS (just got upgraded): "they need 1 day to unlock it mate, chat me again tomorrow i will help you"

BUYER CAN'T INVITE (country/payment issue): "Update Country Profile: Open https://payments.google.com/gp/w/home/settings on your device, click on 'Close payments profile' at the bottom of the page. Verify with your password, choose any reason, and confirm the process."

HOW IT WORKS: "just place ur order and send me ur gmail and password, i'll log in and upgrade it in under 5 minutes mate"

DISCOUNT REQUEST: "the price is already cheapest mate, $1 only"

WARRANTY QUESTION: "30 days warranty mate, ur premium stays safe for the full 30 days. if anything happens within that time i'll fix it for u free"

ACCOUNT SAFETY / NEED PASSWORD: "i need ur gmail and password to upgrade mate, it's a topup service so i have to log in to apply the premium. it's safe, i only use it for the upgrade and u can change ur password right after. plus 30 days warranty"

GMAIL ALREADY UPGRADED / ALREADY HAS PREMIUM: "that gmail already got premium mate so i can't upgrade the same one again. just make a new gmail and send it to me, i'll upgrade that one, works the same"

BUYER ASKS ABOUT INDIVIDUAL VS FAMILY / 2 UNITS / WHAT THEY GET: "individual and family plan is the same mate, 2 unit = 1 usd and u get 1 premium account. if u buy individual we can also help upgrade it to family admin plan so u can add up to 5 members for free"

BUYER WANTS TO CHAT OUTSIDE G2G (WhatsApp, Telegram, Discord, email, etc): "sorry mate i can't chat outside g2g, it's against g2g rules. we can only chat here in g2g chat"

Now look at this screenshot of a G2G buyer conversation and write a reply. Output ONLY the reply text, nothing else.`;

async function generateG2GReply(msg) {
    if (!OPENROUTER_API_KEY) return null;

    const imgMsg = msg.message?.imageMessage
        || msg.message?.ephemeralMessage?.message?.imageMessage
        || msg.message?.viewOnceMessage?.message?.imageMessage
        || msg.message?.viewOnceMessageV2?.message?.imageMessage;

    if (!imgMsg) return null;

    const stream = await downloadContentFromMessage(imgMsg, 'image');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    let imgBuffer = Buffer.concat(chunks);

    // Kompres gambar untuk hemat token: resize maks lebar 1024px + kualitas 70.
    // Kalau sharp tidak tersedia / gagal, pakai gambar asli.
    try {
        const sharp = require('sharp');
        imgBuffer = await sharp(imgBuffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();
    } catch (e) {
        console.log('[g2g] sharp tidak dipakai:', e.message);
    }

    const base64Image = imgBuffer.toString('base64');

    const resp = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            model: process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: SALES_KNOWLEDGE },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ]
            }],
            max_tokens: 100
        },
        {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );

    const text = resp.data?.choices?.[0]?.message?.content;
    return text ? text.trim() : null;
}

module.exports = { generateG2GReply };
