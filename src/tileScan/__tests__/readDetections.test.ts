import { readTiles } from '../../scoring/tileHand';
import { houseRules } from '../../scoring/rulesets/houseRules';
import { tileCodeForLabel } from '../labels';
import { Detection, readDetections, scanToHand } from '../readDetections';

const W = 40;
const H = 56;
/** Tiles side by side in one row, as the model would report them. */
const row = (labels: string[], y = 100, confidence = 0.9, startX = 50): Detection[] =>
  labels.map((label, i) => ({ label, confidence, x: startX + i * (W + 2), y, width: W, height: H }));
const codes = (tiles: { code: string | null }[]) => tiles.map((t) => t.code);

describe('tileCodeForLabel', () => {
  test('suited tiles: number then B bamboo, C characters, D dots', () => {
    expect(tileCodeForLabel('9D')).toBe('pin9');
    expect(tileCodeForLabel('1C')).toBe('man1');
    expect(tileCodeForLabel('1B')).toBe('sou1');
    expect(tileCodeForLabel(' 5 b ')).toBe('sou5');
  });

  test('flowers and seasons', () => {
    expect(tileCodeForLabel('3F')).toBe('flower3');
    expect(tileCodeForLabel('2S')).toBe('season2');
    expect(tileCodeForLabel('5F')).toBeNull();
  });

  test('winds and dragons', () => {
    expect(tileCodeForLabel('EW')).toBe('east');
    expect(tileCodeForLabel('north')).toBe('north');
    expect(tileCodeForLabel('Red Dragon')).toBe('red');
    expect(tileCodeForLabel('WD')).toBe('white');
  });

  test("the app's own codes", () => {
    expect(tileCodeForLabel('man5')).toBe('man5');
    expect(tileCodeForLabel('season4')).toBe('season4');
  });

  test('anything else is unknown, never guessed', () => {
    // A lone S or W could be a wind or a season/white dragon.
    for (const label of ['S', 'W', '0B', '10D', 'joker', '']) expect(tileCodeForLabel(label)).toBeNull();
  });
});

describe('readDetections', () => {
  test('reads a row left to right, whatever order the model lists it in', () => {
    const scan = readDetections(row(['1C', '2C', '3C', '9D']).reverse());
    expect(codes(scan.tiles)).toEqual(['man1', 'man2', 'man3', 'pin9']);
    expect(scan.rowCount).toBe(1);
  });

  test('reads rows top to bottom', () => {
    const scan = readDetections([...row(['7B', '8B', '9B'], 300), ...row(['EW', 'EW', 'EW'], 100)]);
    expect(codes(scan.tiles)).toEqual(['east', 'east', 'east', 'sou7', 'sou8', 'sou9']);
    expect(scan.tiles.map((t) => t.row)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(scan.rowCount).toBe(2);
  });

  test('a photo taken at a slight angle is still one row', () => {
    // 14 tiles, each a little lower than the last (about 5 degrees).
    const tilted = row(Array(14).fill('5D')).map((d, i) => ({ ...d, label: `${(i % 9) + 1}D`, y: d.y + i * 3.7 }));
    expect(readDetections(tilted).rowCount).toBe(1);
  });

  test('the same tile read twice keeps the more confident reading, with the other as an alternative', () => {
    const [six] = row(['6D'], 100, 0.8);
    const scan = readDetections([six, { ...six, label: '8D', confidence: 0.5, x: six.x + 2 }, { ...six, confidence: 0.3 }]);
    expect(codes(scan.tiles)).toEqual(['pin6']);
    expect(scan.tiles[0].alternatives).toEqual([{ code: 'pin8', label: '8D', confidence: 0.5 }]);
  });

  test('flags unsure and unknown tiles', () => {
    const scan = readDetections([...row(['1B'], 100, 0.4), ...row(['joker'], 100, 0.95, 200)]);
    expect(scan.tiles.map((t) => t.flags)).toEqual([['unsure'], ['unknown']]);
    expect(scan.tiles[1].code).toBeNull();
  });

  test('flags the least confident copies beyond four', () => {
    const five = row(Array(5).fill('2C')).map((d, i) => ({ ...d, confidence: [0.9, 0.95, 0.7, 0.99, 0.92][i] }));
    const scan = readDetections(five);
    expect(scan.tiles.map((t) => t.flags.includes('tooMany'))).toEqual([false, false, true, false, false]);
    expect(scanToHand(scan).tiles).toHaveLength(4);
  });

  test('puts flowers and seasons apart from the hand', () => {
    const scan = readDetections(row(['1F', '1C', '3S', '2C']));
    expect(codes(scan.tiles)).toEqual(['man1', 'man2']);
    expect(codes(scan.flowers)).toEqual(['flower1', 'season3']);
  });

  test('ignores broken detections, and an empty photo has no tiles', () => {
    expect(readDetections([{ label: '1C', confidence: 0.9, x: NaN, y: 0, width: W, height: H }])).toEqual({ tiles: [], flowers: [], rowCount: 0 });
    expect(readDetections([])).toEqual({ tiles: [], flowers: [], rowCount: 0 });
  });
});

describe('scanToHand', () => {
  test('leaves out unknown tiles', () => {
    expect(scanToHand(readDetections(row(['1C', 'joker', '2C'])))).toEqual({ tiles: ['man1', 'man2'], flowers: [] });
  });

  test("gives tiles the app's own scoring reads, the same as tiles laid out by hand", () => {
    const photo = row(['1C', '2C', '3C', '4D', '5D', '6D', '7B', '8B', '9B', 'RD', 'RD', 'RD', 'NW', 'NW']).reverse();
    const hand = scanToHand(readDetections([...photo, ...row(['2F'], 300)]));
    expect(hand).toEqual({
      tiles: ['man1', 'man2', 'man3', 'pin4', 'pin5', 'pin6', 'sou7', 'sou8', 'sou9', 'red', 'red', 'red', 'north', 'north'],
      flowers: ['flower2'],
    });
    const reading = readTiles(houseRules, hand.tiles, hand.flowers, { seatWind: 1, prevailingWind: 0 });
    expect(reading.ok).toBe(true);
  });
});
