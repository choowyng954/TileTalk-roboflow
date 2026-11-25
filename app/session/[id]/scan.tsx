// TileScan: take a photo of a hand of tiles (or choose one), cropped to a guide frame and shrunk
// ready to be read. Reading the tiles comes next; for now this shows the prepared photo.

import React, { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Protected } from '../../../src/auth';
import { frameIn, photoCropFor, Size } from '../../../src/tileScan/frame';
import { PreparedPhoto, preparePhoto } from '../../../src/tileScan/preparePhoto';
import { radius, themedStyles } from '../../../src/theme';
import { Button, Card, ErrorText, Loading, Muted, Row, Screen } from '../../../src/ui';

export default function TileScanPage() {
  return (
    <Protected>
      <TileScanScreen />
    </Protected>
  );
}

function TileScanScreen() {
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prepare = async (take: () => Promise<{ uri: string; size: Size; crop?: ReturnType<typeof photoCropFor> } | null>) => {
    setBusy(true);
    setError(null);
    try {
      const shot = await take();
      if (shot) setPhoto(await preparePhoto(shot.uri, shot.size, shot.crop));
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
  onCapture: (take: () => Promise<{ uri: string; size: Size; crop: ReturnType<typeof photoCropFor> } | null>) => void;
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
      return { uri: shot.uri, size, crop: photoCropFor(view, frame, size) };
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
  return (
    <Screen>
      <Text style={styles.heading}>Your photo</Text>
      <Image source={{ uri: photo.uri }} style={[styles.preview, { aspectRatio: photo.width / photo.height }]} resizeMode="contain" />
      <Card>
        <Muted>
          {photo.width} × {photo.height} pixels, {Math.round(photo.bytes / 1024)} KB, ready in {(photo.ms / 1000).toFixed(1)} s.
        </Muted>
        <Muted>
          Taken at {photo.original.width} × {photo.original.height}. Check that every tile is in the picture and easy to make out.
        </Muted>
        <Muted>Reading the tiles in this photo is the next step of TileScan, still to come.</Muted>
      </Card>
      <Row>
        <Button title="Retake" onPress={onRetake} style={styles.grow} />
        <Button title="Gallery" variant="secondary" onPress={onPick} loading={busy} style={styles.grow} />
      </Row>
      <ErrorText message={error} />
    </Screen>
  );
}

const useStyles = themedStyles((colors) => ({
  stage: { flex: 1, backgroundColor: colors.background },
  cameraBox: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { position: 'absolute', borderWidth: 2, borderColor: colors.highlight, borderRadius: radius.tile },
  controls: { padding: 16, gap: 12 },
  grow: { flex: 1 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  preview: { width: '100%', borderRadius: radius.control, backgroundColor: colors.surfaceDeep },
}));
