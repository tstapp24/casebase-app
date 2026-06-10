'use strict';

// Structured pricing factors — each entry maps to a real item field where possible.
// getItemData(item) returns { label, color? } for the inline badge, or null if the factor
// is not applicable to this specific item.
window.PRICING_FACTORS = [
  {
    id: 'float',
    title: 'Float Value & Condition',
    icon: '⚡',
    description:
      'Each skin has a unique float value (0.00–1.00) assigned at creation that cannot change, ' +
      'dictating its wear level from Factory New to Battle-Scarred. Lower float values generally ' +
      'command higher prices, though some skins reveal unique patterns or "easter eggs" at higher wear levels.',
    getItemData(item) {
      if (!item.wear || item.wear === 'Not Painted' || item.type === 'Sticker' || item.type === 'Graffiti') return null;
      const floatRanges = {
        'Factory New':   '0.00–0.07',
        'Minimal Wear':  '0.07–0.15',
        'Field-Tested':  '0.15–0.38',
        'Well-Worn':     '0.38–0.45',
        'Battle-Scarred':'0.45–1.00',
      };
      const range = floatRanges[item.wear];
      return { label: item.wear + (range ? `  ·  float ${range}` : '') };
    },
  },
  {
    id: 'rarity',
    title: 'Rarity & Supply',
    icon: '💎',
    description:
      'Prices reflect the probability of obtaining a skin from cases or operations. ' +
      'Limited edition items (e.g., Souvenir skins from Major tournaments) or those from closed ' +
      'operations (e.g., AWP Gungnir) have fixed, shrinking supplies, driving up value as demand exceeds availability.',
    getItemData(item) {
      if (!item.rarity) return null;
      const souvenir = item.market_hash_name.startsWith('Souvenir ');
      return {
        label: item.rarity + (souvenir ? '  ·  Souvenir' : ''),
        color: item.rarity_color || null,
      };
    },
  },
  {
    id: 'pattern',
    title: 'Pattern Index',
    icon: '🎨',
    description:
      'For skins with geometric or abstract designs (like AK-47 Case Hardened or Fade), the specific ' +
      'pattern index determines visual appeal. Rare patterns, such as the Blue Gem on Case Hardened, ' +
      'can multiply the skin\'s value significantly.',
    getItemData(item) {
      const PATTERN_SKINS = [
        'Case Hardened', 'Fade', 'Doppler', 'Marble Fade',
        'Tiger Tooth', 'Lore', 'Gamma Doppler', 'Autotronic',
        'Freehand', 'Damascus Steel', 'Rust Coat',
      ];
      if (!PATTERN_SKINS.some(p => item.market_hash_name.includes(p))) return null;
      return { label: 'Pattern-dependent  ·  exact index requires inspect link' };
    },
  },
  {
    id: 'special',
    title: 'Special Features',
    icon: '✨',
    description:
      'Skins with StatTrak™ counters (showing kill counts) or attached stickers ' +
      '(especially rare tournament stickers) often sell for premiums. The presence of high-value ' +
      'stickers can drastically increase worth for collectors.',
    getItemData(item) {
      const statTrak = item.market_hash_name.includes('StatTrak™');
      const souvenir = item.market_hash_name.startsWith('Souvenir ');
      if (!statTrak && !souvenir) return null;
      const parts = [];
      if (statTrak) parts.push('StatTrak™');
      if (souvenir) parts.push('Souvenir');
      return { label: parts.join('  +  ') };
    },
  },
  {
    id: 'demand',
    title: 'Market Demand & Popularity',
    icon: '📈',
    description:
      'Subjective factors like community trends, pro-player usage, and design aesthetics drive demand. ' +
      'Skins that become status symbols or are tied to iconic moments often see price spikes ' +
      'regardless of their base rarity.',
    getItemData(_item) { return null; },
  },
];
