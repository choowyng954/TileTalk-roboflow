"""Builds tilescan_training.ipynb, the Google Colab notebook that trains TileScan's on-device model.

The notebook is generated from this file so its code can be reviewed and tested as plain Python.
Run `python training/make_notebook.py` after changing it.
"""

import json
from pathlib import Path

YOLOX_COMMIT = "6ddff4824372906469a7fae2dc3206c7aa4bbaee"  # YOLOX main, June 2025
YOLOX_TINY_WEIGHTS = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.pth"

cells = []


def md(text):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": text.strip("\n")})


def code(text):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": text.strip("\n")})


md(
    """
# TileScan: train the on-device tile reader

This notebook trains a **YOLOX-Tiny** model (Apache 2.0) to find and name mahjong tiles in a photo, then
exports it as an ONNX file that TileTalk runs in the phone's browser.

It uses the **Mahjong dataset by jon-chan-gnsoa** on Roboflow Universe
(https://universe.roboflow.com/jon-chan-gnsoa/mahjong-baq4s), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

**Before you start:** *Runtime → Change runtime type → T4 GPU → Save.*

Then run each cell in order with the ▶ button (or *Runtime → Run all*). Training takes about
2–4 hours. Results are saved in a **TileScan** folder on your Google Drive (it writes only there, and deletes
nothing), so if Colab disconnects you can run the cells again and training carries on where it
stopped. To keep your Drive out of it, set `USE_DRIVE = False` in step 1.
"""
)

md("## 1. Settings")
code(
    """
EPOCHS = 60   # Passes over all the photos. 60 takes about 2-4 hours on a free T4 GPU.
BATCH = 32    # Photos per training step. Lower to 16 if you see "CUDA out of memory".
DATASET = ('jon-chan-gnsoa', 'mahjong-baq4s', 83)  # Roboflow workspace, project, version

# Google Drive keeps the results and lets training carry on after a disconnect. The notebook only
# writes inside a "TileScan" folder there, and deletes nothing. Set this to False to keep everything
# in Colab instead: nothing touches your Drive, but a disconnect means starting training again.
USE_DRIVE = True

WORK = '/content'                          # Colab's scratch space (wiped when Colab disconnects)
DATA = f'{WORK}/roboflow'                  # Where the dataset is unpacked
OUT = '/content/drive/MyDrive/TileScan' if USE_DRIVE else f'{WORK}/TileScan'

import os
# Newer PyTorch refuses some older checkpoint files unless told they're trusted. YOLOX's are.
os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] = '1'
os.environ['PYTHONPATH'] = f'{WORK}/YOLOX'

# The model's 42 tiles, in the order TileTalk expects (see src/tileScan/labels.ts).
CLASSES = ([f'{n}{s}' for s in 'BCD' for n in range(1, 10)]
           + [f'{n}{s}' for s in 'FS' for n in range(1, 5)]
           + ['EW', 'SW', 'WW', 'NW', 'RD', 'GD', 'WD'])
assert len(CLASSES) == 42
"""
)

md(
    """
## 2. Check the GPU and connect Google Drive
If this says there's no GPU, change the runtime type (see the top) and run it again.

With `USE_DRIVE = True`, Google asks you to allow access to your Drive (it may call it "Google Drive
for desktop": that's how Colab connects). The access lasts while this Colab session runs. To remove
it afterwards: Google Account → Security → Your connections to third-party apps & services.
"""
)
code(
    """
import shutil, subprocess
if shutil.which('nvidia-smi'):
    print(subprocess.run(['nvidia-smi', '-L'], capture_output=True, text=True).stdout.strip())
else:
    print('No GPU. Training (step 7) and scoring (step 8) need one: Runtime > Change runtime type > T4 GPU,'
          ' then run from step 1 again. Exporting and checking (steps 9 to 11) work without one.')

if USE_DRIVE:
    from google.colab import drive
    drive.mount('/content/drive')
os.makedirs(OUT, exist_ok=True)
print('Saving to', OUT)
"""
)

md("## 3. Install YOLOX")
code(
    f"""
!test -d {{WORK}}/YOLOX || git clone -q https://github.com/Megvii-BaseDetection/YOLOX.git {{WORK}}/YOLOX
!cd {{WORK}}/YOLOX && git checkout -q {YOLOX_COMMIT}
!pip install -q loguru thop ninja tabulate pycocotools onnx onnxruntime roboflow
!test -f {{WORK}}/yolox_tiny.pth || wget -q {YOLOX_TINY_WEIGHTS} -O {{WORK}}/yolox_tiny.pth
print('YOLOX ready')
"""
)

md(
    """
## 4. Download the dataset
Paste your Roboflow **Private API key** when asked (Roboflow → Settings → API Keys). It isn't saved in
the notebook. The download is about 7,600 photos and takes a few minutes.
"""
)
code(
    """
if not os.path.exists(f'{DATA}/train/_annotations.coco.json'):
    from getpass import getpass
    from roboflow import Roboflow
    workspace, project, version = DATASET
    rf = Roboflow(api_key=getpass('Roboflow Private API key: '))
    rf.workspace(workspace).project(project).version(version).download('coco', location=DATA, overwrite=True)
print(sorted(os.listdir(DATA)))
"""
)

md(
    """
## 5. Prepare the labels
Puts the 42 tiles in TileTalk's order and checks every photo is there. It stops with a message if the
dataset has a tile name it doesn't expect.
"""
)
PREPARE = """
import json, collections

def prepare_split(split):
    src = f'{DATA}/{split}/_annotations.coco.json'
    if not os.path.exists(src):
        return None
    coco = json.load(open(src))
    name_of = {c['id']: c['name'].strip().upper() for c in coco['categories']}
    new_id = {name: i + 1 for i, name in enumerate(CLASSES)}
    anns, unknown = [], collections.Counter()
    for a in coco['annotations']:
        name = name_of.get(a['category_id'])
        if name in new_id:
            anns.append({**a, 'category_id': new_id[name]})
        else:
            unknown[name] += 1
    if unknown:
        raise ValueError(f'{split}: tiles with names TileTalk doesn’t know: {dict(unknown)}. Send this message to Claude.')
    missing = [im['file_name'] for im in coco['images'] if not os.path.exists(f'{DATA}/{split}/{im["file_name"]}')]
    if missing:
        raise FileNotFoundError(f'{split}: {len(missing)} photos are missing, e.g. {missing[:3]}')
    coco['annotations'] = anns
    # Roboflow adds an extra "group" category with no tiles in it; only the 42 tiles are kept.
    coco['categories'] = [{'id': i + 1, 'name': n, 'supercategory': 'tiles'} for i, n in enumerate(CLASSES)]
    os.makedirs(f'{DATA}/annotations', exist_ok=True)
    json.dump(coco, open(f'{DATA}/annotations/{split}.json', 'w'))
    print(f'{split}: {len(coco["images"])} photos, {len(anns)} tiles')
    return collections.Counter(CLASSES[a['category_id'] - 1] for a in anns)

counts = {split: prepare_split(split) for split in ['train', 'valid', 'test']}
assert counts['train'] and counts['valid'], 'The dataset needs train and valid photos.'
print('Tiles of each kind in the training photos:')
print(' '.join(f'{c}:{counts["train"][c]}' for c in CLASSES))
rare = [c for c in CLASSES if counts['train'][c] < 100]
if rare:
    print('Not many examples of:', rare, '(these may be read less reliably)')
"""
code(PREPARE)

md(
    """
## 6. Training settings
YOLOX-Tiny, reading 640 × 640 photos, as TileScan sends. Photos are never mirrored while training:
real tiles are never seen mirrored, and mirroring turns characters and numbers into nonsense.
"""
)
EXP = '''
EXP = f'{WORK}/tilescan_exp.py'
with open(EXP, 'w') as f:
    f.write(f"""
from yolox.data import COCODataset, TrainTransform, ValTransform
from yolox.exp import Exp as BaseExp


class Exp(BaseExp):
    def __init__(self):
        super().__init__()
        self.depth, self.width = 0.33, 0.375   # YOLOX-Tiny
        self.num_classes = 42
        self.input_size = (640, 640)
        self.test_size = (640, 640)
        self.mosaic_scale = (0.5, 1.5)
        self.enable_mixup = False
        self.flip_prob = 0.0
        self.data_dir = {DATA!r}
        self.train_ann, self.val_ann, self.test_ann = 'train.json', 'valid.json', 'test.json'
        self.max_epoch = {EPOCHS}
        self.warmup_epochs = 3
        self.no_aug_epochs = {min(10, max(1, EPOCHS // 4))}
        self.eval_interval = 5
        self.save_history_ckpt = False   # Keep only the latest and best (each is about 40 MB)
        self.data_num_workers = 2
        self.output_dir = {OUT!r}
        self.exp_name = 'tilescan_yolox_tiny'

    # The dataset's photos are in train/, valid/ and test/ (YOLOX expects COCO's own folder names).
    def get_dataset(self, cache=False, cache_type='ram'):
        return COCODataset(
            data_dir=self.data_dir, json_file=self.train_ann, name='train', img_size=self.input_size,
            # A photo of a whole table can hold over 100 tiles.
            preproc=TrainTransform(max_labels=200, flip_prob=self.flip_prob, hsv_prob=self.hsv_prob),
            cache=cache, cache_type=cache_type,
        )

    def get_eval_dataset(self, **kwargs):
        testdev = kwargs.get('testdev', False)
        return COCODataset(
            data_dir=self.data_dir, json_file=self.test_ann if testdev else self.val_ann,
            name='test' if testdev else 'valid', img_size=self.test_size,
            preproc=ValTransform(legacy=kwargs.get('legacy', False)),
        )
""")
RUN_DIR = f'{OUT}/tilescan_yolox_tiny'
print('Settings written to', EXP)
'''
code(EXP)

md(
    """
## 7. Train
About 2–4 hours. It prints progress as it goes, and checks itself on the valid photos every 5 epochs
(look for **AP50**: the share of tiles found and named correctly, out of 1.00).

If Colab disconnects, reconnect, run cells 1 to 6 again, then this one: with `USE_DRIVE = True` it
carries on from the last saved epoch (without Drive, it starts again).
"""
)
code(
    """
latest = f'{RUN_DIR}/latest_ckpt.pth'
if os.path.exists(latest):
    print('Carrying on from', latest)
    start = f'--resume -c {latest}'
else:
    start = f'-c {WORK}/yolox_tiny.pth'   # Start from YOLOX-Tiny trained on everyday objects
!cd {WORK}/YOLOX && python tools/train.py -f {EXP} -d 1 -b {BATCH} --fp16 {start}
"""
)

md("## 8. Score it on the test photos\nThese photos weren't used for training. The **AP50** line is the headline number.")
code(
    """
test_flag = '--test' if os.path.exists(f'{DATA}/annotations/test.json') else ''
!cd {WORK}/YOLOX && python tools/eval.py -f {EXP} -c {RUN_DIR}/best_ckpt.pth -b 16 -d 1 --conf 0.001 --fp16 {test_flag}
"""
)

md("## 9. Export for the browser\nMakes `tilescan_yolox_tiny.onnx` (the model) and `tilescan_model.json` (its labels and settings).")
# YOLOX's own tools/export_onnx.py uses torch.onnx._export, which newer PyTorch no longer has, so
# the export is done here with the same steps.
EXPORT = """
import sys, importlib.util, torch
from torch import nn
sys.path.insert(0, f'{WORK}/YOLOX')
from yolox.models.network_blocks import SiLU
from yolox.utils import replace_module

spec = importlib.util.spec_from_file_location('tilescan_exp', EXP)
exp_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exp_module)
model = exp_module.Exp().get_model()
model.load_state_dict(torch.load(f'{RUN_DIR}/best_ckpt.pth', map_location='cpu')['model'])
model = replace_module(model, nn.SiLU, SiLU)   # The form of SiLU that exports cleanly
model.head.decode_in_inference = True          # Output boxes in pixels, ready to use
model.eval()

ONNX = f'{OUT}/tilescan_yolox_tiny.onnx'
torch.onnx.export(model, torch.zeros(1, 3, 640, 640), ONNX, input_names=['images'], output_names=['output'],
                  opset_version=17, dynamo=False)
with open(f'{OUT}/tilescan_model.json', 'w') as f:
    json.dump({
        'model': 'tilescan_yolox_tiny.onnx',
        'inputSize': 640,
        'input': 'images: float32 [1, 3, 640, 640], BGR, 0-255 (not scaled); pad to square with 114',
        'output': 'output: [1, N, 5 + 42] = centre x, centre y, width, height (pixels at 640), tile score, then a score per class',
        'classes': CLASSES,
        'dataset': 'Mahjong by jon-chan-gnsoa, Roboflow Universe, CC BY 4.0, version %d' % DATASET[2],
    }, f, indent=2)
print('Saved', ONNX, f'({os.path.getsize(ONNX) / 1e6:.1f} MB)')
"""
code(EXPORT)

md(
    """
## 10. Check it like TileScan would
Runs the exported model on the test photos the way the app will, and counts tiles found, named
correctly, missed, and found where there wasn't one. Shows a few photos with what it read.
"""
)
CHECK = """
import cv2, numpy as np, onnxruntime as ort

session = ort.InferenceSession(ONNX)
INPUT = session.get_inputs()[0].name

def read_tiles(path, min_score=0.25, overlap=0.45):
    \"\"\"[(label, score, [x, y, w, h])] for one photo, as TileScan will read it.\"\"\"
    img = cv2.imread(path)  # BGR, which the model expects
    h, w = img.shape[:2]
    r = min(640 / h, 640 / w)
    square = np.full((640, 640, 3), 114, np.uint8)
    square[:round(h * r), :round(w * r)] = cv2.resize(img, (round(w * r), round(h * r)))
    out = session.run(None, {INPUT: square.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    scores = out[:, 4:5] * out[:, 5:]
    best, label = scores.max(1), scores.argmax(1)
    keep = best >= min_score
    cx, cy, bw, bh = (out[keep, :4] / r).T
    boxes = np.stack([cx - bw / 2, cy - bh / 2, bw, bh], 1)
    # Tiles don't overlap, so one box per spot, whatever it's labelled.
    picked = np.array(cv2.dnn.NMSBoxes(boxes.tolist(), best[keep].tolist(), min_score, overlap)).flatten()
    return [(CLASSES[label[keep][i]], float(best[keep][i]), boxes[i]) for i in picked]

def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)

def check(split='test', limit=None):
    coco = json.load(open(f'{DATA}/annotations/{split}.json'))
    truth = collections.defaultdict(list)
    for a in coco['annotations']:
        truth[a['image_id']].append((CLASSES[a['category_id'] - 1], a['bbox']))
    right = wrong = missed = extra = 0
    mixups = collections.Counter()
    for im in coco['images'][:limit]:
        found = read_tiles(f'{DATA}/{split}/{im["file_name"]}')
        unmatched = list(found)
        for label, box in truth[im['id']]:
            match = max(unmatched, key=lambda f: iou(f[2], box), default=None)
            if match is None or iou(match[2], box) < 0.5:
                missed += 1
                continue
            unmatched.remove(match)
            if match[0] == label:
                right += 1
            else:
                wrong += 1
                mixups[f'{label} read as {match[0]}'] += 1
        extra += len(unmatched)
    total = right + wrong + missed
    print(f'{split}: {total} tiles. Named right {right / max(total, 1):.1%}, named wrong {wrong / max(total, 1):.1%}, '
          f'missed {missed / max(total, 1):.1%}. Extra (no tile there): {extra}.')
    if mixups:
        print('Most common mix-ups:', ', '.join(f'{k} ({v})' for k, v in mixups.most_common(8)))

check('test' if counts['test'] else 'valid')
"""
code(CHECK)
code(
    """
import matplotlib.pyplot as plt
split = 'test' if counts['test'] else 'valid'
names = sorted(os.listdir(f'{DATA}/{split}'))
for name in [n for n in names if n.lower().endswith(('.jpg', '.jpeg', '.png'))][:3]:
    img = cv2.imread(f'{DATA}/{split}/{name}')
    for label, score, (x, y, w, h) in read_tiles(f'{DATA}/{split}/{name}'):
        cv2.rectangle(img, (int(x), int(y)), (int(x + w), int(y + h)), (0, 200, 0), 2)
        cv2.putText(img, f'{label} {score:.0%}', (int(x), int(y) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    plt.figure(figsize=(12, 8)); plt.imshow(img[:, :, ::-1]); plt.axis('off'); plt.show()
"""
)

md(
    """
## 11. Download the model
Downloads the two files (they're also in your Google Drive, in the TileScan folder). Send Claude
the numbers from steps 8 and 10, and keep the two files for adding to TileTalk.
"""
)
code(
    """
from google.colab import files
files.download(ONNX)
files.download(f'{OUT}/tilescan_model.json')
"""
)

notebook = {
    "cells": cells,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"provenance": [], "gpuType": "T4"},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 0,
}

out = Path(__file__).with_name("tilescan_training.ipynb")
out.write_text(json.dumps(notebook, indent=1, ensure_ascii=False) + "\n")
print(f"Wrote {out} ({len(cells)} cells)")
