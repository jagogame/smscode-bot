function generateDesk(skinsData) {
  const allowedRarities = ['Supreme', 'Grand', 'Exquisite'];
  
  // Hitung jumlah
  const rareCounts = {
    Supreme: 0,
    Grand: 0,
    Exquisite: 0
  };

  // Filter skin yang masuk kriteria
  const filteredSkins = skinsData.skins.filter(s => allowedRarities.includes(s.rarity));

  // Struktur pengelompokan
  const grouped = {
    Supreme: {},
    Grand: {},
    Exquisite: {}
  };

  filteredSkins.forEach(skin => {
    rareCounts[skin.rarity]++;
    
    // Hapus awalan "The " dari tag
    let tag = skin.tag || 'Unknown';
    if (tag.startsWith('The ')) {
      tag = tag.substring(4);
    }
    // Jika tag kosong/tidak valid tapi punya rarity Supreme, kadang ada yang tag-nya 'Legend' dll.
    
    if (!grouped[skin.rarity][tag]) {
      grouped[skin.rarity][tag] = [];
    }
    grouped[skin.rarity][tag].push(skin);
  });

  let output = 'Desk:\n';
  
  allowedRarities.forEach(rarity => {
    if (rareCounts[rarity] > 0) {
      output += `[${rarity.toUpperCase()}]\n`;
      
      const tags = Object.keys(grouped[rarity]).sort();
      tags.forEach(tag => {
        // Sort skin berdasarkan nama hero di dalam satu tag (opsional tapi lebih rapi)
        grouped[rarity][tag].sort((a, b) => a.heroName.localeCompare(b.heroName)).forEach(skin => {
          output += `${tag} ${skin.heroName}\n`;
        });
      });
      output += '\n';
    }
  });

  const totalRare = rareCounts.Supreme + rareCounts.Grand + rareCounts.Exquisite;
  output += `${totalRare} skin rare: ${rareCounts.Supreme} Supreme + ${rareCounts.Grand} Grand + ${rareCounts.Exquisite} Exquisite\n`;
  
  return {
    text: output,
    totalRare: totalRare,
    counts: rareCounts
  };
}

module.exports = { generateDesk };
