// TileScan: take a photo of a hand of tiles (or choose one), cropped to a guide frame and shrunk
// ready to be read, then read by the scanTiles Cloud Function and laid out on the Record hand screen.

import React, { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Protected } from '../../../src/auth';
import { TileImage } from '../../../src/components/TileArt';
import { tileName } from '../../../src/game/tiles';
import { frameIn, Rect, scanCropFor, Size } from '../../../src/tileScan/frame';
import { scannedHandFrom, sendScannedHand } from '../../../src/tileScan/handoff';
import { PreparedPhoto, preparePhoto } from '../../../src/tileScan/preparePhoto';
import type { ScannedTile, TileFlag } from '../../../src/tileScan/readDetections';
import { PhotoReading, readTilesInPhoto } from '../../../src/tileScan/readPhoto';
import { radius, themedStyles } from '../../../src/theme';
import { Button, Card, ErrorText, Loading, Muted, Row, Screen } from '../../../src/ui';

export default function TileScanPage() {
  return (
    <Protected>
      <TileScanScreen />
    </Protected>
  );
}

/** A photo just taken or chosen. Camera photos are cropped around the guide frame, which is `focus`. */
interface Shot {
  uri: string;
  size: Size;
  crop?: Rect;
  focus?: Rect;
}

function TileScanScreen() {
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prepare = async (take: () => Promise<Shot | null>) => {
    setBusy(true);
    setError(null);
    try {
      const shot = await take();
      if (shot) setPhoto(await preparePhoto(shot.uri, shot.size, shot.crop, shot.focus));
    } catch (e) {
      setError(`Couldn’t get the photo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pickFromGallery = () =>
    prepare(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets[0]) return null;
      const asset = result.assets[0];
      return { uri: asset.uri, size: { width: asset.width, height: asset.height } };
    });

  if (photo) return <PhotoPreview photo={photo} onRetake={() => setPhoto(null)} onPick={pickFromGallery} busy={busy} error={error} />;
  return <CameraStage onCapture={prepare} onPick={pickFromGallery} busy={busy} error={error} />;
}

function CameraStage({
  onCapture,
  onPick,
  busy,
  error,
}: {
  onCapture: (take: () => Promise<Shot | null>) => void;
  onPick: () => void;
  busy: boolean;
  error: string | null;
}) {
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [view, setView] = useState<Size | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  if (!permission) return <Loading />;

  const gallery = <Button title="Choose from gallery" variant="secondary" onPress={onPick} loading={busy} />;
  if (!permission.granted || cameraError) {
    return (
      <Screen>
        <Card>
          <Text style={styles.heading}>Scan your tiles</Text>
          <Muted>
            {cameraError
              ? `The camera didn’t start (${cameraError}). You can choose a photo instead.`
              : permission.canAskAgain
                ? 'TileScan needs your camera to photograph your tiles. The photo is only used to read them.'
                : 'Camera access is turned off for TileTalk. Turn it on in your settings, or choose a photo instead.'}
          </Muted>
          {!cameraError && permission.canAskAgain ? <Button title="Allow camera" onPress={requestPermission} /> : null}
          {gallery}
        </Card>
        <ErrorText message={error} />
      </Screen>
    );
  }

  const frame = view ? frameIn(view) : null;
  const take = () =>
    onCapture(async () => {
      if (!camera.current || !view || !frame) return null;
      const shot = await camera.current.takePictureAsync({ quality: 0.9 });
      const size = { width: shot.width, height: shot.height };
      return { uri: shot.uri, size, ...scanCropFor(view, frame, size) };
    });

  return (
    <View style={styles.stage}>
      <View style={styles.cameraBox} onLayout={(e) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        <CameraView
          ref={camera}
          style={styles.fill}
          facing="back"
          onCameraReady={() => setReady(true)}
          onMountError={(e) => setCameraError(e.message)}
        />
        {frame ? (
          // Darkens everything outside the frame, which is cropped away.
          <View pointerEvents="none" style={styles.fill}>
            <View style={[styles.shade, { left: 0, right: 0, top: 0, height: frame.y }]} />
            <View style={[styles.shade, { left: 0, right: 0, top: frame.y + frame.height, bottom: 0 }]} />
            <View style={[styles.shade, { left: 0, width: frame.x, top: frame.y, height: frame.height }]} />
            <View style={[styles.shade, { left: frame.x + frame.width, right: 0, top: frame.y, height: frame.height }]} />
            <View style={[styles.frame, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.controls}>
        <Muted>Line your tiles up inside the box, flowers too. Keep other tiles out of it.</Muted>
        <Row>
          <Button title="Take photo" onPress={take} disabled={!ready} loading={busy} style={styles.grow} />
          <Button title="Gallery" variant="secondary" onPress={onPick} disabled={busy} style={styles.grow} />
        </Row>
        <ErrorText message={error} />
      </View>
    </View>
  );
}

function PhotoPreview({
  photo,
  onRetake,
  onPick,
  busy,
  error,
}: {
  photo: PreparedPhoto;
  onRetake: () => void;
  onPick: () => void;
  busy: boolean;
  error: string | null;
}) {
  const styles = useStyles();
  const [reading, setReading] = useState<PhotoReading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // Every read of this photo, to compare times: the first is often slower while the server starts.
  const [times, setTimes] = useState<number[]>([]);

  const read = async () => {
    setScanning(true);
    setReadError(null);
    try {
      const result = await readTilesInPhoto(photo.base64, photo.focus);
      setReading(result);
      setTimes((t) => [...t, result.ms.total]);
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.heading}>Your photo</Text>
      <View style={[styles.preview, { aspectRatio: photo.width / photo.height }]}>
        <Image source={{ uri: photo.uri }} style={styles.fill} resizeMode="contain" />
        {photo.focus ? <FocusShade focus={photo.focus} photo={photo} /> : null}
      </View>
      <Muted>
        {photo.width} × {photo.height} pixels, {Math.round(photo.bytes / 1024)} KB, ready in {(photo.ms / 1000).toFixed(1)} s. Taken at{' '}
        {photo.original.width} × {photo.original.height}.
      </Muted>
      <Button title={reading ? 'Read again' : 'Read tiles'} onPress={read} loading={scanning} />
      <ErrorText message={readError} />
      {reading ? <ScanResult reading={reading} times={times} /> : null}
      <Row>
        <Button title="Retake" variant="secondary" onPress={onRetake} style={styles.grow} />
        <Button title="Gallery" variant="secondary" onPress={onPick} loading={busy} style={styles.grow} />
      </Row>
      <ErrorText message={error} />
    </Screen>
  );
}

/** Darkens the photo outside the guide frame: tiles there aren't counted. */
function FocusShade({ focus, photo }: { focus: Rect; photo: Size }) {
  const styles = useStyles();
  const pct = (n: number, of: number) => `${(100 * n) / of}%` as const;
  const top = pct(focus.y, photo.height);
  const bottom = pct(photo.height - focus.y - focus.height, photo.height);
  return (
    <View pointerEvents="none" style={styles.fill}>
      <View style={[styles.shade, { left: 0, right: 0, top: 0, height: top }]} />
      <View style={[styles.shade, { left: 0, right: 0, bottom: 0, height: bottom }]} />
      <View style={[styles.shade, { left: 0, width: pct(focus.x, photo.width), top, bottom }]} />
      <View style={[styles.shade, { right: 0, width: pct(photo.width - focus.x - focus.width, photo.width), top, bottom }]} />
    </View>
  );
}

const SCAN_TILE = 34;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** What the model found: the tiles in reading order, anything to check highlighted, and timings. */
function ScanResult({ reading, times }: { reading: PhotoReading; times: number[] }) {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scan, ms } = reading;
  const toCheck = [...scan.tiles, ...scan.flowers].filter((t) => t.flags.length > 0);
  // Back to Record hand, which picks the tiles up (see takeScannedHand there).
  const layOutTiles = () => {
    sendScannedHand(id, scannedHandFrom(scan));
    router.back();
  };
  const tile = (t: ScannedTile, i: number) => (
    <View key={i} style={[styles.scanTile, t.flags.length > 0 && styles.scanTileFlagged]}>
      {t.code ? <TileImage code={t.code} width={SCAN_TILE} /> : <Text style={styles.unknown}>?</Text>}
      <Text style={styles.scanConfidence}>{Math.round(t.confidence * 100)}%</Text>
    </View>
  );
  return (
    <Card>
      <Text style={styles.heading}>
        {scan.tiles.length} {scan.tiles.length === 1 ? 'tile' : 'tiles'}
        {scan.flowers.length ? ` and ${scan.flowers.length} ${scan.flowers.length === 1 ? 'flower' : 'flowers'}` : ''}
        {scan.rowCount > 1 ? ` in ${scan.rowCount} rows` : ''}
      </Text>
      {scan.tiles.length + scan.flowers.length === 0 ? <Muted>No tiles found. Try a closer, brighter photo.</Muted> : null}
      {scan.ignored ? (
        <Muted>
          {scan.ignored} {scan.ignored === 1 ? 'tile' : 'tiles'} outside the box ignored.
        </Muted>
      ) : null}
      <View style={styles.scanRow}>{scan.tiles.map(tile)}</View>
      {scan.flowers.length ? <View style={styles.scanRow}>{scan.flowers.map(tile)}</View> : null}
      {toCheck.length ? (
        <Muted>
          {toCheck.length} to check (outlined):{' '}
          {toCheck
            .map((t) => `${t.code ? tileName(t.code) : `“${t.label}”`} (${t.flags.map((f) => FLAG_NAMES[f]).join(', ')})`)
            .join('; ')}
          .
        </Muted>
      ) : null}
      <Muted>
        Read in {seconds(ms.total)}: {seconds(ms.roboflow)} at Roboflow, {seconds(ms.server - ms.roboflow)} on the server,{' '}
        {seconds(ms.total - ms.server)} sending and receiving.
        {times.length > 1 ? ` Every read so far: ${times.map(seconds).join(', ')}.` : ''}
      </Muted>
      <Button title="Use these tiles" onPress={layOutTiles} disabled={scan.tiles.length + scan.flowers.length === 0} />
      <Muted>They’re laid out in the tile calculator, replacing any there, for you to check before saving.</Muted>
    </Card>
  );
}

const FLAG_NAMES: Record<TileFlag, string> = { unsure: 'unsure', unknown: 'unknown label', tooMany: 'one too many' };

const useStyles = themedStyles((colors) => ({
  stage: { flex: 1, backgroundColor: colors.background },
  cameraBox: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { position: 'absolute', borderWidth: 2, borderColor: colors.highlight, borderRadius: radius.tile },
  controls: { padding: 16, gap: 12 },
  grow: { flex: 1 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  preview: { width: '100%', borderRadius: radius.control, backgroundColor: colors.surfaceDeep, overflow: 'hidden' },
  scanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  scanTile: { alignItems: 'center', padding: 2, borderRadius: radius.tile, borderWidth: 2, borderColor: 'transparent' },
  scanTileFlagged: { borderColor: colors.warning },
  scanConfidence: { color: colors.textMuted, fontSize: 10 },
  unknown: { width: SCAN_TILE, height: SCAN_TILE * 1.33, textAlign: 'center', textAlignVertical: 'center', color: colors.warning, fontSize: 20, fontWeight: '700' },
}));
