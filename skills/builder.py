"""builder.py - the 3D Build Lab's designer: turns a prompt ("create a robot dog", "build a smart TV") into a build
spec the Build Lab page (ui/builder/) turns into a 3D model: exoskeleton/frame, motors and servos, electronics,
wiring and power - which it then simulates (walking, driving, flying, a TV switching on...).

How it works
- Online: the AI designs the actual 3D model (template "custom"): every part's shape, size in mm, position, what it's
  attached to, the joints and how they move. Then the layout is checked (floating parts, feet off the ground, odd
  proportions) and the AI corrects it in a second, smaller round.
- If that fails the AI picks one of the built-in body plans (TEMPLATES); offline, a built-in designer does.
- Real numbers: every part gets its datasheet weight, current and torque (PART_DB), and analyse() works out the total
  weight, power budget, battery runtime and whether the servos are strong enough.
- Manual-mode changes made on the page are saved as "edits" and replayed after the model is built.
- Everything the AI sends is checked and clamped here, so the page never gets an impossible spec.

Saved builds live in data/builder/<name>.json.
"""
import json
import os
import re
import time

from paths import data_file

PROJECTS = data_file("builder")

# ---------------------------------------------------------------- body plans the 3D page knows how to build
# kind: robot (moves) or device (electronics you build). 'motion' is what the simulation does.
TEMPLATES = {
    "quadruped": {"kind": "robot", "motion": "walk", "name": "Four-legged robot", "words": r"dog|puppy|cat|horse|cow|quadruped|four[- ]?leg|wolf|fox|lion|tiger|goat|deer|pony|animal|pet|giraffe|elephant|zebra|rhino|bear|camel|bull|sheep|pig|rabbit|bunny|kangaroo|panther|leopard|cheetah"},
    "hexapod": {"kind": "robot", "motion": "walk", "name": "Six-legged robot", "words": r"spider|hexapod|six[- ]?leg|insect|ant|beetle|crab|bug|scorpion"},
    "biped": {"kind": "robot", "motion": "walk", "name": "Two-legged walker", "words": r"biped|two[- ]?leg|bird|chicken|ostrich|dinosaur|t-?rex|raptor|penguin"},
    "humanoid": {"kind": "robot", "motion": "walk", "name": "Humanoid robot", "words": r"humanoid|human|android|person|butler|soldier|mech|gundam|terminator|animatronic|waifu|girl|boy|man|woman|gorilla|ape|monkey|chimp|orangutan|robot ?boy|cyborg"},
    "wheeled": {"kind": "robot", "motion": "drive", "name": "Wheeled robot", "words": r"car|rover|wheel|vehicle|buggy|truck|line[- ]?follow|delivery|vacuum|roomba|kart"},
    "tracked": {"kind": "robot", "motion": "drive", "name": "Tracked robot", "words": r"tank|track|crawler|bulldozer|tread|excavator"},
    "arm": {"kind": "robot", "motion": "arm", "name": "Robotic arm", "words": r"\barm\b|gripper|claw|crane|manipulator|pick and place|scara"},
    "drone": {"kind": "robot", "motion": "fly", "name": "Quadcopter drone", "words": r"drone|quadcopter|quadrotor|copter|uav|fly|flying|helicopter"},
    "snake": {"kind": "robot", "motion": "slither", "name": "Snake robot", "words": r"snake|serpent|worm|eel|centipede|dragon"},
    "fish": {"kind": "robot", "motion": "swim", "name": "Robot fish", "words": r"fish|shark|dolphin|whale|submarine|underwater|swim"},
    "panel": {"kind": "device", "motion": "screen", "name": "Screen device", "words": r"tv|television|monitor|display|tablet|phone|smartphone|laptop|screen|kiosk|e-?reader|picture frame"},
    "cylinder": {"kind": "device", "motion": "power", "name": "Round device", "words": r"smart speaker|alexa|echo|lamp|lantern|bottle|thermos|humidifier|diffuser|cylinder|\bcan\b"},
    "box": {"kind": "device", "motion": "power", "name": "Electronic box", "words": r"console|router|speaker|amplifier|radio|pc|computer|server|power bank|charger|microwave|printer|controller|alarm|weather station|game|arcade|box"},
    "fan": {"kind": "device", "motion": "spin", "name": "Fan", "words": r"\bfan\b|blower|propeller fan|air cooler|ventilator"},
    "watch": {"kind": "device", "motion": "screen", "name": "Wearable", "words": r"watch|smartwatch|fitness band|tracker|wearable|bracelet"},
}
LAYERS = ("shell", "frame", "actuator", "electronics", "power", "sensor", "wiring", "display", "mechanical")

# default parts per body plan: [name, layer, spec, qty, unit price (USD), mount]
# mount = where the 3D page puts it: body, head, back, front, base, tail, legs (one per joint), wheels, rotors, inside, screen
COMMON_ROBOT = [
    ["ESP32 DevKit (main controller)", "electronics", "dual-core 240 MHz, Wi-Fi + Bluetooth", 1, 8, "body"],
    ["PCA9685 16-channel servo driver", "electronics", "I2C, 12-bit PWM", 1, 4, "body"],
    ["2S LiPo battery 7.4 V 2200 mAh", "power", "XT60 plug", 1, 18, "body"],
    ["Buck converter 7.4 V -> 6 V, 5 A", "power", "for the servos", 1, 5, "body"],
    ["Power switch", "power", "SPST rocker, 10 A", 1, 1, "back"],
    ["MPU6050 IMU", "sensor", "gyro + accelerometer, keeps it balanced", 1, 3, "body"],
    ["HC-SR04 ultrasonic sensor", "sensor", "obstacle distance, 2-400 cm", 1, 2, "head"],
]
DEFAULT_PARTS = {
    "quadruped": COMMON_ROBOT + [["MG996R metal-gear servo", "actuator", "11 kg·cm, hip + knee joints", 8, 6, "legs"],
                                 ["SG90 micro servo", "actuator", "head pan / tail wag", 2, 2, "head"],
                                 ["3D-printed PLA exoskeleton", "shell", "body shell, head, leg covers", 1, 15, "body"],
                                 ["Aluminium servo brackets", "frame", "leg links and hip mounts", 8, 1.5, "legs"]],
    "hexapod": COMMON_ROBOT + [["MG90S metal-gear micro servo", "actuator", "2.2 kg·cm, coxa / femur / tibia", 18, 3, "legs"],
                               ["Second PCA9685 servo driver", "electronics", "18 servos need 2 drivers", 1, 4, "body"],
                               ["3D-printed PLA body plates", "shell", "top + bottom plates", 1, 12, "body"]],
    "biped": COMMON_ROBOT + [["MG996R metal-gear servo", "actuator", "hip / knee / ankle", 6, 6, "legs"],
                             ["3D-printed PLA exoskeleton", "shell", "torso + leg covers", 1, 14, "body"]],
    "humanoid": COMMON_ROBOT + [["MG996R metal-gear servo", "actuator", "legs: hip / knee / ankle", 6, 6, "legs"],
                                ["MG90S micro servo", "actuator", "arms: shoulder / elbow, neck", 7, 3, "arms"],
                                ["Animatronic eye mechanism", "mechanical", "2 eyes, 1 servo each", 1, 9, "head"],
                                ["3D-printed PLA exoskeleton", "shell", "head, torso, limb covers", 1, 25, "body"]],
    "wheeled": [["ESP32 DevKit (main controller)", "electronics", "Wi-Fi + Bluetooth control", 1, 8, "body"],
                ["L298N dual motor driver", "electronics", "2 A per channel", 1, 3, "body"],
                ["TT gear motor 6 V with wheel", "actuator", "1:48 gearbox, 65 mm wheel", 4, 3, "wheels"],
                ["18650 battery pack 2S 7.4 V", "power", "with holder", 1, 9, "body"],
                ["Power switch", "power", "SPST", 1, 1, "back"],
                ["HC-SR04 ultrasonic sensor", "sensor", "obstacle avoidance", 1, 2, "front"],
                ["TCRT5000 line sensors", "sensor", "line following", 2, 1, "front"],
                ["Acrylic chassis plate", "frame", "2 decks with standoffs", 1, 7, "body"]],
    "tracked": [["Arduino Mega 2560", "electronics", "main controller", 1, 15, "body"],
                ["BTS7960 43 A motor driver", "electronics", "one per side", 2, 9, "body"],
                ["JGB37-520 12 V gear motor", "actuator", "drives the sprockets", 2, 12, "wheels"],
                ["3S LiPo battery 11.1 V 3000 mAh", "power", "XT60", 1, 25, "body"],
                ["Rubber tracks + sprockets", "mechanical", "pair", 1, 20, "wheels"],
                ["Aluminium tank chassis", "frame", "", 1, 30, "body"],
                ["HC-SR04 ultrasonic sensor", "sensor", "", 1, 2, "front"]],
    "arm": [["Arduino Uno R3", "electronics", "controller", 1, 10, "base"],
            ["PCA9685 16-channel servo driver", "electronics", "", 1, 4, "base"],
            ["MG996R metal-gear servo", "actuator", "base turn / shoulder / elbow", 3, 6, "joints"],
            ["MG90S micro servo", "actuator", "wrist turn / wrist bend / gripper", 3, 3, "joints"],
            ["5 V 5 A power supply", "power", "barrel jack", 1, 8, "base"],
            ["Joystick module", "sensor", "manual control", 2, 2, "base"],
            ["Aluminium arm links", "frame", "", 1, 18, "joints"]],
    "drone": [["F405 flight controller", "electronics", "Betaflight / ArduPilot", 1, 35, "body"],
              ["4-in-1 ESC 35 A", "electronics", "BLHeli_32", 1, 40, "body"],
              ["2306 2400 KV brushless motor", "actuator", "", 4, 15, "rotors"],
              ["5-inch propellers", "mechanical", "tri-blade", 4, 1, "rotors"],
              ["4S LiPo 1500 mAh", "power", "XT60", 1, 28, "body"],
              ["GPS + compass module", "sensor", "M8N", 1, 18, "body"],
              ["ELRS receiver", "electronics", "2.4 GHz radio link", 1, 15, "body"],
              ["Carbon-fibre X frame 220 mm", "frame", "", 1, 25, "body"]],
    "snake": [["ESP32 DevKit (main controller)", "electronics", "", 1, 8, "head"],
              ["PCA9685 16-channel servo driver", "electronics", "", 1, 4, "head"],
              ["MG996R metal-gear servo", "actuator", "one per segment joint", 8, 6, "segments"],
              ["2S LiPo 7.4 V 2200 mAh", "power", "", 1, 18, "head"],
              ["Passive wheels / skin scales", "mechanical", "friction for slithering", 8, 1, "segments"],
              ["3D-printed segment shells", "shell", "", 9, 2, "segments"]],
    "fish": [["ESP32 DevKit (main controller)", "electronics", "in a sealed box", 1, 8, "body"],
             ["Waterproof servo 25 kg·cm", "actuator", "tail fin", 2, 14, "tail"],
             ["Micro servo (pectoral fins)", "actuator", "", 2, 4, "body"],
             ["Ballast syringe pump", "mechanical", "dive / surface", 1, 12, "body"],
             ["2S LiPo 7.4 V 1000 mAh", "power", "", 1, 14, "body"],
             ["Waterproof PLA hull + O-rings", "shell", "", 1, 20, "body"]],
    "panel": [["Display panel (LCD / OLED)", "display", "the screen itself", 1, 120, "screen"],
              ["LED backlight strips", "display", "edge-lit, behind the LCD", 6, 3, "screen"],
              ["T-con board", "electronics", "timing controller: drives the panel", 1, 15, "inside"],
              ["Main board (SoC)", "electronics", "quad-core ARM SoC, HDMI, USB, Wi-Fi", 1, 45, "inside"],
              ["Power supply board", "power", "230 V AC -> 12 V / 5 V DC", 1, 25, "inside"],
              ["LED driver board", "power", "constant current for the backlight", 1, 8, "inside"],
              ["Stereo speakers 10 W", "electronics", "", 2, 6, "inside"],
              ["Wi-Fi / Bluetooth module", "electronics", "", 1, 6, "inside"],
              ["IR receiver + power LED", "sensor", "for the remote", 1, 1, "front"],
              ["Plastic back cover + bezel", "shell", "", 1, 20, "shell"],
              ["Metal frame + stand", "frame", "", 1, 15, "base"]],
    "box": [["Main board", "electronics", "microcontroller / SoC", 1, 12, "inside"],
            ["Power supply module", "power", "AC -> DC or USB-C PD", 1, 8, "inside"],
            ["Speaker driver 3 W", "electronics", "", 2, 4, "inside"],
            ["Amplifier board PAM8403", "electronics", "", 1, 2, "inside"],
            ["Buttons + knob", "sensor", "", 3, 1, "front"],
            ["Status LEDs", "display", "", 3, 0.2, "front"],
            ["ABS enclosure", "shell", "", 1, 10, "shell"]],
    "cylinder": [["ESP32-S3 module", "electronics", "Wi-Fi + voice", 1, 9, "inside"],
                 ["Full-range speaker 5 W", "electronics", "", 1, 7, "inside"],
                 ["I2S amplifier MAX98357", "electronics", "", 1, 4, "inside"],
                 ["MEMS microphone array", "sensor", "INMP441 x2", 2, 3, "inside"],
                 ["WS2812 LED ring", "display", "12 LEDs", 1, 3, "inside"],
                 ["USB-C 5 V power board", "power", "", 1, 3, "inside"],
                 ["Fabric-wrapped shell", "shell", "", 1, 8, "shell"]],
    "fan": [["BLDC fan motor 12 V", "actuator", "", 1, 12, "inside"],
            ["Fan blades 30 cm", "mechanical", "5 blades", 1, 6, "rotors"],
            ["Motor driver / speed controller", "electronics", "", 1, 5, "inside"],
            ["ESP32 (smart control)", "electronics", "", 1, 8, "inside"],
            ["12 V 3 A power adapter", "power", "", 1, 8, "base"],
            ["Speed buttons", "sensor", "", 3, 0.5, "base"],
            ["Safety grille + stand", "frame", "", 1, 10, "shell"]],
    "watch": [["1.4-inch round AMOLED", "display", "", 1, 18, "screen"],
              ["nRF52840 module", "electronics", "Bluetooth LE", 1, 9, "inside"],
              ["Heart-rate sensor MAX30102", "sensor", "", 1, 4, "inside"],
              ["Accelerometer BMA423", "sensor", "step counting", 1, 2, "inside"],
              ["LiPo 200 mAh", "power", "", 1, 4, "inside"],
              ["Vibration motor", "actuator", "", 1, 1, "inside"],
              ["Aluminium case + strap", "shell", "", 1, 12, "shell"]],
}
COLOURS = {"red": "#d64545", "blue": "#3f7fd6", "green": "#3fae5a", "yellow": "#e8c13a", "black": "#2a2d33", "white": "#e9ecef",
           "orange": "#ee8a2a", "purple": "#8b52c9", "pink": "#e877a8", "silver": "#b8c0c8", "gold": "#d4a73a", "grey": "#8a9099", "gray": "#8a9099"}


def classify(prompt):
    """the body plan that best fits the words (offline designer). Robots win over devices on ties ('robot fish')."""
    p = (prompt or "").lower()
    best, score = None, 0
    for tid, t in TEMPLATES.items():
        hits = len(re.findall(t["words"], p))
        if hits and t["kind"] == "robot" and "robot" in p: hits += 0.5
        if hits > score: best, score = tid, hits
    if best: return best
    return "wheeled" if "robot" in p else "box"


def _title(prompt, template):
    p = re.sub(r"^\s*(please\s+)?(create|make|build|design|generate|give me|i want)\s+(me\s+)?((a|an|the)\s+)?", "", (prompt or "").strip(), flags=re.I)
    if len(p) > 40:                     # a long, detailed prompt: the name is the thing itself, before the details
        p = re.split(r",|;|\.| with | that | which | for | made of | in (?=\w+ colou?r)", p, maxsplit=1, flags=re.I)[0]
    p = re.sub(r"^(a|an|the)\s+", "", re.sub(r"[^\w\s\-']", "", p).strip(), flags=re.I)
    if len(p) > 48:
        p = p[:48].rsplit(" ", 1)[0]
    return (p[:1].upper() + p[1:]) if p else TEMPLATES[template]["name"]


def _keep_name(ai_name, prompt, template):
    """the AI's name only if every real word of it is one the user used ("Desktop Air Conditioner" for "air conditioner"
    is not) - otherwise the user's own words"""
    said = set(re.findall(r"[a-z0-9]+", (prompt or "").lower()))
    words = [w for w in re.findall(r"[a-z0-9]+", str(ai_name or "").lower()) if w not in ("a", "an", "the", "of", "and", "with")]
    if words and all(w in said or w.rstrip("s") in said or w + "s" in said for w in words):
        return str(ai_name)[:60]
    return _title(prompt, template)[:60]


def _colour(prompt):
    for k, v in COLOURS.items():
        if re.search(rf"\b{k}\b", (prompt or "").lower()): return v
    return None


def offline_design(prompt):
    t = classify(prompt)
    T = TEMPLATES[t]
    parts = [{"name": n, "layer": l, "spec": s, "qty": q, "price": pr, "mount": m} for n, l, s, q, pr, m in DEFAULT_PARTS[t]]
    return validate({"name": _title(prompt, t), "template": t, "summary": f"{T['name']} designed from your idea.",
                     "params": {"color": _colour(prompt)}, "parts": parts, "steps": default_steps(t), "source": "offline"}, prompt)


def default_steps(t):
    kind = TEMPLATES[t]["kind"]
    if kind == "robot":
        return ["Print or cut the exoskeleton / frame parts and test-fit them.",
                "Centre every servo at 90° (or check each motor spins) BEFORE mounting it.",
                "Mount the motors/servos into the frame joints and attach the links.",
                "Fix the controller, driver and power boards in the body; keep the battery easy to reach.",
                "Wire: battery -> switch -> regulator -> driver power; signals from the controller to the driver; sensors to the controller.",
                "Upload the test code, power up with the robot lifted, check every joint moves the right way.",
                "Put it down and run the gait. Tune speeds and angles, then close the shell."]
    return ["Check the parts list and the power needs of every board.",
            "Mount the frame / back panel and fix the main board and power supply.",
            "Fit the display / speakers / buttons in the front.",
            "Wire power first (supply -> boards), then signal cables (ribbon, I2S, I2C...).",
            "Power on with the case open, check voltages with a multimeter.",
            "Close the shell and test every feature."]


def _num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def validate(spec, prompt=""):
    """clamp and complete whatever came in (AI or offline) into a spec the 3D page can always build."""
    spec = dict(spec or {})
    if spec.get("template") == "custom" and spec.get("geometry"):          # an AI 3D design (e.g. a saved one): keep it
        geo = validate_geometry(spec["geometry"])
        if geo:
            out = custom_spec(spec, geo, spec.get("prompt") or prompt or spec.get("name", ""))
            out["source"] = spec.get("source") or "ai"
            out["edits"] = _edits(spec.get("edits"))
            return out
    t = spec.get("template") if spec.get("template") in TEMPLATES else classify(prompt or spec.get("name", ""))
    T = TEMPLATES[t]
    params = dict(spec.get("params") or {})
    col = params.get("color")
    params["color"] = col if isinstance(col, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", col) else (_colour(prompt) or ("#e4e7ec" if T["kind"] == "robot" else "#2a2d33"))
    params["accent"] = params.get("accent") if isinstance(params.get("accent"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", params.get("accent") or "") else "#e0475b"
    params["scale"] = _num(params.get("scale"), 0.4, 3, 1)
    params["length"] = _num(params.get("length"), 0.5, 2, 1)
    params["legs"] = int(_num(params.get("legs"), 2, 8, {"quadruped": 4, "hexapod": 6, "biped": 2, "humanoid": 2}.get(t, 4)))
    params["screen_inches"] = _num(params.get("screen_inches"), 1, 100, 55 if t == "panel" else 1.4)
    parts = []
    for p in (spec.get("parts") or [])[:60]:
        if not isinstance(p, dict) or not str(p.get("name") or "").strip(): continue
        layer = p.get("layer") if p.get("layer") in LAYERS else "electronics"
        parts.append({"name": str(p["name"])[:70], "layer": layer, "spec": str(p.get("spec") or "")[:90],
                      "qty": int(_num(p.get("qty"), 1, 40, 1)), "price": round(_num(p.get("price"), 0, 5000, 0), 2),
                      "mount": str(p.get("mount") or "body")[:20]})
    if not parts:
        parts = [{"name": n, "layer": l, "spec": s, "qty": q, "price": pr, "mount": m} for n, l, s, q, pr, m in DEFAULT_PARTS[t]]
    # a robot always needs a brain, power and something that moves; a device needs a board and power
    layers = {p["layer"] for p in parts}
    for n, l, s, q, pr, m in DEFAULT_PARTS[t]:
        if l not in layers and l in ("actuator", "electronics", "power", "display" if t in ("panel", "watch") else "power"):
            parts.append({"name": n, "layer": l, "spec": s, "qty": q, "price": pr, "mount": m}); layers.add(l)
    steps = [str(s)[:240] for s in (spec.get("steps") or []) if str(s).strip()][:14] or default_steps(t)
    total = round(sum(p["qty"] * p["price"] for p in parts), 2)
    out = {"name": str(spec.get("name") or _title(prompt, t))[:60], "template": t, "kind": T["kind"], "motion": T["motion"],
           "summary": str(spec.get("summary") or T["name"])[:400], "params": params, "parts": parts, "steps": steps,
           "cost": total, "source": spec.get("source") or "ai", "prompt": (prompt or "")[:300]}
    # the firmware is always generated from the real parts list (an AI-written sketch isn't trusted to compile)
    out["code"] = sketch(out)
    out["edits"] = _edits(spec.get("edits"))
    for p in out["parts"]:                       # real weights, currents and torques for every part
        p.update({k: v for k, v in part_data(p).items() if k not in p})
    out["analysis"] = analyse(out)
    return out


def _edits(edits):
    """manual-mode changes (added / moved / deleted parts) saved with a build, replayed by the page after building"""
    out = []
    for e in (edits or [])[:400]:
        if not isinstance(e, dict) or e.get("op") not in ("add", "move", "del"):
            continue
        q = {"op": e["op"], "target": str(e.get("target") or "")[:60]}
        for k in ("pos", "rot", "scale"):
            if isinstance(e.get(k), (list, tuple)) and len(e[k]) == 3:
                q[k] = [round(_num(v, -1e4, 1e4, 0), 4) for v in e[k]]
        if e["op"] == "add" and isinstance(e.get("part"), dict):
            p = e["part"]
            q["part"] = {"kind": str(p.get("kind") or "box")[:20], "name": str(p.get("name") or "Part")[:70],
                         "layer": p.get("layer") if p.get("layer") in LAYERS else "frame", "color": p.get("color") if isinstance(p.get("color"), str) else None,
                         "parent": str(p.get("parent") or "")[:60]}
        out.append(q)
    return out


# ---------------------------------------------------------------- real firmware for the build
# Every build gets a sketch that matches ITS parts: the controller it uses (ESP32 / Arduino Uno / Mega), how many
# servos sit on the PCA9685, which sensors exist and the real libraries they need. These compile as written
# (Arduino IDE / arduino-cli) once the listed libraries are installed.
def _controller(parts):
    names = " ".join(p["name"].lower() for p in parts if p["layer"] == "electronics")
    if "esp32" in names: return "esp32"
    if "mega" in names: return "mega"
    if "nrf52" in names: return "nrf52"
    if "uno" in names or "arduino" in names: return "uno"
    if "f405" in names or "flight controller" in names: return "fc"
    return "esp32"


def _count(parts, rx):
    return sum(p["qty"] for p in parts if p["layer"] == "actuator" and re.search(rx, p["name"] + " " + p["spec"], re.I))


def _has(parts, rx):
    return any(re.search(rx, p["name"], re.I) for p in parts)


def sketch(spec):
    t, P, parts = spec["template"], spec["params"], spec["parts"]
    mcu = _controller(parts)
    sonar = _has(parts, r"hc-sr04|ultrasonic")
    imu = _has(parts, r"mpu6050|imu")
    board_note = {"esp32": "Board: ESP32 Dev Module", "mega": "Board: Arduino Mega 2560", "uno": "Board: Arduino Uno",
                  "nrf52": "Board: Adafruit nRF52840 (or similar)", "fc": ""}[mcu]
    trig, echo = ("5", "18") if mcu == "esp32" else ("7", "8")
    sda_scl = "Wire.begin(21, 22);   // ESP32: SDA = GPIO21, SCL = GPIO22" if mcu == "esp32" else "Wire.begin();         // Uno: SDA = A4, SCL = A5 · Mega: SDA = 20, SCL = 21"
    sonar_fn = (f"\nconst int TRIG = {trig}, ECHO = {echo};" + ("   // HC-SR04 ECHO is 5 V: use a 1k/2k divider into GPIO18" if mcu == "esp32" else "") + "\n"
                "long distanceCm() {\n  digitalWrite(TRIG, LOW); delayMicroseconds(2);\n  digitalWrite(TRIG, HIGH); delayMicroseconds(10); digitalWrite(TRIG, LOW);\n"
                "  long us = pulseIn(ECHO, HIGH, 25000UL);   // 25 ms timeout = nothing within ~4 m\n  return us == 0 ? 999 : us / 58;\n}\n") if sonar else ""
    sonar_setup = "  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);\n" if sonar else ""
    if TEMPLATES[t]["motion"] == "walk":
        legs = int(P.get("legs") or {"quadruped": 4, "hexapod": 6}.get(t, 2))
        per = 3 if t == "hexapod" else 2
        n = legs * per
        two = n > 16
        lines = [f"// {spec['name']} - walking gait ({legs} legs x {per} servos = {n} servos)", f"// {board_note} · libraries: Adafruit PWM Servo Driver Library",
                 "// Power the servos from the 6 V regulator (V+ on the PCA9685), NOT from the board's 5 V pin. Share GND.",
                 "#include <Wire.h>", "#include <Adafruit_PWMServoDriver.h>", "",
                 "Adafruit_PWMServoDriver pwmA(0x40);" + ("\nAdafruit_PWMServoDriver pwmB(0x41);   // second board: solder the A0 address jumper" if two else ""),
                 f"const int LEGS = {legs};", f"const int JOINTS = {per};               // " + ("coxa, femur, tibia" if per == 3 else "hip, knee"),
                 "const int SERVO_MIN = 110, SERVO_MAX = 510;   // pulse counts for 0° and 180° at 50 Hz (tune for your servos)",
                 f"int trim[{n}] = {{0}};                     // per-servo centre correction in degrees", sonar_fn,
                 "void setServo(int ch, float deg) {", "  deg = constrain(deg + trim[ch], 0.0f, 180.0f);",
                 "  int pulse = SERVO_MIN + (int)((SERVO_MAX - SERVO_MIN) * deg / 180.0f);",
                 ("  if (ch < 16) pwmA.setPWM(ch, 0, pulse); else pwmB.setPWM(ch - 16, 0, pulse);" if two else "  pwmA.setPWM(ch, 0, pulse);"), "}", "",
                 "void setup() {", "  Serial.begin(115200);", "  " + sda_scl, "  pwmA.begin(); pwmA.setOscillatorFrequency(27000000); pwmA.setPWMFreq(50);"]
        if two: lines.append("  pwmB.begin(); pwmB.setOscillatorFrequency(27000000); pwmB.setPWMFreq(50);")
        lines += [sonar_setup.rstrip("\n")] if sonar else []
        lines += ["  for (int ch = 0; ch < LEGS * JOINTS; ch++) setServo(ch, 90);   // stand: every joint centred", "  delay(1500);", "}", "",
                  "// phase offset of each leg in the gait cycle (0..1)", "float legPhase(int leg) {"]
        if t == "hexapod":
            lines.append("  return ((leg / 2) + (leg % 2)) % 2 == 0 ? 0.0f : 0.5f;   // tripod: legs 0,3,4 then 1,2,5")
        elif legs == 4:
            lines.append("  return (leg == 0 || leg == 3) ? 0.0f : 0.5f;          // trot: diagonal pairs together")
        else:
            lines.append("  return leg % 2 == 0 ? 0.0f : 0.5f;                     // walk: alternate legs")
        lines += ["}", "", "void loop() {"]
        if sonar:
            lines += ["  if (distanceCm() < 20) {                                  // something in front: stand still", "    for (int ch = 0; ch < LEGS * JOINTS; ch++) setServo(ch, 90);", "    delay(200);", "    return;", "  }"]
        lines += ["  const float stepHz = 0.9f;                                 // steps per second", "  float t = millis() / 1000.0f;",
                  "  for (int leg = 0; leg < LEGS; leg++) {", "    float ph = 2.0f * PI * (t * stepHz + legPhase(leg));", "    float swing = sinf(ph);",
                  "    float lift = cosf(ph) > 0.0f ? cosf(ph) : 0.0f;          // only lift while the leg swings forward"]
        if per == 3:
            lines += ["    setServo(leg * 3,     90 + 20 * swing);                  // coxa: swing forward/back",
                      "    setServo(leg * 3 + 1, 90 + 25 * lift);                   // femur: lift", "    setServo(leg * 3 + 2, 90 - 15 * lift);                   // tibia: tuck the foot"]
        else:
            lines += ["    setServo(leg * 2,     90 + 23 * swing);                  // hip", "    setServo(leg * 2 + 1, 90 - 43 * lift);                   // knee: lift the foot"]
        lines += ["  }", "  delay(20);                                                 // 50 updates per second", "}"]
        return "\n".join(lines) + "\n"
    if t in ("wheeled", "tracked"):
        if _has(parts, r"bts7960"):
            drv = ("// Two BTS7960 drivers: RPWM/LPWM per side, R_EN and L_EN tied to 5 V", "const int L_RPWM = 5, L_LPWM = 6, R_RPWM = 9, R_LPWM = 10;\nconst int OUT_PINS[] = {L_RPWM, L_LPWM, R_RPWM, R_LPWM};",
                   "void side(int rp, int lp, int v) { if (v >= 0) { analogWrite(rp, v); analogWrite(lp, 0); } else { analogWrite(rp, 0); analogWrite(lp, -v); } }",
                   "void drive(int l, int r) { side(L_RPWM, L_LPWM, constrain(l, -255, 255)); side(R_RPWM, R_LPWM, constrain(r, -255, 255)); }",
                   "  for (int i = 0; i < 4; i++) pinMode(OUT_PINS[i], OUTPUT);")
        else:
            pins = "const int ENA = 25, IN1 = 26, IN2 = 27, ENB = 14, IN3 = 33, IN4 = 32;   // (GPIO12 avoided: boot strapping pin)" if mcu == "esp32" else "const int ENA = 5, IN1 = 6, IN2 = 7, ENB = 10, IN3 = 8, IN4 = 9;"
            drv = ("// L298N: ENA/ENB = speed (PWM), IN1-IN4 = direction. Remove the ENA/ENB jumpers.", pins + "\nconst int OUT_PINS[] = {ENA, IN1, IN2, ENB, IN3, IN4};",
                   "void motor(int en, int a, int b, int v) { v = constrain(v, -255, 255); digitalWrite(a, v > 0); digitalWrite(b, v < 0); analogWrite(en, abs(v)); }",
                   "void drive(int l, int r) { motor(ENA, IN1, IN2, l); motor(ENB, IN3, IN4, r); }",
                   "  for (int i = 0; i < 6; i++) pinMode(OUT_PINS[i], OUTPUT);")
        line = _has(parts, r"tcrt5000|line")
        lp = ("const int LINE_L = 34, LINE_R = 35;" if mcu == "esp32" else "const int LINE_L = A0, LINE_R = A1;") if line else ""
        body = ["void loop() {"]
        if sonar: body += ["  if (distanceCm() < 20) {                  // obstacle: back off and turn", "    drive(-160, -160); delay(300);", "    drive(-170, 170); delay(350);", "    return;", "  }"]
        if line: body += ["  bool l = digitalRead(LINE_L), r = digitalRead(LINE_R);   // HIGH = black line under the sensor", "  if (l && !r) drive(60, 190);", "  else if (r && !l) drive(190, 60);", "  else drive(180, 180);"]
        else: body += ["  drive(180, 180);"]
        body += ["  delay(30);", "}"]
        return "\n".join([f"// {spec['name']} - drive" + (", avoid walls" if sonar else "") + (", follow a line" if line else ""), f"// {board_note}" + (" · ESP32 core 3.x (analogWrite works on any output pin)" if mcu == "esp32" else ""),
                          drv[0], drv[1], lp, sonar_fn, drv[2], drv[3], "", "void setup() {", drv[4], sonar_setup.rstrip("\n") if sonar else "",
                          "  " + ("pinMode(LINE_L, INPUT); pinMode(LINE_R, INPUT);" if line else "") , "}", ""] + body) .replace("\n\n\n", "\n\n") + "\n"
    if t == "arm":
        return f"""// {spec['name']} - pick and place with 6 servos on a PCA9685
// {board_note} · libraries: Adafruit PWM Servo Driver Library
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm(0x40);
enum {{ BASE, SHOULDER, ELBOW, WRIST_ROLL, WRIST, GRIP, N }};
float pos[N] = {{90, 90, 90, 90, 90, 90}};

void setJoint(int ch, float deg) {{ pwm.setPWM(ch, 0, 110 + (int)(400 * constrain(deg, 0.0f, 180.0f) / 180.0f)); }}

// move one joint smoothly (about 1 degree every 12 ms)
void moveTo(int ch, float target) {{
  while (fabs(pos[ch] - target) > 0.5f) {{
    pos[ch] += pos[ch] < target ? 1 : -1;
    setJoint(ch, pos[ch]);
    delay(12);
  }}
}}

void setup() {{
  {sda_scl}
  pwm.begin(); pwm.setOscillatorFrequency(27000000); pwm.setPWMFreq(50);
  for (int i = 0; i < N; i++) setJoint(i, pos[i]);
  delay(1000);
}}

void loop() {{
  moveTo(BASE, 105); moveTo(SHOULDER, 130); moveTo(ELBOW, 140); moveTo(WRIST, 110);   // reach the block
  moveTo(GRIP, 40);                                                                     // close the gripper
  moveTo(SHOULDER, 90); moveTo(BASE, 20);                                               // lift and carry
  moveTo(SHOULDER, 125); moveTo(GRIP, 90);                                              // lower and let go
  moveTo(SHOULDER, 90); moveTo(BASE, 90);                                               // home
  delay(800);
}}
"""
    if t == "drone":
        return f"""# {spec['name']} - flight controllers run Betaflight (or ArduPilot), not an Arduino sketch.
# Setup with the Betaflight Configurator (betaflight.com):
# 1. Flash Betaflight for your F405 target, then connect.
# 2. Ports: enable "Serial Rx" on the UART the ELRS receiver is wired to. Receiver tab: protocol CRSF.
# 3. Configuration: motor protocol DSHOT600, check board orientation.
# 4. Motors tab - PROPELLERS OFF: test each motor, check order 1-4 and spin direction (props-in default).
# 5. Modes: put ARM and ANGLE on switches. Calibrate the accelerometer on a flat surface.
# 6. Optional GPS: enable GPS on its UART, set GPS rescue after you have a stable lock.
# CLI quick start (paste in the CLI tab, then 'save'):
set motor_pwm_protocol = DSHOT600
set serialrx_provider = CRSF
feature GPS
save
"""
    if t == "snake":
        return f"""// {spec['name']} - serpentine (travelling sine wave) with servos on a PCA9685
// {board_note} · libraries: Adafruit PWM Servo Driver Library
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
Adafruit_PWMServoDriver pwm(0x40);
const int SEGMENTS = {max(2, _count(parts, r"servo"))};
void setServo(int ch, float deg) {{ pwm.setPWM(ch, 0, 110 + (int)(400 * constrain(deg, 0.0f, 180.0f) / 180.0f)); }}
void setup() {{
  {sda_scl}
  pwm.begin(); pwm.setOscillatorFrequency(27000000); pwm.setPWMFreq(50);
}}
void loop() {{
  float t = millis() / 1000.0f;
  for (int i = 0; i < SEGMENTS; i++) setServo(i, 90 + 30 * sinf(3.0f * t - 0.7f * i));   // wave runs head -> tail
  delay(20);
}}
"""
    if t == "fish":
        return f"""// {spec['name']} - tail swimming (ESP32Servo library)
#include <ESP32Servo.h>
Servo tail1, tail2;
void setup() {{ tail1.attach(13); tail2.attach(14); }}
void loop() {{
  float t = millis() / 1000.0f;
  tail1.write(90 + 25 * sinf(4.0f * t));          // tail base
  tail2.write(90 + 35 * sinf(4.0f * t - 1.0f));   // tail tip follows a little later
  delay(15);
}}
"""
    if t == "fan":
        return f"""// {spec['name']} - smart fan: 3 speed buttons drive the BLDC fan's PWM speed input (ESP32 core 3.x)
const int FAN_PWM = 25, BTN[3] = {{32, 33, 26}};
const int SPEED[3] = {{90, 170, 255}};
void setup() {{
  ledcAttach(FAN_PWM, 25000, 8);                 // 25 kHz PWM (standard for 4-wire fans), 8-bit
  for (int i = 0; i < 3; i++) pinMode(BTN[i], INPUT_PULLUP);
  ledcWrite(FAN_PWM, 0);
}}
void loop() {{
  for (int i = 0; i < 3; i++) if (digitalRead(BTN[i]) == LOW) {{ ledcWrite(FAN_PWM, SPEED[i]); delay(250); }}
}}
"""
    if t == "watch":
        return f"""// {spec['name']} - heart rate from the MAX30102 (SparkFun MAX3010x library)
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
MAX30105 sensor;
long lastBeat = 0; float bpm = 0;
void setup() {{
  Serial.begin(115200);
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {{ Serial.println("MAX30102 not found - check SDA/SCL wiring"); while (true) delay(1000); }}
  sensor.setup(); sensor.setPulseAmplitudeRed(0x0A);
}}
void loop() {{
  long ir = sensor.getIR();
  if (checkForBeat(ir)) {{ long now = millis(); bpm = 60000.0f / (now - lastBeat); lastBeat = now; }}
  if (ir < 50000) Serial.println("No finger on the sensor");
  else Serial.printf("Heart rate: %.0f bpm\\n", bpm);
  delay(20);
}}
"""
    if t == "cylinder":
        return f"""// {spec['name']} - LED ring animation (Adafruit NeoPixel library), ESP32-S3
#include <Adafruit_NeoPixel.h>
const int RING_PIN = 48, LEDS = 12;
Adafruit_NeoPixel ring(LEDS, RING_PIN, NEO_GRB + NEO_KHZ800);
void setup() {{ ring.begin(); ring.setBrightness(60); }}
void loop() {{
  static uint16_t hue = 0;
  for (int i = 0; i < LEDS; i++) ring.setPixelColor(i, ring.gamma32(ring.ColorHSV(hue + i * 65536L / LEDS)));
  ring.show();
  hue += 256;
  delay(20);
}}
"""
    if t == "panel":
        return f"""# {spec['name']} - a TV/screen runs an operating system on its main board (Android TV, Linux), not an Arduino sketch.
# A real DIY version: Raspberry Pi 5 as the main board + an LCD panel with an HDMI controller board (instead of the T-con).
# 1. Flash Raspberry Pi OS (64-bit) with Raspberry Pi Imager, enable Wi-Fi and SSH.
# 2. Plug the panel's HDMI controller board into the Pi's HDMI port and the PSU's 12 V into the controller.
# 3. IR remote: wire the IR receiver to GPIO17, then:
sudo nano /boot/firmware/config.txt      # add the line:  dtoverlay=gpio-ir,gpio_pin=17
sudo apt install ir-keytable
sudo ir-keytable -c -p all -t            # press remote buttons: their codes appear here
# 4. Media centre: sudo apt install kodi  (start it at boot with a systemd service or the desktop autostart)
"""
    # generic box: power-on self test that matches the controller
    led = "2" if mcu == "esp32" else "LED_BUILTIN"
    return f"""// {spec['name']} - power-on self test
// {board_note}
const int STATUS_LED = {led};
void setup() {{
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  Serial.println("{spec['name']}: boot OK");
}}
void loop() {{
  digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));   // heartbeat blink = firmware is running
  delay(500);
}}
"""


SYSTEM = """You are the designer of a 3D build simulator. The user describes a robot or an electronic device; you design it
for real: body plan, proportions, every part (exoskeleton/shell, frame, motors/servos, controller, drivers, power, sensors,
display...) and the build steps. Answer with ONE JSON object and nothing else:
{"name": short name, "template": one of TEMPLATES, "summary": 1-2 sentences,
 "params": {"color": "#rrggbb", "accent": "#rrggbb", "scale": 0.4-3 (1 = about 30 cm robot / normal device), "length": 0.5-2,
            "legs": number of legs if it walks, "screen_inches": for screens},
 "parts": [{"name": ..., "layer": one of LAYERS, "spec": short spec, "qty": n, "price": USD each,
            "mount": body|head|back|front|base|tail|legs|arms|wheels|rotors|joints|segments|inside|screen|shell}],
 "steps": ["build step", ...]}
Controllers: prefer ESP32 DevKit, Arduino Uno/Mega, PCA9685 for many servos - the firmware is generated from your parts.
Use real, buyable parts with honest prices. Servos/motors: one entry per type with the right qty (e.g. 8 hip/knee servos).
TEMPLATES: """ + ", ".join(f"{k} ({v['name']})" for k, v in TEMPLATES.items()) + "\nLAYERS: " + ", ".join(LAYERS)


# ---------------------------------------------------------------- fully AI-designed 3D models
# The AI doesn't pick a pre-made body plan here: it designs the actual 3D model - every part's shape, real size in mm,
# position, which part it's attached to, the joints that move and how they move. Anything you can describe can be built.
SHAPES = ("box", "rounded_box", "cylinder", "sphere", "capsule", "cone", "torus", "wheel", "servo", "board", "battery", "motor", "screen", "propeller")
MOTIONS = ("walk", "drive", "fly", "arm", "swim", "spin", "screen", "power", "slither", "custom")
GEO_SYSTEM = """You are a mechatronics engineer and 3D modeller for a build simulator. Design the thing the user asks for AS A REAL
3D MODEL made of simple shapes, with real buyable parts. Answer with ONE MINIFIED JSON object only (no spaces or line breaks):
{"name": "...", "kind": "robot" | "device", "summary": "1-2 sentences",
 "motion": {"type": one of MOTIONS, "speed_hz": 0.3-3, "forward_mm_s": 0-800,
            "joints": [{"id": joint part id, "amp_deg": 5-60, "phase": 0-1, "offset_deg": -45..45}],
            "spin": [{"id": part id, "rpm": 10-20000}]},
 "parts": [{"id": "unique_snake_case", "name": "real part name", "layer": one of LAYERS,
            "shape": one of SHAPES, "size_mm": [x, y, z], "pos_mm": [x, y, z], "rot_deg": [x, y, z], "color": "#rrggbb",
            "parent": "id of the part it is attached to, or null", "joint": {"axis": "x"|"y"|"z", "min": -90, "max": 90} or null,
            "spec": "short datasheet spec", "price": USD each, "mass_g": grams, "current_ma": [idle, peak], "voltage": volts,
            "torque_kgcm": for servos/motors}],
 "wires": [{"from": part id, "to": part id, "kind": "power"|"ground"|"signal"|"data", "label": "..."}],
 "steps": ["build step", ...]}
Rules:
- Units are millimetres. Y is up, the ground is y=0, the front is +z. pos_mm is relative to the parent's origin.
- Every shape is drawn CENTRED on its part's origin. A part with a "joint" rotates about its origin, so make the joint part the
  hinge itself (usually the servo, at the hinge point) and attach the moving link as its CHILD, offset to the link's middle
  (e.g. hip_servo (joint) -> thigh (pos_mm [0,-60,0]) -> knee_servo (joint, pos_mm [0,-60,0] from the thigh) -> shin -> foot).
- Build EXACTLY what the user named - the same kind, model and size class. Never add words or features they didn't ask for
  (they say "air conditioner" -> not a "desktop" or "portable" one; a named product -> that product's real look and size).
  The "name" is the user's own words for it. Follow EVERY detail of a long prompt (colours, materials, counts, sizes, features).
- Model the shape faithfully, with its real silhouette and real dimensions: a giraffe has a long neck, a gorilla long arms and
  short legs, a TV a thin panel on a stand, smart glasses a frame with two lenses and temples, an acoustic guitar a ~1 m
  hourglass body (two overlapping flat cylinders, ~380 and ~290 mm across, ~100 mm deep, with a dark sound-hole disc) plus a
  long thin neck, frets, a headstock with tuning pegs and 6 strings; a wall air conditioner a long wide box ~800x280x200 mm
  with a front grille and louvre slats; escrima sticks two straight rattan cylinders ~710 mm long, ~28 mm thick.
  Build curves from several shapes: a sphere with unequal size_mm is an ellipsoid; overlap shapes freely.
- size_mm is [width x (left-right), height y (up), depth z (front-back)]. Anything flat that FACES the front (a front panel,
  grille, screen, display, louvre, door) is thin in z: e.g. [760, 240, 8]. A shelf or base plate is thin in y.
- Cylinders, cones and capsules stand along Y: size_mm = [diameter, length, diameter], rot_deg [0,0,0] = pointing UP. Long
  upright parts (a guitar neck, a lamp post, a stick, a leg) keep rot 0. ONLY a flat disc facing the front (a guitar body,
  a speaker cone, a clock face, a sound hole) is a short cylinder turned with rot_deg [90, 0, 0]: size_mm [380, 100, 380].
  Objects stand upright the way they're displayed: a guitar's body at the bottom and its neck going straight UP to the headstock.
- No loose cables or pipes longer than the object itself.
- Use as many parts as the real thing needs (2-70), and always add the small details that make it recognisable at a glance
  (a guitar's sound hole, strings, frets and pegs; an air conditioner's louvre slats, grille and display; grip tape on sticks). Electronic things include the shell, frame, every motor/servo (one part
  each, at its joint), controller, drivers, power (battery + regulator), sensors and display. Things that are NOT electronic
  (sticks, a guitar, a sword, furniture) get only their real physical parts - no controller or battery unless asked for.
- Use REAL part names in "name"/"spec" (e.g. "MG996R servo", "ESP32 DevKit", "2S LiPo 2200 mAh"). Common parts get their datasheet numbers looked up, so give mass_g / current_ma / voltage / torque_kgcm ONLY for unusual parts. Reference numbers: (MG996R: 55 g, 6 V, 11 kg·cm, 10/2500 mA; SG90: 9 g, 1.8 kg·cm; ESP32 DevKit: 10 g,
  80/240 mA at 3.3 V; 2S LiPo 2200 mAh: 120 g; HC-SR04: 9 g, 15 mA). Servos must be strong enough for the weight they move.
- motion.joints drives the joints for the simulation (walk: legs in a proper gait with phases; arm: a pick-and-place swing...).
- Animals/walkers: the BODY is horizontal along z (length) at leg height; legs hang straight DOWN from the body's underside and
  the feet touch the ground (y=0); necks/tails/heads attach at the body's ends. Parts touch their parent - nothing floats.
- Copy the REAL body plan: birds, penguins, humans and gorillas stand on 2 legs (an upright body, the legs under it); dogs and
  horses on 4; insects 6; spiders 8. The example below only shows the coordinate logic, not the body plan to use.
- Remember pos_mm is RELATIVE: a part on top of a body 80 mm tall sits at y=+40 + half its own height, not at the body's world height.
EXAMPLE (a 30 cm robot dog, abridged - follow this coordinate logic):
{"parts":[{"id":"body","shape":"rounded_box","size_mm":[110,70,260],"pos_mm":[0,190,0],"parent":null,"layer":"shell"},
 {"id":"fl_hip","shape":"servo","size_mm":[40,20,40],"pos_mm":[-60,-35,90],"parent":"body","joint":{"axis":"x","min":-40,"max":40},"layer":"actuator"},
 {"id":"fl_thigh","shape":"capsule","size_mm":[25,80,25],"pos_mm":[0,-45,0],"parent":"fl_hip","layer":"frame"},
 {"id":"fl_knee","shape":"servo","size_mm":[40,20,40],"pos_mm":[0,-45,0],"parent":"fl_thigh","joint":{"axis":"x","min":-70,"max":10},"layer":"actuator"},
 {"id":"fl_shin","shape":"capsule","size_mm":[20,70,20],"pos_mm":[0,-40,0],"parent":"fl_knee","layer":"frame"},
 {"id":"fl_foot","shape":"sphere","size_mm":[24,24,24],"pos_mm":[0,-40,0],"parent":"fl_shin","layer":"mechanical"},
 {"id":"neck","shape":"servo","size_mm":[40,20,40],"pos_mm":[0,40,125],"parent":"body","joint":{"axis":"y","min":-30,"max":30},"layer":"actuator"},
 {"id":"head","shape":"rounded_box","size_mm":[70,60,90],"pos_mm":[0,30,40],"parent":"neck","layer":"shell"}],
 "motion":{"type":"walk","speed_hz":0.9,"forward_mm_s":150,"joints":[{"id":"fl_hip","amp_deg":22,"phase":0},{"id":"fl_knee","amp_deg":25,"phase":0.25,"offset_deg":-20}]}}
(body bottom = 190-35 = 155; hip 155 -> thigh -> knee -> shin -> foot bottom ~= 0: the legs reach the ground.)
SHAPES: """ + ", ".join(SHAPES) + "\nMOTIONS: " + ", ".join(MOTIONS)

# realistic numbers for common parts (used when the AI leaves them out, and for the offline designs)
PART_DB = [  # regex, mass g, idle mA, peak mA, volts, torque kg·cm
    (r"mg996|ds3218|25 ?kg", 55, 10, 2500, 6, 11), (r"mg90|mg92", 14, 6, 700, 5, 2.2), (r"sg90|micro servo", 9, 5, 650, 5, 1.8),
    (r"xl330|xl-320|xl320", 18, 20, 900, 5, 2.4), (r"xl430|xm430|dynamixel", 57, 50, 1400, 12, 15),
    (r"2306|brushless|bldc", 32, 300, 25000, 15, 0), (r"tt gear|tt motor|1:48", 30, 120, 800, 6, 0.8), (r"jgb37|gear motor", 90, 150, 2000, 12, 10),
    (r"esp32", 10, 80, 240, 3.3, 0), (r"arduino mega", 37, 50, 200, 5, 0), (r"arduino uno|uno r3", 25, 45, 150, 5, 0), (r"nrf52", 3, 3, 15, 3.3, 0),
    (r"raspberry pi 5", 46, 600, 2500, 5, 0), (r"raspberry", 46, 400, 1500, 5, 0), (r"f405|flight controller", 8, 150, 300, 5, 0),
    (r"pca9685", 9, 10, 25, 5, 0), (r"l298", 26, 36, 70, 5, 0), (r"bts7960", 66, 20, 50, 5, 0), (r"esc", 16, 30, 100, 15, 0),
    (r"hc-sr04|ultrasonic", 9, 15, 15, 5, 0), (r"mpu6050|mpu-6050|imu", 2, 4, 4, 3.3, 0), (r"vl53", 1, 20, 40, 3.3, 0),
    (r"max30102|heart", 1, 1, 50, 3.3, 0), (r"ws2812|neopixel|led strip|led ring", 15, 20, 1800, 5, 0), (r"microphone|inmp441|mems", 1, 1, 2, 3.3, 0),
    (r"speaker", 25, 5, 500, 5, 0), (r"max98357|amplifier|pam8403", 3, 3, 600, 5, 0), (r"oled|amoled", 6, 10, 40, 3.3, 0),
    (r"tft|lcd", 30, 60, 120, 3.3, 0), (r"camera", 5, 100, 250, 3.3, 0),
    (r"lipo.*?(\d{3,5}) ?mah|(\d{3,5}) ?mah", 120, 0, 0, 7.4, 0), (r"18650", 46, 0, 0, 3.7, 0), (r"lifepo4", 1300, 0, 0, 12.8, 0),
    (r"buck|regulator|ubec|converter|step.?down|mt3608|tp4056", 10, 5, 10, 5, 0),
]
LAYER_MASS = {"shell": 60, "frame": 40, "mechanical": 15, "wiring": 5, "display": 30, "sensor": 5, "electronics": 10, "power": 20, "actuator": 30}


def part_data(p):
    """mass, current and torque for a part: what the AI said (clamped to sane numbers) or the parts database"""
    txt = f"{p.get('name', '')} {p.get('spec', '')}".lower()
    hit = next((row for row in PART_DB if re.search(row[0], txt)), None)
    mass = _num(p.get("mass_g"), 0.1, 50000, hit[1] if hit else LAYER_MASS.get(p.get("layer"), 20))
    cur = p.get("current_ma")
    idle, peak = (cur[0], cur[1]) if isinstance(cur, (list, tuple)) and len(cur) == 2 else (hit[2], hit[3]) if hit else (0, 0)
    out = {"mass_g": round(mass, 1), "current_ma": [round(_num(idle, 0, 60000, 0)), round(_num(peak, 0, 80000, 0))],
           "voltage": _num(p.get("voltage"), 0, 60, hit[4] if hit else 0), "torque_kgcm": _num(p.get("torque_kgcm"), 0, 500, hit[5] if hit else 0)}
    m = re.search(r"(\d{3,5})\s*mah", txt)
    if m: out["mah"] = int(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*a\b", txt)
    if m and p.get("layer") == "power": out["amps"] = float(m.group(1))
    return out


def _slug(s, i):
    s = re.sub(r"[^a-z0-9_]+", "_", str(s or "").lower()).strip("_")[:40]
    return s or f"part_{i}"


def _vec(v, lo, hi, default):
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        return list(default)
    return [round(_num(x, lo, hi, d), 2) for x, d in zip(v, default)]


def validate_geometry(g):
    """clamp the AI's 3D design into something the page can always draw. Returns None if it's unusable."""
    if not isinstance(g, dict):
        return None
    raw = [p for p in (g.get("parts") or []) if isinstance(p, dict)][:90]
    parts, seen = [], set()
    for i, p in enumerate(raw):
        pid = _slug(p.get("id") or p.get("name"), i)
        while pid in seen: pid += "_2"
        seen.add(pid)
        shape = p.get("shape") if p.get("shape") in SHAPES else "box"
        col = p.get("color")
        q = {"id": pid, "name": str(p.get("name") or pid)[:70], "layer": p.get("layer") if p.get("layer") in LAYERS else "frame",
             "shape": shape, "size": _vec(p.get("size_mm") or p.get("size"), 1, 4000, [40, 40, 40]),
             "pos": _vec(p.get("pos_mm") or p.get("pos"), -4000, 4000, [0, 0, 0]), "rot": _vec(p.get("rot_deg") or p.get("rot"), -360, 360, [0, 0, 0]),
             "color": col if isinstance(col, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", col) else None,
             "parent": p.get("parent") if isinstance(p.get("parent"), str) else None,
             "spec": str(p.get("spec") or "")[:90], "price": round(_num(p.get("price"), 0, 5000, 0), 2)}
        if shape in ("cylinder", "cone", "capsule", "wheel", "motor") and min(q["size"][0], q["size"][2]) < 0.15 * max(q["size"][0], q["size"][2]):
            q["size"][0] = q["size"][2] = max(q["size"][0], q["size"][2])     # round things are round: x and z are both the diameter
        j = p.get("joint")
        if isinstance(j, dict) and j.get("axis") in ("x", "y", "z"):
            q["joint"] = {"axis": j["axis"], "min": _num(j.get("min"), -180, 0, -60), "max": _num(j.get("max"), 0, 180, 60)}
        q.update(part_data({**p, "layer": q["layer"]}))
        parts.append(q)
    # parents must exist (a missing parent -> the part sits on the root); cut any loops
    ids = {p["id"] for p in parts}
    for p in parts:
        if p["parent"]:
            par = _slug(p["parent"], 0)
            p["parent"] = par if par in ids and par != p["id"] else None
    byid = {p["id"]: p for p in parts}
    for p in parts:
        seen_chain, cur = set(), p
        while cur and cur["parent"]:
            if cur["id"] in seen_chain: p["parent"] = None; break
            seen_chain.add(cur["id"]); cur = byid.get(cur["parent"])
    if not parts:                       # simple things are fine: a pair of escrima sticks is 2-4 parts
        return None
    # proportion guard: a head bigger than the body, or feet the size of footballs, never look right
    roots = [p for p in parts if not p["parent"]]
    body = max(roots or parts, key=lambda p: p["size"][0] * p["size"][1] * p["size"][2])
    big = max(body["size"])
    for p in parts:
        if p is body: continue
        name = (p["id"] + " " + p["name"]).lower()
        cap = 0.55 if re.search(r"head|skull|face", name) else 0.35 if re.search(r"foot|feet|paw|hoof|hand|toe", name) else None
        if cap:
            p["size"] = [min(v, big * cap) for v in p["size"]]
    _snap(parts)
    M = g.get("motion") or {}
    joints = [{"id": _slug(j.get("id"), 0), "amp": _num(j.get("amp_deg") or j.get("amp"), 0, 90, 20), "phase": _num(j.get("phase"), 0, 1, 0),
               "offset": _num(j.get("offset_deg") or j.get("offset"), -90, 90, 0)} for j in (M.get("joints") or []) if isinstance(j, dict)]
    joints = [j for j in joints if j["id"] in byid]
    for p in parts:                                          # every joint moves in the simulation, even if the AI forgot it
        if p.get("joint") and not any(j["id"] == p["id"] for j in joints):
            joints.append({"id": p["id"], "amp": 15, "phase": (len(joints) % 4) / 4, "offset": 0})
    spin = [{"id": _slug(s.get("id"), 0), "rpm": _num(s.get("rpm"), 1, 30000, 120)} for s in (M.get("spin") or []) if isinstance(s, dict)]
    spin = [s for s in spin if s["id"] in byid]
    motion = {"type": M.get("type") if M.get("type") in MOTIONS else "custom", "speed_hz": _num(M.get("speed_hz"), 0.1, 4, 0.9),
              "forward_mm_s": _num(M.get("forward_mm_s"), 0, 2000, 0), "joints": joints, "spin": spin}
    wires = [{"from": _slug(w.get("from"), 0), "to": _slug(w.get("to"), 0), "kind": w.get("kind") if w.get("kind") in ("power", "ground", "signal", "data") else "signal",
              "label": str(w.get("label") or "")[:60]} for w in (g.get("wires") or []) if isinstance(w, dict)]
    wires = [w for w in wires if w["from"] in byid and w["to"] in byid and w["from"] != w["to"]][:80]
    return {"parts": parts, "motion": motion, "wires": wires}


def bom_from_geometry(geo):
    """the parts list (one row per kind of part, with qty) from the 3D design; each 3D part knows its row"""
    rows, index = [], {}
    for p in geo["parts"]:
        key = (p["name"].lower(), p["layer"])
        if key not in index:
            index[key] = len(rows)
            rows.append({"name": p["name"], "layer": p["layer"], "spec": p["spec"], "qty": 0, "price": p["price"], "mount": "body",
                         **{k: p[k] for k in ("mass_g", "current_ma", "voltage", "torque_kgcm") if k in p}, **({"mah": p["mah"]} if p.get("mah") else {})})
        rows[index[key]]["qty"] += 1
        p["bom"] = index[key]
    return rows


def analyse(spec):
    """realistic numbers: weight, power budget, battery runtime and whether the motors are strong enough"""
    parts = spec["parts"]
    data = [(p, {**part_data(p), **{k: p[k] for k in ("mass_g", "current_ma", "torque_kgcm", "mah") if k in p}}) for p in parts]
    mass = sum(d["mass_g"] * p["qty"] for p, d in data)
    idle = sum(d["current_ma"][0] * p["qty"] for p, d in data)
    peak = sum(d["current_ma"][1] * p["qty"] for p, d in data)
    acts = [(p, d) for p, d in data if p["layer"] == "actuator"]
    typical = idle + sum(d["current_ma"][1] * 0.18 * p["qty"] for p, d in acts)          # motors average ~18% of their stall current
    batt = next(((p, d) for p, d in data if d.get("mah")), None)
    rows = [["Total weight", f"{mass / 1000:.2f} kg" if mass >= 1000 else f"{mass:.0f} g", "ok"],
            ["Typical current", f"{typical / 1000:.2f} A", "ok"], ["Peak current (everything at once)", f"{peak / 1000:.1f} A", "ok"]]
    if batt:
        mah = batt[1]["mah"]
        mins = mah * 0.8 / max(1, typical) * 60
        rows.append(["Battery", f"{mah} mAh ({batt[0]['name'][:30]})", "ok"])
        rows.append(["Runtime (estimated)", f"{mins:.0f} min", "ok" if mins >= 15 else "warn"])
    reg = next((d.get("amps") for p, d in data if p["layer"] == "power" and d.get("amps")), None)
    servo_peak = sum(d["current_ma"][1] * p["qty"] for p, d in acts if d.get("torque_kgcm")) / 1000
    if reg and servo_peak:
        rows.append(["Regulator vs servo peak", f"{reg:g} A vs {servo_peak:.1f} A", "ok" if reg >= servo_peak * 0.5 else "warn"])
    legs = int(spec.get("params", {}).get("legs") or 0) if spec.get("motion") == "walk" else 0
    torques = [d["torque_kgcm"] for p, d in acts if d.get("torque_kgcm")]
    if legs and torques:
        on_ground = 3 if legs >= 6 else max(1, legs // 2)
        leg_cm = 10 * float(spec.get("params", {}).get("scale") or 1)
        need = mass / 1000 / on_ground * leg_cm * 1.5                     # 1.5x for walking dynamics
        have = min(torques)
        rows.append(["Servo torque needed / available", f"{need:.1f} / {have:.1f} kg·cm", "ok" if have >= need else "warn"])
    return {"mass_g": round(mass), "idle_ma": round(idle), "typical_ma": round(typical), "peak_ma": round(peak), "rows": rows}


def _rot(deg):
    """3x3 rotation matrix from x/y/z degrees (applied x, then y, then z - like three.js 'XYZ')"""
    import math
    x, y, z = (math.radians(v) for v in deg)
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    mul = lambda A, B: [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    return mul(mul(Rx, Ry), Rz)


def world_boxes(geo):
    """where every part really ends up: {id: (min xyz, max xyz)} in mm (forward kinematics, rest pose)"""
    W = _transforms(geo["parts"])
    out = {}
    for p in geo["parts"]:
        R, T = W[p["id"]]
        h = [s / 2 for s in p["size"]]
        ext = [sum(abs(R[i][k]) * h[k] for k in range(3)) for i in range(3)]
        out[p["id"]] = ([T[i] - ext[i] for i in range(3)], [T[i] + ext[i] for i in range(3)])
    return out


def _pull(a, b):
    """the world shift (mm) that makes box a touch box b - 0 on the axes where they already overlap"""
    return [b[1][i] - a[0][i] if a[0][i] > b[1][i] else b[0][i] - a[1][i] if a[1][i] < b[0][i] else 0 for i in range(3)]


def _snap(parts):
    """a part that floats away from what it's attached to gets moved back until it touches. The AI's usual slip is giving
    a child its WORLD position instead of one relative to its parent, so that reading is tried first."""
    byid = {p["id"]: p for p in parts}
    depth = lambda p: 0 if not p["parent"] else 1 + depth(byid[p["parent"]])
    for p in sorted((p for p in parts if p["parent"]), key=depth):           # parents first: children move with them
        geo = {"parts": parts}
        boxes = world_boxes(geo)
        d = _pull(boxes[p["id"]], boxes[p["parent"]])
        if max(map(abs, d)) <= 15: continue
        PR, PT = _transforms(parts)[p["parent"]]
        old = p["pos"]
        p["pos"] = [round(sum(PR[k][i] * (old[k] - PT[k]) for k in range(3)), 2) for i in range(3)]   # world -> parent-relative
        boxes = world_boxes(geo)
        if max(map(abs, _pull(boxes[p["id"]], boxes[p["parent"]]))) <= 15: continue
        local = [sum(PR[k][i] * d[k] for k in range(3)) for i in range(3)]                      # else: slide it over until it touches
        p["pos"] = [round(old[i] + local[i], 2) for i in range(3)]


def _transforms(parts):
    """{id: (world rotation 3x3, world position)} for every part"""
    byid = {p["id"]: p for p in parts}
    W = {}

    def tf(p):
        if p["id"] in W: return W[p["id"]]
        R = _rot(p["rot"])
        if p["parent"] and p["parent"] in byid:
            PR, PT = tf(byid[p["parent"]])
            T = [PT[i] + sum(PR[i][k] * p["pos"][k] for k in range(3)) for i in range(3)]
            R = [[sum(PR[i][k] * R[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        else:
            T = list(p["pos"])
        W[p["id"]] = (R, T)
        return W[p["id"]]
    for p in parts:
        tf(p)
    return W


def geometry_problems(geo):
    """things that look wrong in the AI's layout: floating parts, gaps, legs that don't reach the ground"""
    boxes = world_boxes(geo)
    byid = {p["id"]: p for p in geo["parts"]}
    low = min(b[0][1] for b in boxes.values())
    probs = []
    for p in geo["parts"]:
        if not p["parent"]: continue
        a, b = boxes[p["id"]], boxes[p["parent"]]
        gap = max(max(a[0][i] - b[1][i], b[0][i] - a[1][i], 0) for i in range(3))
        if gap > 15:
            probs.append(f"'{p['id']}' floats {gap:.0f} mm away from its parent '{p['parent']}' - it should touch it")
    feet = [p for p in geo["parts"] if re.search(r"foot|feet|paw|hoof|wheel|track|base|stand|leg_end|toe", p["id"] + p["name"].lower())]
    if feet:
        for p in feet:
            y = boxes[p["id"]][0][1] - low
            if y > 25 and byid[p["id"]]["shape"] != "propeller":
                probs.append(f"'{p['id']}' is {y:.0f} mm above the lowest point - feet/wheels/stands must reach the ground")
    tall = max(b[1][1] for b in boxes.values()) - low
    wide = max(max(b[1][0] for b in boxes.values()) - min(b[0][0] for b in boxes.values()),
               max(b[1][2] for b in boxes.values()) - min(b[0][2] for b in boxes.values()))
    return probs[:25], {"height_mm": round(tall), "footprint_mm": round(wide)}


def _layout_text(geo):
    boxes = world_boxes(geo)
    return "\n".join(f"{p['id']} ({p['shape']}): world min {[round(v) for v in boxes[p['id']][0]]} max {[round(v) for v in boxes[p['id']][1]]}"
                     for p in geo["parts"][:70])


def _loads_tolerant(text):
    """the AI's JSON - and if it was cut off (ran out of room), keep every complete part and close it properly"""
    s = text[text.find("{"):] if "{" in (text or "") else ""
    if not s:
        return None
    end = s.rfind("}")
    try:
        return json.loads(s[:end + 1])
    except ValueError:
        pass
    i = s.find('"parts"')
    if i < 0:
        return None
    # cut after the last complete part object  {...}  inside "parts": [...]
    depth, last_ok, in_str, esc = 0, -1, False, False
    start = s.find("[", i)
    for k in range(start + 1, len(s)):
        c = s[k]
        if in_str:
            esc = (c == "\\" and not esc)
            if c == '"' and not esc: in_str = False
            continue
        if c == '"': in_str = True
        elif c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: last_ok = k
        elif c == "]" and depth == 0: break
    if last_ok < 0:
        return None
    try:
        d = json.loads(s[:last_ok + 1] + "]}")
        print(f"[builder] the AI's answer was cut off - kept the {len(d.get('parts', []))} complete parts.")
        return d
    except ValueError:
        return None


def _ask_fast(messages, max_tokens=5600, temperature=0.4, model="smart"):
    """the online AI only (Groq) - a 3D design on the slow local AI would take many minutes. A short rate limit
    (Groq's per-minute token budget) is waited out once instead of switching to the local AI."""
    import llm
    import time as _t
    if not llm.groq_available():
        raise RuntimeError("the online AI isn't available right now")
    for attempt in range(2):
        try:
            r = llm._groq_create(model=model, messages=messages, max_tokens=max_tokens, temperature=temperature)
            return r.choices[0].message.content or ""
        except llm.GroqLimitError as e:
            if attempt or e.wait_seconds > 65:
                raise
            _t.sleep(e.wait_seconds + 1)


def ai_geometry(prompt):
    """the AI designs the 3D model, then checks where every part really lands and fixes what's wrong (one more round)"""
    sysmsg = GEO_SYSTEM + "\nLAYERS: " + ", ".join(LAYERS)
    plan = TEMPLATES.get(classify(prompt), {})
    hint = f"\n(Body plan: {plan['name'].lower()}.)" if plan.get("kind") == "robot" and re.search(plan["words"], prompt.lower()) else ""
    text = _ask_fast([{"role": "system", "content": sysmsg}, {"role": "user", "content": prompt + hint}])
    raw = _loads_tolerant(text)
    if not raw:
        return None
    geo = validate_geometry(raw)
    if not geo:
        return raw
    probs, size = geometry_problems(geo)
    # round 2: only the layout, only the fixes (small in, small out)
    compact = [{"id": p["id"], "shape": p["shape"], "size_mm": p["size"], "pos_mm": p["pos"], "rot_deg": p["rot"], "parent": p["parent"]} for p in geo["parts"]]
    fix = (f"A 3D design for: {prompt}\nParts (pos_mm is relative to the parent; shapes are centred on their origin; y up, ground y=0):\n"
           f"{json.dumps(compact, separators=(',', ':'))}\n\nWhere they landed in the world (mm):\n{_layout_text(geo)}\n\n"
           f"Overall: {size['height_mm']} mm tall, {size['footprint_mm']} mm across.\nProblems:\n- " + "\n- ".join(probs or ["none found by the checker"]) +
           f"\n\nAlso check the PROPORTIONS against what a real {prompt.split('create ')[-1]} looks like (e.g. a giraffe has a very long neck and long legs and a small head, a gorilla long arms and a broad chest, glasses two lenses joined by a bridge) and fix anything that does not look like it." +
           '\n\nFix it so it looks right and every part touches what it is attached to. Answer ONLY with JSON: '
           '{"parts": [{"id": ..., "pos_mm": [...], "size_mm": [...], "rot_deg": [...]}]} listing just the parts you change.')
    try:
        t2 = _ask_fast([{"role": "system", "content": "You fix 3D layouts. Reply with JSON only."}, {"role": "user", "content": fix}], max_tokens=2500, temperature=0.2, model="chat")
        m2 = re.search(r"\{.*\}", t2, re.S)
        if m2:
            patch = {_slug(p.get("id"), 0): p for p in json.loads(m2.group(0)).get("parts", []) if isinstance(p, dict)}
            raw2 = dict(raw, parts=[dict(p, **{k: patch[_slug(p.get("id") or p.get("name"), 0)][k] for k in ("pos_mm", "size_mm", "rot_deg")
                                                if _slug(p.get("id") or p.get("name"), 0) in patch and k in patch[_slug(p.get("id") or p.get("name"), 0)]})
                                    for p in raw.get("parts", []) if isinstance(p, dict)])
            geo2 = validate_geometry(raw2)
            if geo2 and len(geometry_problems(geo2)[0]) <= len(probs):
                return raw2
    except Exception as e:
        print(f"[builder] layout fix round skipped ({e.__class__.__name__}: {e})")
    return raw


def design(prompt, use_ai=True):
    """-> a validated build spec. Online: the AI designs the real 3D model (any robot or device). If that fails, the AI
    picks a body plan; offline, the built-in designer does."""
    prompt = (prompt or "").strip()[:400]
    if not prompt:
        return {"error": "Describe what to build, e.g. “create a robot dog” or “build a smart TV”."}
    if use_ai:
        # a long, detailed answer sometimes comes back broken - then ask once more for a simpler one
        for extra in ("", "\n(Keep the JSON short: at most 30 parts, steps of one line each.)"):
            try:
                raw = ai_geometry(prompt + extra)
                geo = validate_geometry(raw)
                if geo:
                    spec = custom_spec(raw, geo, prompt)
                    spec["source"] = "ai"
                    return spec
            except Exception as e:
                print(f"[builder] AI 3D design failed ({e.__class__.__name__}: {e}).")
                if "isn't available" in str(e):
                    break
        # a pre-made body plan only when it really is that kind of thing (never a "round device" for escrima sticks)
        if not re.search(TEMPLATES[classify(prompt)]["words"], prompt.lower()):
            spec = offline_design(prompt)
            spec["analysis"] = analyse(spec)
            return spec
        try:
            text = _ask_fast([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], max_tokens=2500)
            m = re.search(r"\{.*\}", text, re.S)
            if m:
                spec = validate(json.loads(m.group(0)), prompt)
                spec["name"] = _keep_name(spec["name"], prompt, spec["template"])     # no made-up "Mini"/"Desktop"
                spec["source"] = "ai"
                spec["analysis"] = analyse(spec)
                return spec
        except Exception as e:
            print(f"[builder] AI design failed ({e.__class__.__name__}) - using the offline designer.")
    spec = offline_design(prompt)
    spec["analysis"] = analyse(spec)
    return spec


def custom_spec(raw, geo, prompt):
    """an AI 3D design -> the full spec (parts list, firmware, analysis) the page needs"""
    t = classify(prompt)
    kind = raw.get("kind") if raw.get("kind") in ("robot", "device") else TEMPLATES[t]["kind"]
    bom = bom_from_geometry(geo)
    motion = geo["motion"]["type"]
    legs = sum(1 for p in geo["parts"] if p.get("joint") and re.search(r"hip|thigh|upper.?leg|coxa", p["id"] + p["name"].lower()))
    spec = {"name": _keep_name(raw.get("name"), prompt, t), "template": "custom", "kind": kind,
            "motion": motion if motion != "custom" else TEMPLATES[t]["motion"], "summary": str(raw.get("summary") or "")[:400],
            "params": {"color": "#e4e7ec", "accent": "#e0475b", "scale": 1, "length": 1, "legs": legs or (4 if t == "quadruped" else 0)},
            "parts": bom, "steps": [str(s)[:240] for s in (raw.get("steps") or []) if str(s).strip()][:14] or default_steps(t),
            "cost": round(sum(p["qty"] * p["price"] for p in bom), 2), "prompt": prompt[:300], "geometry": geo, "base_template": t}
    spec["code"] = sketch({**spec, "template": t if spec["motion"] in ("walk", "drive", "arm", "fly", "slither", "swim") else t})
    spec["analysis"] = analyse(spec)
    return spec


# ---------------------------------------------------------------- saved builds
def _safe(name):
    n = re.sub(r"[^\w\- ]+", "", str(name or "")).strip()[:60]
    return n or time.strftime("Build %Y-%m-%d %H%M")


def list_projects():
    os.makedirs(PROJECTS, exist_ok=True)
    out = []
    for f in os.listdir(PROJECTS):
        if f.endswith(".json"):
            p = os.path.join(PROJECTS, f)
            out.append({"name": f[:-5], "saved": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p)))})
    return sorted(out, key=lambda x: x["saved"], reverse=True)


def save_project(spec):
    os.makedirs(PROJECTS, exist_ok=True)
    name = _safe((spec or {}).get("name"))
    path = os.path.join(PROJECTS, name + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return {"name": name, "projects": list_projects()}


def load_project(name):
    path = os.path.join(PROJECTS, _safe(name) + ".json")
    if not os.path.exists(path):
        return {"error": "Build not found."}
    with open(path, encoding="utf-8") as f:
        return {"spec": validate(json.load(f))}


def delete_project(name):
    path = os.path.join(PROJECTS, _safe(name) + ".json")
    if os.path.exists(path):
        os.remove(path)
    return {"projects": list_projects()}
