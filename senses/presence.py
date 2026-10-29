"""
presence.py - lets the AI see you (replaces the old "vision mode").

Uses only OpenCV's built-in face models (no TensorFlow, no MediaPipe, no FER),
so there are no more oneDNN / absl warnings and it works on Python 3.13:
  - YuNet  finds faces in the camera image
  - SFace  recognises whether the face is *you* (after you teach it your face once)

It reports events like:
  {"type": "presence", "present": True, "who": "owner", "name": "JP", "x": 0.52, "y": 0.41}
"""
import os
import json
import time
import threading

import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the project folder (this file is in senses/)
from paths import data_file  # saved files live in the data/ folder
MODEL_DIR = os.path.join(BASE_DIR, "data", "models")         # face detection + recognition files
DETECT_MODEL = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
RECOG_MODEL = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")
OWNER_FILE = data_file("owner_face.json")
PEOPLE_FILE = data_file("people_faces.json")        # other people she knows: {"Ana": {"features": [...], "relation": "sister"}}

MODEL_URLS = {
    DETECT_MODEL: "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
                  "face_detection_yunet/face_detection_yunet_2023mar.onnx",
    RECOG_MODEL: "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
                 "face_recognition_sface/face_recognition_sface_2021dec.onnx",
}


def ensure_models(on_event=lambda e: None):
    """Download OpenCV's face models the first time (about 39 MB). Returns True when both exist."""
    import requests
    import shutil
    os.makedirs(MODEL_DIR, exist_ok=True)
    for path, url in MODEL_URLS.items():
        old = os.path.join(BASE_DIR, "face_models", os.path.basename(path))   # where older versions kept them
        if not os.path.exists(path) and os.path.exists(old):
            shutil.move(old, path)
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            continue
        on_event({"type": "camera", "status": "downloading",
                  "message": "Downloading face recognition files (first time only)…"})
        tmp = path + ".part"
        try:
            with requests.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
            os.replace(tmp, path)
        except Exception as e:
            if os.path.exists(tmp):
                os.remove(tmp)
            on_event({"type": "camera", "status": "error",
                      "message": f"Couldn't download the face files: {e}"})
            return False
    return True


MATCH_THRESHOLD = 0.363       # SFace cosine similarity: above this = same person (OpenCV's recommended value)
ABSENT_AFTER = 3.0            # seconds without a face before we say you left
RECOGNISE_EVERY = 1.0         # seconds between identity checks (recognition is the slow part)
POSITION_EVERY = 0.15         # seconds between head-tracking updates sent to the UI


class Presence:
    def __init__(self, on_event=print, camera_index=-1):
        self.on_event = on_event
        self.camera_index = camera_index
        self.running = False
        self.thread = None
        self.lock = threading.Lock()
        self.owner = self._load_owner()            # {"name": str, "features": [[...], ...]}
        self.people = self._load_people()          # other known people
        self._who_name = None
        self.watch_objects = False                # look for everyday things too (objects.py)
        self.objects = []                         # what it saw last: [{"label", "score", "box"}]
        self._objects_at = 0.0
        self._objects_busy = False
        self.attention = None                      # True = facing the screen, False = looking away
        self._attn_since = (None, 0.0)
        self.state = {"present": False, "who": None}
        self._last_seen = 0.0
        self._last_recognised = 0.0
        self._last_position = 0.0
        self._who = None
        self._enroll = None                         # {"name", "samples": [], "need": int}
        self.preview = False
        self._snapshot = None                       # (time, jpeg bytes) of the latest camera picture
        self._detector = None
        self._recogniser = None

    # ---------------- owner face ----------------
    def _load_owner(self):
        if os.path.exists(OWNER_FILE):
            try:
                with open(OWNER_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError):
                pass
        return None

    def _load_people(self):
        try:
            with open(PEOPLE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_people(self):
        with open(PEOPLE_FILE, "w", encoding="utf-8") as f:
            json.dump(self.people, f)

    def known_people(self):
        return [{"name": n, "relation": p.get("relation", "")} for n, p in self.people.items()]

    def forget_person(self, name):
        with self.lock:
            removed = self.people.pop(name, None) is not None
            self._save_people()
            self._who = None
        return removed

    @property
    def owner_name(self):
        return self.owner["name"] if self.owner else None

    def start_enroll(self, name, samples=8, owner=True, relation=""):
        """Teach the AI a face (yours, or someone else's with owner=False): look at the camera for a few seconds."""
        with self.lock:
            self._enroll = {"name": name.strip() or "you", "samples": [], "need": samples, "owner": owner, "relation": relation}
        self.on_event({"type": "enroll", "status": "started", "progress": 0})
        if not self.running:
            self.start()

    def forget_owner(self):
        with self.lock:
            self.owner = None
            self._who = None
        if os.path.exists(OWNER_FILE):
            os.remove(OWNER_FILE)

    # ---------------- models ----------------
    def _models(self, width, height):
        import cv2
        if self._detector is None:
            for path in (DETECT_MODEL, RECOG_MODEL):
                if not os.path.exists(path):
                    raise FileNotFoundError(f"Missing face model: {path}")
            self._detector = cv2.FaceDetectorYN.create(DETECT_MODEL, "", (width, height), 0.8, 0.3, 50)
            self._recogniser = cv2.FaceRecognizerSF.create(RECOG_MODEL, "")
        self._detector.setInputSize((width, height))
        return self._detector, self._recogniser

    # ---------------- camera loop ----------------
    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=3)
        self._set_state(False, None, None, None)

    def _open_camera(self, cv2):
        """Chosen camera first (every Windows driver, with warm-up reads), then any other working camera."""
        import devices
        index = devices.pick_camera(self.camera_index)
        cap = devices.open_camera(index)
        if cap is None:
            for cam in devices.list_cameras(fresh=True):
                if cam["index"] != index:
                    cap = devices.open_camera(cam["index"])
                    if cap is not None:
                        break
        return cap

    def _loop(self):
        try:
            self._run_camera()
        except Exception as e:                       # never die silently: tell the window what went wrong
            print(f"[camera] {type(e).__name__}: {e}")
            self.on_event({"type": "camera", "status": "error", "message": f"Camera problem: {e}"})
        finally:
            self.running = False
            self.on_event({"type": "camera", "status": "off"})

    def _run_camera(self):
        import cv2
        if not hasattr(cv2, "FaceDetectorYN"):
            raise RuntimeError("your OpenCV is too old - run: pip install -U opencv-python")
        if not ensure_models(self.on_event):
            return
        cap = self._open_camera(cv2)
        if cap is None:
            raise RuntimeError("couldn't open the webcam. Is another app (Zoom, Discord, OBS) using it?")
        self.on_event({"type": "camera", "status": "on"})
        self.on_event({"type": "presence", "present": False, "who": None, "name": None, "x": None, "y": None})
        last_preview, failures, frame_errors = 0.0, 0, 0
        try:
            while self.running:
                ok, frame = cap.read()
                if not ok:
                    failures += 1
                    if failures > 60:
                        raise RuntimeError("the webcam stopped sending pictures")
                    time.sleep(0.05)
                    continue
                failures = 0
                now = time.time()
                if not self._snapshot or now - self._snapshot[0] > 0.5:     # keep a fresh picture for the AI to look at
                    h, w = frame.shape[:2]
                    scale = 640 / max(w, 1)
                    pic = cv2.resize(frame, (640, int(h * scale))) if w > 640 else frame
                    ok_jpg, jpg = cv2.imencode(".jpg", pic, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    if ok_jpg:
                        self._snapshot = (now, jpg.tobytes())
                if self.watch_objects and not self._objects_busy and now - self._objects_at > 2.0:
                    self._objects_at, self._objects_busy = now, True
                    threading.Thread(target=self._look_for_objects, args=(frame.copy(),), daemon=True).start()
                try:
                    self.process_frame(frame, time.time())
                except Exception as e:
                    frame_errors += 1
                    if frame_errors == 1:
                        print(f"[camera] face detection error: {e}")
                    if frame_errors > 30:
                        raise
                if self.preview and time.time() - last_preview > 0.25:
                    last_preview = time.time()
                    small = cv2.resize(frame, (240, int(240 * frame.shape[0] / frame.shape[1])))
                    ok, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    if ok:
                        import base64
                        self.on_event({"type": "preview", "jpg": base64.b64encode(jpg.tobytes()).decode()})
                time.sleep(0.03)                       # ~25 fps max, keeps CPU low
        finally:
            cap.release()

    # ---------------- per-frame logic (testable without a camera) ----------------
    def process_frame(self, frame, now):
        h, w = frame.shape[:2]
        detector, recogniser = self._models(w, h)
        _, faces = detector.detect(frame)
        if faces is None or len(faces) == 0:
            if self.state["present"] and now - self._last_seen > ABSENT_AFTER:
                self._who = None
                self._set_state(False, None, None, None)
            return None

        face = max(faces, key=lambda f: f[2] * f[3])            # biggest face = closest person
        self._last_seen = now
        cx = float((face[0] + face[2] / 2) / w)
        cy = float((face[1] + face[3] / 2) / h)
        self._update_attention(face, now)

        gap = now - self._last_recognised
        if self._enroll is not None:
            need_identity = gap > 0.35                # spread samples over ~3s so you can move a little
        else:
            need_identity = self._who is None or gap > RECOGNISE_EVERY
        if need_identity:
            aligned = recogniser.alignCrop(frame, face)
            feature = recogniser.feature(aligned).flatten().astype(float)
            self._last_recognised = now
            if self._enroll is not None:
                self._add_enroll_sample(feature)
            self._who = self.identify(feature)

        if not self.state["present"] or self.state["who"] != self._who:
            self._set_state(True, self._who, cx, cy)
        elif now - self._last_position > POSITION_EVERY:
            self._last_position = now
            self.on_event({"type": "look", "x": cx, "y": cy})
        return self._who

    def _look_for_objects(self, frame):
        try:
            import objects
            found = objects.detect(frame)
            before = sorted({o["label"] for o in self.objects})
            self.objects = found
            after = sorted({o["label"] for o in found})
            if after != before:
                self.on_event({"type": "objects", "items": found, "labels": after})
        except Exception as e:
            print(f"[objects] {e}")
            self.watch_objects = False
        finally:
            self._objects_busy = False

    def snapshot(self, max_age=3.0):
        """The latest camera picture as base64 JPEG, or None if the camera is off or the picture is old."""
        snap = self._snapshot
        if not self.running or not snap or time.time() - snap[0] > max_age:
            return None
        import base64
        return base64.b64encode(snap[1]).decode()

    def identify(self, feature):
        """'owner' (you), 'known' (someone you taught her - name in self._who_name) or 'someone'."""
        f = np.asarray(feature, dtype=float)
        self._who_name = None
        if self.owner:
            best = max(self._cosine(f, np.asarray(o, dtype=float)) for o in self.owner["features"])
            if best >= MATCH_THRESHOLD:
                self._who_name = self.owner["name"]
                return "owner"
        best_name, best = None, 0.0
        for name, person in self.people.items():
            score = max(self._cosine(f, np.asarray(o, dtype=float)) for o in person["features"])
            if score > best:
                best_name, best = name, score
        if best >= MATCH_THRESHOLD:
            self._who_name = best_name
            return "known"
        return "someone"

    def _update_attention(self, face, now, settle=1.5):
        """Facing the screen? Uses the 5 face points: the nose sits between the eyes when you look straight on."""
        if len(face) < 10:
            return
        rx, ry, lx, ly, nx = (float(v) for v in face[4:9])
        span = lx - rx
        if abs(span) < 1:
            return
        ratio = (nx - rx) / span
        looking = 0.28 < ratio < 0.72 and abs(span) / max(float(face[2]), 1) > 0.28
        cand, since = self._attn_since
        if looking != cand:
            self._attn_since = (looking, now)
        elif looking != self.attention and now - since >= settle:
            self.attention = looking
            self.on_event({"type": "attention", "looking": looking})

    @staticmethod
    def _cosine(a, b):
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

    def _add_enroll_sample(self, feature):
        with self.lock:
            e = self._enroll
            e["samples"].append([round(float(v), 6) for v in feature])
            progress = len(e["samples"]) / e["need"]
            self.on_event({"type": "enroll", "status": "progress", "progress": round(progress, 2)})
            if len(e["samples"]) >= e["need"]:
                if e.get("owner", True):
                    self.owner = {"name": e["name"], "features": e["samples"]}
                    with open(OWNER_FILE, "w", encoding="utf-8") as f:
                        json.dump(self.owner, f)
                else:
                    self.people[e["name"]] = {"features": e["samples"], "relation": e.get("relation", "")}
                    self._save_people()
                self._enroll = None
                self._who = None
                self.on_event({"type": "enroll", "status": "done", "name": e["name"], "owner": e.get("owner", True)})

    def _set_state(self, present, who, x, y):
        changed = (present, who) != (self.state["present"], self.state["who"])
        self.state = {"present": present, "who": who}
        if changed:
            self.on_event({"type": "presence", "present": present, "who": who,
                           "name": self.owner_name if who == "owner" else self._who_name if who == "known" else None,
                           "x": x, "y": y})
