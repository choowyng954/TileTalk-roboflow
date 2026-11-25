// TileScan: the tile recognition model's class names, turned into the app's tile codes
// (see game/tiles.ts).
//
// The model is Roboflow's "mahjong-baq4s" (version 83), with 42 classes:
// - Suited tiles: 1-9 then B bamboo, C characters or D dots ("9D" is the 9 of dots).
// - Flowers and seasons: 1-4 then F or S ("2F" is flower 2).
// - Winds: E, S, W or N then W ("EW" is the East wind).
// - Dragons: R, G or W then D ("WD" is the White dragon).
// A label not listed here is shown as unknown in the review, never guessed.

const SUITS: Record<string, string> = { B: 'sou', C: 'man', D: 'pin' };
const BONUS: Record<string, string> = { F: 'flower', S: 'season' };
const HONOURS: Record<string, string> = {
  EW: 'east',
  SW: 'south',
  WW: 'west',
  NW: 'north',
  RD: 'red',
  GD: 'green',
  WD: 'white',
};

/** The tile code for one of the model's labels, or null when it isn't one the app knows. */
export function tileCodeForLabel(label: string): string | null {
  const key = label.trim().toUpperCase();
  const suited = /^([1-9])([BCD])$/.exec(key);
  if (suited) return `${SUITS[suited[2]]}${suited[1]}`;
  const bonus = /^([1-4])([FS])$/.exec(key);
  if (bonus) return `${BONUS[bonus[2]]}${bonus[1]}`;
  return HONOURS[key] ?? null;
}
