"""
electronics.py - the Robotics & Electronics assistant.

  - calculators for the basic formulas (Ohm's law, LED resistor, voltage divider, RC, 555 timer, batteries,
    resistor colour codes, gears/wheels...), each answer shows the formula and the steps
  - an AI helper with four jobs: fix old electronics, repurpose them into something new, plan a robot from start
    to finish (it can also send the circuit to the Circuit Lab), and answer general questions
  - saving/loading Circuit Lab projects (data/electronics/*.json)
Safety comes first: mains power, microwave/CRT/flash capacitors and lithium batteries always get a warning.
"""
import json
import math
import os
import re
import time

from paths import data_file

PROJECTS = data_file("electronics")

# ====================================================================== formulas
E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
COLORS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"]
MULT = {**{c: 10 ** i for i, c in enumerate(COLORS)}, "gold": 0.1, "silver": 0.01}
TOL = {"brown": "±1%", "red": "±2%", "green": "±0.5%", "blue": "±0.25%", "violet": "±0.1%", "gold": "±5%", "silver": "±10%", "none": "±20%"}
AWG_OHM_PER_M = {10: 0.00328, 12: 0.00521, 14: 0.00829, 16: 0.0132, 18: 0.0210, 20: 0.0333, 22: 0.0530, 24: 0.0842, 26: 0.134, 28: 0.213, 30: 0.339}

PREFIX = [(1e9, "G"), (1e6, "M"), (1e3, "k"), (1, ""), (1e-3, "m"), (1e-6, "µ"), (1e-9, "n"), (1e-12, "p")]


def fmt(v, unit=""):
    """1500, 'Ω' -> '1.5 kΩ'"""
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return "—"
    if v == 0:
        return f"0 {unit}".strip()
    for k, p in PREFIX:
        if abs(v) >= k * 0.9999:
            n = v / k
            return f"{n:.3g} {p}{unit}".strip()
    return f"{v:.3g} {unit}".strip()


def parse(v):
    """'4.7k' -> 4700, '100n' -> 1e-7, '2.2 µF' -> 2.2e-6, '' -> None"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("Ω", "").replace("ohm", "").replace("ohms", "")
    if not s:
        return None
    m = re.fullmatch(r"([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([GMkKmuµnp]?)\s*[A-Za-z]*", s)
    if not m:
        raise ValueError(f"'{v}' isn't a number")
    mult = {"G": 1e9, "M": 1e6, "k": 1e3, "K": 1e3, "m": 1e-3, "u": 1e-6, "µ": 1e-6, "n": 1e-9, "p": 1e-12, "": 1}[m.group(2)]
    return float(m.group(1)) * mult


def nearest_e12(r, up=True):
    """the closest standard resistor value (E12), rounding up by default (safer for LEDs)"""
    if r <= 0:
        return 0
    d = 10 ** math.floor(math.log10(r))
    vals = [x * d for x in E12] + [10 * d]
    if up:
        return next(x for x in vals if x >= r * 0.999)
    return min(vals, key=lambda x: abs(x - r))


def color_bands(r):
    """resistance -> 4-band colours"""
    if r < 1:
        return None
    exp = math.floor(math.log10(r)) - 1
    digits = round(r / 10 ** exp)
    if digits >= 100:
        digits //= 10
        exp += 1
    return [COLORS[digits // 10], COLORS[digits % 10], COLORS[exp] if 0 <= exp < 10 else ("gold" if exp == -1 else "silver"), "gold"]


FORMULAS = {
    "ohm": {"name": "Ohm's law & power", "help": "Fill in any TWO values; the rest is worked out.",
            "fields": [["V", "Voltage", "V"], ["I", "Current", "A"], ["R", "Resistance", "Ω"], ["P", "Power", "W"]]},
    "led": {"name": "LED resistor", "help": "Which resistor keeps an LED safe.",
            "fields": [["Vs", "Supply voltage", "V", "5"], ["Vf", "LED forward voltage (red 2, green/yellow 2.1, blue/white 3.1)", "V", "2"],
                       ["I", "LED current (normal 10-20 mA)", "mA", "15"], ["n", "LEDs in series", "", "1"]]},
    "divider": {"name": "Voltage divider", "help": "Vout = Vin × R2 / (R1 + R2). Leave Vout empty to compute it, or leave R1 empty to find R1.",
                "fields": [["Vin", "Input voltage", "V", "9"], ["R1", "Top resistor R1", "Ω", "10k"], ["R2", "Bottom resistor R2", "Ω", "10k"], ["Vout", "Wanted output", "V"]]},
    "series_parallel": {"name": "Resistors in series / parallel", "help": "Values separated by commas, e.g. 220, 1k, 4.7k",
                        "fields": [["list", "Resistors", "Ω", "1k, 1k, 2.2k"]]},
    "rc": {"name": "RC time constant & filter", "help": "How fast a capacitor charges through a resistor, and the filter's cut-off frequency.",
           "fields": [["R", "Resistance", "Ω", "10k"], ["C", "Capacitance", "F", "100u"], ["Vs", "Supply (optional)", "V", "5"]]},
    "timer555": {"name": "555 timer (astable blinker)", "help": "Frequency and duty cycle of a 555 oscillator.",
                 "fields": [["R1", "R1", "Ω", "1k"], ["R2", "R2", "Ω", "10k"], ["C", "C", "F", "10u"]]},
    "battery": {"name": "Battery life", "help": "Roughly how long a battery lasts (70% of the label, real batteries never give 100%).",
                "fields": [["mAh", "Battery capacity", "mAh", "2000"], ["mA", "Average current draw", "mA", "150"], ["V", "Battery voltage (optional)", "V", "7.4"]]},
    "cap_energy": {"name": "Capacitor energy & charge", "help": "Energy stored: E = ½CV². ⚠ Big or high-voltage caps can hurt - discharge them safely.",
                   "fields": [["C", "Capacitance", "F", "1000u"], ["V", "Voltage", "V", "25"]]},
    "reactance": {"name": "Reactance (AC)", "help": "Capacitor Xc = 1/(2πfC), inductor XL = 2πfL. Fill frequency and C and/or L.",
                  "fields": [["f", "Frequency", "Hz", "1k"], ["C", "Capacitance", "F", "1u"], ["L", "Inductance", "H"]]},
    "ac": {"name": "AC peak / RMS", "help": "Mains in the Philippines is 220-230 V RMS, 60 Hz - that's about 325 V peak. ⚠ Lethal.",
           "fields": [["Vrms", "RMS voltage", "V", "230"], ["Vpeak", "Peak voltage", "V"]]},
    "wire": {"name": "Wire voltage drop", "help": "How many volts a wire loses (both ways: there and back).",
             "fields": [["length", "Cable length (one way)", "m", "2"], ["awg", "Wire size (AWG 10-30)", "AWG", "22"], ["I", "Current", "A", "1"], ["V", "Supply voltage", "V", "12"]]},
    "colors": {"name": "Resistor colour code", "help": "Type a value (e.g. 4.7k) to get the colours, OR the colours (e.g. yellow violet red gold) to get the value.",
               "fields": [["value", "Resistance", "Ω", "4.7k"], ["bands", "…or colours", ""]]},
    "gear": {"name": "Gears & motor torque", "help": "A gearbox trades speed for torque.",
             "fields": [["rpm", "Motor speed", "rpm", "6000"], ["torque", "Motor torque", "kg·cm", "0.5"], ["ratio", "Gear ratio (e.g. 48 for 1:48)", ":1", "48"], ["eff", "Gearbox efficiency", "%", "70"]]},
    "wheel": {"name": "Robot wheel speed", "help": "How fast a robot drives.",
              "fields": [["rpm", "Wheel rpm (after the gearbox)", "rpm", "125"], ["d", "Wheel diameter", "mm", "65"]]},
    "power_budget": {"name": "Robot power budget", "help": "Add up everything that draws current: 'name current_mA' per line.",
                     "fields": [["items", "Parts", "", "Arduino 50\n2x TT motor 400\nServo 250\nHC-SR04 15"], ["mAh", "Battery capacity", "mAh", "2000"]]},
}


def calc(kind, values):
    """-> {'results': [[label, value]], 'steps': [...], 'notes': [...]} or {'error'}"""
    try:
        return _calc(kind, values or {})
    except ZeroDivisionError:
        return {"error": "That would divide by zero - check the values."}
    except (ValueError, KeyError) as e:
        return {"error": str(e).strip("'")}


def _calc(kind, v):
    g = lambda k: parse(v.get(k))           # noqa: E731
    out = {"results": [], "steps": [], "notes": []}
    R, S, N = out["results"].append, out["steps"].append, out["notes"].append
    if kind == "ohm":
        V, I, Rr, P = g("V"), g("I"), g("R"), g("P")
        known = sum(x is not None for x in (V, I, Rr, P))
        if known < 2:
            return {"error": "Fill in at least two of V, I, R, P."}
        if V is not None and I is not None:
            Rr, P = V / I, V * I; S(f"R = V / I = {fmt(V, 'V')} / {fmt(I, 'A')}"); S("P = V × I")
        elif V is not None and Rr is not None:
            I, P = V / Rr, V * V / Rr; S(f"I = V / R = {fmt(V, 'V')} / {fmt(Rr, 'Ω')}"); S("P = V² / R")
        elif I is not None and Rr is not None:
            V, P = I * Rr, I * I * Rr; S(f"V = I × R = {fmt(I, 'A')} × {fmt(Rr, 'Ω')}"); S("P = I² × R")
        elif P is not None and V is not None:
            I, Rr = P / V, V * V / P; S("I = P / V"); S("R = V² / P")
        elif P is not None and I is not None:
            V, Rr = P / I, P / (I * I); S("V = P / I"); S("R = P / I²")
        elif P is not None and Rr is not None:
            V, I = math.sqrt(P * Rr), math.sqrt(P / Rr); S("V = √(P × R)"); S("I = √(P / R)")
        R(["Voltage", fmt(V, "V")]); R(["Current", fmt(I, "A")]); R(["Resistance", fmt(Rr, "Ω")]); R(["Power", fmt(P, "W")])
        if P and P > 0.25 and Rr:
            N(f"A normal ¼ W resistor is too small here - use at least a {'½' if P < 0.45 else '1' if P < 0.9 else str(math.ceil(P * 2))} W resistor.")
    elif kind == "led":
        Vs, Vf, I, n = g("Vs"), g("Vf"), (g("I") or 15) / 1000, int(g("n") or 1)
        drop = Vs - Vf * n
        if drop <= 0:
            return {"error": f"{n} LED(s) need {Vf * n:.1f} V but the supply is only {Vs} V - use fewer LEDs in series or a higher voltage."}
        r = drop / I
        std = nearest_e12(r)
        S(f"R = (Vs − n×Vf) / I = ({Vs} − {n}×{Vf}) / {I * 1000:g} mA = {fmt(r, 'Ω')}")
        S(f"Next standard value up (E12): {fmt(std, 'Ω')}")
        p = drop * drop / std
        R(["Exact resistor", fmt(r, "Ω")]); R(["Use this resistor", fmt(std, "Ω")]); R(["Real current", fmt(drop / std, "A")])
        R(["Resistor power", fmt(p, "W")]); R(["Colour bands", " ".join(color_bands(std) or [])])
        if p > 0.2:
            N("The resistor gets warm - use a ½ W one.")
    elif kind == "divider":
        Vin, R1, R2, Vout = g("Vin"), g("R1"), g("R2"), g("Vout")
        if Vout is not None and R2 is not None and (R1 is None):
            R1 = R2 * (Vin - Vout) / Vout; S("R1 = R2 × (Vin − Vout) / Vout")
            R(["R1 needed", fmt(R1, "Ω")]); R(["Nearest standard", fmt(nearest_e12(R1, up=False), "Ω")])
        else:
            Vout = Vin * R2 / (R1 + R2); S(f"Vout = {Vin} × {fmt(R2, 'Ω')} / ({fmt(R1, 'Ω')} + {fmt(R2, 'Ω')})")
            R(["Vout", fmt(Vout, "V")]); R(["Current through divider", fmt(Vin / (R1 + R2), "A")])
        N("A divider can't power anything that draws current (motors, LEDs) - use it for sensing / signal levels only.")
    elif kind == "series_parallel":
        vals = [parse(x) for x in re.split(r"[,;\s]+", str(v.get("list") or "")) if x.strip()]
        if not vals:
            return {"error": "Type some resistor values."}
        R(["Series (one after another)", fmt(sum(vals), "Ω")]); R(["Parallel (side by side)", fmt(1 / sum(1 / x for x in vals), "Ω")])
        S("Series: R = R1 + R2 + …"); S("Parallel: 1/R = 1/R1 + 1/R2 + …")
    elif kind == "rc":
        Rr, C, Vs = g("R"), g("C"), g("Vs")
        tau = Rr * C
        R(["Time constant τ = R×C", fmt(tau, "s")]); R(["≈ fully charged (5τ)", fmt(5 * tau, "s")]); R(["Cut-off frequency 1/(2πRC)", fmt(1 / (2 * math.pi * tau), "Hz")])
        if Vs:
            R(["Voltage after 1τ (63%)", fmt(Vs * 0.632, "V")])
        S("After 1τ the capacitor is at 63%, after 5τ at 99%.")
    elif kind == "timer555":
        R1, R2, C = g("R1"), g("R2"), g("C")
        f = 1.44 / ((R1 + 2 * R2) * C)
        R(["Frequency", fmt(f, "Hz")]); R(["Period", fmt(1 / f, "s")]); R(["Duty cycle (on time)", f"{100 * (R1 + R2) / (R1 + 2 * R2):.1f} %"])
        R(["High time", fmt(0.693 * (R1 + R2) * C, "s")]); R(["Low time", fmt(0.693 * R2 * C, "s")])
        S("f = 1.44 / ((R1 + 2·R2) × C)")
    elif kind == "battery":
        cap, I, V = g("mAh"), g("mA"), g("V")
        h = cap * 0.7 / I
        R(["Runtime (realistic)", f"{h:.1f} h ({h * 60:.0f} min)"]); R(["Runtime (label, ideal)", f"{cap / I:.1f} h"])
        if V:
            R(["Energy", fmt(cap / 1000 * V, "Wh")])
        S("hours ≈ capacity × 0.7 / current")
    elif kind == "cap_energy":
        C, V = g("C"), g("V")
        E = 0.5 * C * V * V
        R(["Energy", fmt(E, "J")]); R(["Charge Q = C×V", fmt(C * V, "C")])
        if E > 1 or V > 60:
            N("⚠ This can give a painful or dangerous shock. Discharge through a resistor (e.g. 1-10 kΩ, 5 W) with insulated leads, and measure before touching.")
    elif kind == "reactance":
        f, C, L = g("f"), g("C"), g("L")
        if C:
            R(["Capacitor Xc", fmt(1 / (2 * math.pi * f * C), "Ω")])
        if L:
            R(["Inductor XL", fmt(2 * math.pi * f * L, "Ω")])
        if C and L:
            R(["Resonant frequency", fmt(1 / (2 * math.pi * math.sqrt(L * C)), "Hz")])
        if not (C or L):
            return {"error": "Fill in C and/or L."}
    elif kind == "ac":
        Vr, Vp = g("Vrms"), g("Vpeak")
        if Vr is not None:
            Vp = Vr * math.sqrt(2)
        elif Vp is not None:
            Vr = Vp / math.sqrt(2)
        else:
            return {"error": "Fill in one of them."}
        R(["RMS", fmt(Vr, "V")]); R(["Peak", fmt(Vp, "V")]); R(["Peak-to-peak", fmt(2 * Vp, "V")])
        if Vr > 50:
            N("⚠ Above 50 V AC is dangerous. Never work on mains-powered circuits while plugged in.")
    elif kind == "wire":
        L, awg, I, V = g("length"), int(g("awg") or 22), g("I"), g("V")
        if awg not in AWG_OHM_PER_M:
            return {"error": "Use an even AWG between 10 and 30."}
        rw = AWG_OHM_PER_M[awg] * L * 2
        drop = rw * I
        R(["Wire resistance (there and back)", fmt(rw, "Ω")]); R(["Voltage lost", fmt(drop, "V")])
        if V:
            R(["Voltage at the end", fmt(V - drop, "V")]); R(["Loss", f"{100 * drop / V:.1f} %"])
            if drop / V > 0.05:
                N("More than 5% is lost - use a thicker wire (smaller AWG number).")
    elif kind == "colors":
        if (v.get("bands") or "").strip():
            b = [x.lower() for x in re.split(r"[\s,]+", v["bands"].strip()) if x]
            b = ["grey" if x == "gray" else "violet" if x == "purple" else x for x in b]
            if len(b) < 3:
                return {"error": "Give at least 3 colours."}
            if len(b) >= 5:
                val = (COLORS.index(b[0]) * 100 + COLORS.index(b[1]) * 10 + COLORS.index(b[2])) * MULT[b[3]]
                tol = TOL.get(b[4], "")
            else:
                val = (COLORS.index(b[0]) * 10 + COLORS.index(b[1])) * MULT[b[2]]
                tol = TOL.get(b[3] if len(b) > 3 else "none", "")
            R(["Value", fmt(val, "Ω")]); R(["Tolerance", tol])
        else:
            val = g("value")
            bands = color_bands(val)
            if not bands:
                return {"error": "Use 1 Ω or more."}
            R(["Colour bands", " ".join(bands)]); R(["Value", fmt(val, "Ω")])
        S("Read from the side away from the gold/silver band.")
    elif kind == "gear":
        rpm, t, ratio, eff = g("rpm"), g("torque"), g("ratio"), (g("eff") or 100) / 100
        R(["Output speed", f"{rpm / ratio:.1f} rpm"]); R(["Output torque", f"{t * ratio * eff:.2f} kg·cm"])
        S("speed ÷ ratio, torque × ratio × efficiency")
    elif kind == "wheel":
        rpm, d = g("rpm"), g("d")
        ms = rpm * math.pi * d / 1000 / 60
        R(["Speed", f"{ms:.2f} m/s ({ms * 3.6:.1f} km/h)"]); R(["Distance per turn", f"{math.pi * d:.0f} mm"])
    elif kind == "power_budget":
        total, lines = 0.0, []
        for line in str(v.get("items") or "").splitlines():
            m = re.match(r"\s*(?:(\d+)\s*[x×]\s*)?(.+?)\s+(\d+(?:\.\d+)?)\s*(?:mA)?\s*$", line)
            if m:
                cnt = int(m.group(1) or 1)
                ma = cnt * float(m.group(3))
                total += ma
                lines.append(f"{m.group(2)}: {ma:g} mA")
        cap = g("mAh")
        R(["Total current", f"{total:g} mA"]); R(["Peak with 30% margin", f"{total * 1.3:.0f} mA"])
        if cap:
            R(["Runtime", f"{cap * 0.7 / max(total, 1):.1f} h"])
        out["steps"] = lines
        if total > 450:
            N("More than ~450 mA: don't power motors from the Arduino's 5V pin - give motors their own supply (shared GND).")
    else:
        return {"error": "Unknown calculator."}
    return out


def formulas_list():
    return {k: {"name": f["name"], "help": f["help"], "fields": f["fields"]} for k, f in FORMULAS.items()}


def calc_text(kind, values):
    """for the voice/chat AI tool"""
    r = calc(kind, values)
    if r.get("error"):
        return r["error"]
    return "; ".join(f"{a}: {b}" for a, b in r["results"]) + (" Note: " + " ".join(r["notes"]) if r["notes"] else "")


# ====================================================================== the AI helper
SYSTEM = """You are Vermeil's Robotics & Electronics assistant - an experienced repair technician, maker and robotics engineer
who teaches beginners. The user is in the Philippines (230 V / 60 Hz mains; parts from e-Gizmo, Alexan, Deeco, Lazada, Shopee).
Rules:
- SAFETY FIRST and always: unplug before opening anything; mains (230 V) can kill; microwave ovens, CRT TVs, camera flashes and
  power-supply capacitors stay charged after unplugging - explain how to discharge safely; swollen or damaged lithium batteries:
  don't puncture/charge; work in ventilated areas when soldering. Put warnings at the top when they apply.
- Beginner-friendly: numbered steps, say exactly which tool to use and what reading to expect (e.g. "multimeter on 20 V DC").
- Show the formula and the numbers whenever you calculate something (Ohm's law, LED resistors, power, battery life...).
- Use Markdown: short headings, lists, tables for parts and wiring, ```cpp code blocks for Arduino code.
- Be honest about what you don't know from a description; tell them what to measure so you can narrow it down."""

MODES = {
    "repair": "Help FIX this old/broken device. Structure: ⚠ Safety; Likely causes (most likely first); Tools needed; "
              "Step-by-step diagnosis with the multimeter readings to expect; How to fix each cause; When it's not worth fixing.",
    "repurpose": "Help REPURPOSE this old device/salvaged parts into something new and useful. Structure: ⚠ Safety; What's inside "
                 "worth saving (and how to test each part); 4-6 project ideas from easy to hard (what it does, extra parts + rough "
                 "cost in PHP); then a full build guide for the best idea.",
    "robot": "Plan a ROBOT from start to finish. Structure: 1 Goal & specs; 2 How it works (block diagram in a text list); 3 Parts list "
             "table (part, qty, why, rough PHP price); 4 Power budget (show the maths); 5 Wiring table (from pin -> to pin); 6 Full "
             "Arduino code (commented); 7 Build steps; 8 Testing & troubleshooting; 9 Upgrade ideas. Prefer an Arduino Uno, L298N or "
             "L293D motor driver, TT gear motors, HC-SR04, SG90 servos unless asked otherwise.",
    "general": "Answer the electronics/robotics question clearly.",
    "circuit": "Look at the user's Circuit Lab circuit (parts, connections, code and the simulator readings below). Explain what it "
               "does, find mistakes (missing resistor, short circuit, wrong pin, LED backwards, code bugs) and say exactly how to fix them.",
}

LAB_SCHEMA = """Also design the circuit for the Circuit Lab simulator. After your answer, add ONE fenced block exactly like:
```lab
{"parts": [{"id": "uno", "type": "uno"}, {"id": "r1", "type": "resistor", "props": {"ohms": 220}}, {"id": "led1", "type": "led", "props": {"color": "red"}}],
 "wires": [["uno.D13", "r1.1"], ["r1.2", "led1.A"], ["led1.K", "uno.GND"]],
 "code": "<the Arduino code>"}
```
Part types and their pins: uno/nano/mega/leonardo/promini/micro (D0-D13, A0-A5, 5V, 3V3, GND, VIN; mega also D14-D53, A6-A15), resistor (1,2; props ohms),
led (A anode, K cathode; props color red/green/blue/yellow/white), rgbled (R,G,B,K), button (1,2), switch (COM,A,B), pot (1,W,2; props ohms),
ldr (1,2), capacitor (+,-; props farads), diode (A,K), npn (B,C,E), nmos (G,D,S), motor (+,-), servo (SIG,V+,GND), buzzer (+,-),
battery9v (+,-), aa4 (+,-), hcsr04 (VCC,TRIG,ECHO,GND), tmp36 (VS,OUT,GND), l293d (EN1,IN1,OUT1,OUT2,IN2,EN2,IN3,OUT3,OUT4,IN4,VCC1,VCC2,GND),
multimeter (COM,V). Keep it to what the simulator can run: digitalWrite/Read, analogWrite/Read, delay, millis, Serial, Servo, tone, pulseIn."""


def ask(mode, question, context=None):
    """-> {'answer': markdown, 'lab': {circuit} or None}"""
    mode = mode if mode in MODES else "general"
    q = (question or "").strip()
    if not q and mode != "circuit":
        return {"error": "Describe the device, the problem or the robot you want."}
    prompt = f"TASK: {MODES[mode]}\n\n"
    if context:
        prompt += f"CIRCUIT LAB (what the user built):\n{json.dumps(context, ensure_ascii=False)[:6000]}\n\n"
    prompt += f"USER: {q or 'Check my circuit.'}"
    if mode in ("robot", "repurpose") or re.search(r"\b(lab|simulat|circuit)\b", q, re.I):
        prompt += "\n\n" + LAB_SCHEMA
    import llm
    try:
        r = llm.get_client().chat.completions.create(model="smart", messages=[{"role": "system", "content": SYSTEM},
                                                                               {"role": "user", "content": prompt}])
        answer = r.choices[0].message.content or ""
    except Exception as e:
        return {"error": f"The AI couldn't answer right now ({e}). The calculators still work offline."}
    lab = None
    m = re.search(r"```lab\s*(\{.*?\})\s*```", answer, re.S)
    if m:
        try:
            lab = json.loads(m.group(1))
        except json.JSONDecodeError:
            lab = None
        answer = answer[:m.start()].rstrip() + ("\n\n*A circuit for the Circuit Lab is ready - press “Open in Circuit Lab”.*" if lab else "")
    return {"answer": answer, "lab": lab, "mode": mode}


# ====================================================================== the chat (engineering brain + troubleshooting memory)
CHAT_FILE = os.path.join(PROJECTS, "_chat.json")
BRAIN = """You are Vermeil's Electronics & Robotics engineer, chatting with a beginner maker. Your brain:
1. Electrical engineering reasoning: work with voltage, current, resistance, power, Ohm's and Kirchhoff's laws and
   real component specs - show the numbers (V = I*R, P = V*I...) when they matter.
2. Circuit design: reason about topology, signal paths, regulation, pull-ups/downs, decoupling, level shifting and how
   modules interface.
3. Component & datasheet knowledge: pinouts, absolute maximum ratings, timing, logic levels. Name real parts.
   If you're not sure of a datasheet value, say so and say where to check - never invent it.
4. Fault diagnosis: from the symptoms and measurements, list the likely causes from most to least likely and the
   ONE next measurement that best splits them (what to set the multimeter to, where to put the probes, what reading
   means what).
5. Embedded systems: MCUs, firmware, GPIO, I2C/SPI/UART/PWM, interrupts, timers, sensors - hardware + software together.
6. Power & compatibility: check every voltage, current, logic level (3.3 V vs 5 V), battery capacity/runtime, thermal
   limits and whether the supply is big enough (servos and motors stall currents!).
7. Simulation-based verification: when a circuit can be tried in the Circuit Lab or the 3D Build Lab first, say so
   before recommending a physical build.
8. Robotics & mechatronics: torque (kg·cm), gear ratios, speed, leg/arm geometry, sensor feedback, PID/control.
9. Evidence-based memory: the TROUBLESHOOTING LOG below lists what was measured, which ideas were ruled out and what
   worked. Use it; never ask for a measurement already taken or re-suggest a ruled-out cause.
10. Verification & safety: double-check your calculations and ratings, point out failure modes, say how sure you are,
    and ask for a measurement when you're guessing. Mains (230 V), big capacitors, microwaves, CRTs and LiPo
    batteries get a clear safety warning.

Answer in simple Markdown. At the very END of every answer add one line
MEMORY: {"measured": [...new measurements the user reported...], "ruled_out": [...], "worked": [...], "open": "the open problem or empty"}
(only new items; empty lists are fine). If the user wants to SEE a robot or device in 3D, also add a line
BUILD: <a one-line prompt for the 3D Build Lab, e.g. "a robot dog with 8 MG996R servos">."""


def _chat_load():
    try:
        with open(CHAT_FILE, encoding="utf-8") as f:
            d = json.load(f)
            return {"history": d.get("history", [])[-60:], "log": d.get("log", {"measured": [], "ruled_out": [], "worked": [], "open": ""})}
    except (OSError, ValueError):
        return {"history": [], "log": {"measured": [], "ruled_out": [], "worked": [], "open": ""}}


def _chat_save(d):
    os.makedirs(PROJECTS, exist_ok=True)
    with open(CHAT_FILE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(CHAT_FILE + ".tmp", CHAT_FILE)


def chat_state():
    return _chat_load()


def chat_clear(keep_log=True):
    d = _chat_load()
    d["history"] = []
    if not keep_log:
        d["log"] = {"measured": [], "ruled_out": [], "worked": [], "open": ""}
    _chat_save(d)
    return d


def chat(message):
    """one message in the electronics chat -> {'reply': markdown, 'build': prompt or None, 'log': {...}}"""
    msg = (message or "").strip()[:4000]
    if not msg:
        return {"error": "Type a question or describe the problem."}
    d = _chat_load()
    L = d["log"]
    log_txt = ("TROUBLESHOOTING LOG\nMeasured: " + "; ".join(L["measured"][-20:]) + "\nRuled out: " + "; ".join(L["ruled_out"][-20:]) +
               "\nWorked before: " + "; ".join(L["worked"][-15:]) + f"\nOpen problem: {L.get('open') or 'none'}")
    calcs = "Calculators the user can open in the Formulas tab: " + ", ".join(f["name"] for f in FORMULAS.values())
    messages = [{"role": "system", "content": BRAIN + "\n\n" + log_txt + ("\n" + calcs if calcs else "")}, *d["history"][-20:], {"role": "user", "content": msg}]
    import llm
    try:
        r = llm.get_client().chat.completions.create(model="smart", messages=messages, temperature=0.3)
        text = r.choices[0].message.content or ""
    except Exception as e:
        return {"error": f"The AI couldn't answer right now ({e}). The calculators and simulators still work offline."}
    build = None
    m = re.search(r"^\s*BUILD:\s*(.+)$", text, re.M)
    if m:
        build = m.group(1).strip().strip('"')[:300]
        text = text[:m.start()] + text[m.end():]
    m = re.search(r"^\s*MEMORY:\s*(\{.*\})\s*$", text, re.M)
    if m:
        try:
            upd = json.loads(m.group(1))
            for k in ("measured", "ruled_out", "worked"):
                for x in upd.get(k) or []:
                    if isinstance(x, str) and x.strip() and x not in L[k]:
                        L[k].append(x.strip()[:200])
                L[k] = L[k][-40:]
            if isinstance(upd.get("open"), str):
                L["open"] = upd["open"][:200]
        except ValueError:
            pass
        text = text[:m.start()] + text[m.end():]
    reply = text.strip()
    d["history"] += [{"role": "user", "content": msg}, {"role": "assistant", "content": reply}]
    d["history"] = d["history"][-60:]
    _chat_save(d)
    return {"reply": reply, "build": build, "log": L}


# ====================================================================== Circuit Lab projects
def _safe_name(name):
    n = re.sub(r"[^\w\- ]+", "", str(name or "")).strip()[:60]
    return n or time.strftime("Circuit %Y-%m-%d %H%M")


def list_projects():
    os.makedirs(PROJECTS, exist_ok=True)
    out = []
    for f in sorted(os.listdir(PROJECTS)):
        if f.endswith(".json") and not f.startswith("_"):          # _chat.json is the chat, not a circuit
            p = os.path.join(PROJECTS, f)
            out.append({"name": f[:-5], "saved": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p)))})
    return sorted(out, key=lambda x: x["saved"], reverse=True)


def save_project(name, data):
    os.makedirs(PROJECTS, exist_ok=True)
    name = _safe_name(name or (data or {}).get("name"))
    blob = json.dumps(data, ensure_ascii=False)
    if len(blob) > 2_000_000:
        return {"error": "That circuit is too big to save."}
    path = os.path.join(PROJECTS, name + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        f.write(blob)
    os.replace(path + ".tmp", path)
    return {"name": name, "projects": list_projects()}


def load_project(name):
    path = os.path.join(PROJECTS, _safe_name(name) + ".json")
    if not os.path.exists(path):
        return {"error": "Project not found."}
    with open(path, encoding="utf-8") as f:
        return {"name": _safe_name(name), "data": json.load(f)}


def delete_project(name):
    path = os.path.join(PROJECTS, _safe_name(name) + ".json")
    if os.path.exists(path):
        os.remove(path)
    return {"projects": list_projects()}
