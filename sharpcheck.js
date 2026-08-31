try { const s = require('sharp'); console.log('SHARP OK, version:', s.versions ? s.versions.sharp : 'loaded'); }
catch(e){ console.log('SHARP FAIL:', e.message); }
