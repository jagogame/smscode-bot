#!/usr/bin/env node
// Download game icons from Google Play Store
// Usage: node scripts/download-game-icons.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, '../public/img/games');
fs.mkdirSync(DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const GAMES = {
  'mobile-legends': 'com.mobile.legends',
  'free-fire': 'com.dts.freefireth',
  'pubg-mobile': 'com.tencent.ig',
  'genshin-impact': 'com.miHoYo.GenshinImpact',
  'valorant': 'com.riotgames.league.valorant',
  'honkai-star-rail': 'com.HoYoverse.hkrpgoversea',
  'honkai-impact-3': 'com.miHoYo.bh3oversea',
  'call-of-duty-mobile': 'com.activision.callofduty.shooter',
  'wild-rift': 'com.riotgames.league.wildrift',
  'arena-of-valor': 'com.ngame.allstar.eu',
  'stumble-guys': 'com.kitkagames.fallbuddies',
  'fc-mobile': 'com.ea.gp.fifamobile',
  'lords-mobile': 'com.igg.android.lordsmobile',
  'point-blank': 'com.zepetto.pointblankstrike',
  'ragnarok-m': 'com.gravity.romg',
  'ragnarok-origin': 'com.gravity.roo.gp.global',
  'one-punch-man': 'com.oasgames.ap.onepunchman_en',
  'sausage-man': 'com.xunyou.sausage',
  'tower-of-fantasy': 'com.levelinfinite.hotta.gp',
  'state-of-survival': 'com.kingsgroup.sos',
  'speed-drifters': 'com.garena.game.sd',
  'asphalt-9': 'com.gameloft.android.ANMP.GloftA9HM',
  'au2-mobile': 'com.boyaa.au2',
  'be-the-king': 'com.more.dagenern.gp',
  'garena': 'com.garena.game.kgid',
  'heroes-evolved': 'com.rsg.heroesevolved',
  'honor-of-kings': 'com.levelinfinite.sgameGlobal',
  'mu-origin-3': 'com.webzen.muorigin3.global',
  'super-sus': 'com.piyigame.suswolf',
  'tom-and-jerry': 'com.netease.tjglobal',
  'revelation': 'com.netease.rw.na',
  'youtube': 'com.google.android.youtube',
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects) => {
      if (redirects > 5) return reject(new Error('too many redirects'));
      const mod = u.startsWith('https') ? require('https') : require('http');
      mod.get(u, { headers: { 'User-Agent': UA } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    doFetch(url, 0);
  });
}

async function downloadIcon(slug, pkg) {
  const outfile = path.join(DIR, `${slug}.jpg`);
  if (fs.existsSync(outfile) && fs.statSync(outfile).size > 1000) {
    console.log(`  SKIP ${slug} (exists)`);
    return true;
  }

  try {
    const html = (await fetch(`https://play.google.com/store/apps/details?id=${pkg}`)).toString();
    const match = html.match(/https:\/\/play-lh\.googleusercontent\.com\/[^"'\s]+/);
    if (!match) {
      console.log(`  FAIL ${slug} — no icon URL in page`);
      return false;
    }

    const iconBase = match[0].split('=')[0];
    const iconUrl = iconBase + '=s512';

    const imgData = await fetch(iconUrl);
    if (imgData.length < 500) {
      console.log(`  FAIL ${slug} — image too small (${imgData.length} bytes)`);
      return false;
    }

    fs.writeFileSync(outfile, imgData);
    console.log(`  OK   ${slug} (${Math.round(imgData.length / 1024)}KB)`);
    return true;
  } catch (e) {
    console.log(`  FAIL ${slug} — ${e.message}`);
    return false;
  }
}

async function main() {
  const entries = Object.entries(GAMES);
  console.log(`Downloading ${entries.length} game icons...\n`);

  let ok = 0, fail = 0;
  for (const [slug, pkg] of entries) {
    const success = await downloadIcon(slug, pkg);
    if (success) ok++; else fail++;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone: ${ok} OK, ${fail} failed`);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jpg'));
  console.log(`Files in ${DIR}: ${files.length}`);
  files.forEach(f => {
    const size = Math.round(fs.statSync(path.join(DIR, f)).size / 1024);
    console.log(`  ${f} (${size}KB)`);
  });
}

main().catch(console.error);
