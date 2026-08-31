function generateDesk(skinsData, extra = {}) {
  const allowedRarities = ['Supreme', 'Grand', 'Exquisite'];

  const rareCounts = { Supreme: 0, Grand: 0, Exquisite: 0 };

  const filteredSkins = skinsData.skins.filter(s => allowedRarities.includes(s.rarity));

  const grouped = { Supreme: {}, Grand: {}, Exquisite: {} };

  filteredSkins.forEach(skin => {
    rareCounts[skin.rarity]++;

    // Tag fallback: tag → tags[0] → skinName → rarity (biar skin rare tanpa tag tetap masuk)
    let tag = skin.tag || (Array.isArray(skin.tags) && skin.tags[0]) || skin.skinName || skin.rarity;
    if (tag.startsWith('The ')) tag = tag.substring(4);

    if (!grouped[skin.rarity][tag]) grouped[skin.rarity][tag] = [];
    grouped[skin.rarity][tag].push(skin);
  });

  const totalRare = rareCounts.Supreme + rareCounts.Grand + rareCounts.Exquisite;
  const totalSkin = skinsData.total || (skinsData.collection && skinsData.collection.skin_count) || filteredSkins.length;

  // Header info akun
  let output = '';
  if (extra.nickname) output += `🎮 ${extra.nickname}\n`;
  if (extra.collectorTitle) output += `🏆 ${extra.collectorTitle}\n`;
  output += `📦 Total Skin: ${totalSkin}\n\n`;

  output += 'Desk:\n';

  allowedRarities.forEach(rarity => {
    if (rareCounts[rarity] > 0) {
      output += `[${rarity.toUpperCase()}]\n`;
      const tags = Object.keys(grouped[rarity]).sort();
      tags.forEach(tag => {
        grouped[rarity][tag]
          .sort((a, b) => (a.heroName || '').localeCompare(b.heroName || ''))
          .forEach(skin => { output += `${tag} ${skin.heroName}\n`; });
      });
      output += '\n';
    }
  });

  output += `${totalRare} skin rare: ${rareCounts.Supreme} Supreme + ${rareCounts.Grand} Grand + ${rareCounts.Exquisite} Exquisite\n`;

  return {
    text: output,
    totalRare: totalRare,
    totalSkin: totalSkin,
    counts: rareCounts
  };
}

module.exports = { generateDesk };
