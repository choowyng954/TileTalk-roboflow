import { scannedHandFrom, sendScannedHand, takeScannedHand } from '../handoff';
import { Detection, readDetections } from '../readDetections';

const row = (tiles: [string, number][]): Detection[] =>
  tiles.map(([label, confidence], i) => ({ label, confidence, x: 50 + i * 42, y: 100, width: 40, height: 56 }));

describe('scannedHandFrom', () => {
  test('lays out the tiles, and lists unsure ones to check', () => {
    const scan = readDetections(row([['1D', 0.9], ['2D', 0.45], ['3D', 0.88], ['1F', 0.5]]));
    expect(scannedHandFrom(scan)).toEqual({
      tiles: ['pin1', 'pin2', 'pin3'],
      flowers: ['flower1'],
      toCheck: ['2 of Dots (45% sure)', 'Plum (flower 1) (50% sure)'],
      leftOut: [],
    });
  });

  test('leaves out unknown labels and a copy too many, and says so', () => {
    const scan = readDetections(row([['5B', 0.9], ['5B', 0.9], ['5B', 0.9], ['5B', 0.9], ['5B', 0.3], ['XX', 0.9]]));
    const hand = scannedHandFrom(scan);
    expect(hand.tiles).toEqual(['sou5', 'sou5', 'sou5', 'sou5']);
    expect(hand.leftOut).toEqual(['a 5th 5 of Bamboo', 'an unknown tile (“XX”)']);
    // The 5th copy is the unsure one, but it's left out, so not also listed to check.
    expect(hand.toCheck).toEqual([]);
  });
});

describe('sending a scanned hand back', () => {
  test('is picked up once, by the same game', () => {
    const hand = { tiles: ['man1'], flowers: [], toCheck: [], leftOut: [] };
    sendScannedHand('game1', hand);
    expect(takeScannedHand('game2')).toBeUndefined();
    expect(takeScannedHand('game1')).toEqual(hand);
    expect(takeScannedHand('game1')).toBeUndefined();
  });
});
