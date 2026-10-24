"""
objects.py - sees everyday things through the camera, all the time, on your PC (no internet, no AI model calls).

Uses OpenCV's small NanoDet model (3.8 MB, downloaded once into data/models). It knows 80 kinds of things
(the COCO list): person, cell phone, cup, bottle, laptop, book, keyboard, mouse, scissors, dog, cat...
About 20-40 ms per look on a normal CPU; the camera checks every ~2 seconds.
"""
import os

import numpy as np

from paths import data_file

MODEL = os.path.join(data_file("models"), "object_detection_nanodet_2022nov.onnx")
URL = ("https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
       "object_detection_nanodet/object_detection_nanodet_2022nov.onnx")
NAMES = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
         "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
         "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
         "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
         "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
         "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
         "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
         "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
         "teddy bear", "hair drier", "toothbrush"]
SIZE = 416
STRIDES = (8, 16, 32)
MEAN = np.array([103.53, 116.28, 123.675], np.float32)       # the model expects BGR (OpenCV's normal order)
STD = np.array([57.375, 57.12, 58.395], np.float32)
DISTRACTING = {"cell phone", "remote", "sports ball", "teddy bear"}   # during a focus session

_net = None
_anchors = None


def ensure_model():
    if os.path.exists(MODEL) and os.path.getsize(MODEL) > 1_000_000:
        return True
    import requests
    os.makedirs(os.path.dirname(MODEL), exist_ok=True)
    tmp = MODEL + ".part"
    try:
        with requests.get(URL, stream=True, timeout=30) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        os.replace(tmp, MODEL)
        return True
    except Exception as e:
        print(f"[objects] couldn't download the model: {e}")
        if os.path.exists(tmp):
            os.remove(tmp)
        return False


def _load():
    global _net, _anchors
    if _net is None:
        import cv2
        if not ensure_model():
            raise RuntimeError("The object model isn't downloaded yet (needs internet once).")
        _net = cv2.dnn.readNet(MODEL)
        _anchors = []
        for st in STRIDES:
            n = SIZE // st
            xv, yv = np.meshgrid(np.arange(n) * st, np.arange(n) * st)
            _anchors.append(np.column_stack([xv.ravel() + 0.5 * (st - 1), yv.ravel() + 0.5 * (st - 1)]))
    return _net


def detect(bgr, min_score=0.4, iou=0.6):
    """BGR picture (from OpenCV) -> [{"label", "score", "box": [x, y, w, h] as 0-1 of the picture}] best first."""
    import cv2
    net = _load()
    h, w = bgr.shape[:2]
    scale = SIZE / max(h, w)
    small = cv2.resize(bgr, (max(1, int(w * scale)), max(1, int(h * scale))))
    canvas = np.zeros((SIZE, SIZE, 3), np.uint8)
    canvas[:small.shape[0], :small.shape[1]] = small
    net.setInput(cv2.dnn.blobFromImage((canvas.astype(np.float32) - MEAN) / STD))
    outs = net.forward(net.getUnconnectedOutLayersNames())
    scores_all, boxes_all = [], []
    for stride, cls, reg, anchors in zip(STRIDES, outs[:3], outs[3:], _anchors):
        r = reg[0].reshape(-1, 8)
        e = np.exp(r - r.max(1, keepdims=True))
        dist = ((e / e.sum(1, keepdims=True)) @ np.arange(8)).reshape(-1, 4) * stride
        boxes_all.append(np.column_stack([anchors[:, 0] - dist[:, 0], anchors[:, 1] - dist[:, 1],
                                          anchors[:, 0] + dist[:, 2], anchors[:, 1] + dist[:, 3]]))
        scores_all.append(cls[0])
    boxes = np.concatenate(boxes_all) / scale
    scores = np.concatenate(scores_all)
    ids, conf = scores.argmax(1), scores.max(1)
    xywh = boxes.copy()
    xywh[:, 2:] -= xywh[:, :2]
    keep = cv2.dnn.NMSBoxes(xywh.tolist(), conf.tolist(), min_score, iou)
    out = []
    for i in np.array(keep).ravel():
        x, y, bw, bh = xywh[i]
        out.append({"label": NAMES[ids[i]], "score": round(float(conf[i]), 2),
                    "box": [round(max(0, x) / w, 3), round(max(0, y) / h, 3), round(bw / w, 3), round(bh / h, 3)]})
    return sorted(out, key=lambda d: -d["score"])


def summary(items):
    """[{label...}] -> 'a cup, 2 people and a cell phone'"""
    from collections import Counter
    counts = Counter(i["label"] for i in items)
    plural = {"person": "people", "knife": "knives", "mouse": "mice", "couch": "couches", "bus": "buses",
              "glass": "glasses", "dining table": "tables"}
    parts = [f"{n} {plural.get(k, k + 's')}" if n > 1 else f"{'an' if k[0] in 'aeiou' else 'a'} {k}" for k, n in counts.most_common()]
    return ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1] if parts else "nothing I recognise"
