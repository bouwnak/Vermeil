"""
missions.py - Mission Control: give her a bigger goal and she plans it, then works through it step by step,
even across hours or days ("track this price every morning for a week and tell me the best day to buy").

  create(goal)          the AI writes a plan (up to 8 steps). Steps can wait ("after 3 hours", "tomorrow").
  run_due(confirm)      called by the app every ~20 s: runs steps whose time has come
  pause / resume / cancel / delete / run_now

Each step is done by the AI with the same tools as normal chat (calendar, web, files, music...).
Risky tools (sending email, closing apps, typing...) still ask you first.
Saved in data/missions.json, so missions survive a restart.
"""
import json
import threading
import time
import uuid
from datetime import datetime

from paths import data_file

FILE = data_file("missions.json")
MAX_STEPS = 8
MAX_ROUNDS = 8                    # tool calls the AI may make for one step
NO_TOOLS = {"start_mission", "mission_status", "control_mission", "group_conversation", "check_gesture"}
_lock = threading.Lock()
_running = set()                  # mission ids being worked on right now
on_change = None                  # app.py: called with the mission after every change


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save(items):
    with open(FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


def _update(mid, fn):
    """Change one mission safely (fn edits it in place). Returns the mission."""
    with _lock:
        items = _load()
        m = next((x for x in items if x["id"] == mid), None)
        if m is None:
            return None
        fn(m)
        m["updated"] = time.time()
        _save(items)
    if on_change:
        try:
            on_change(m)
        except Exception as e:
            print(f"[missions] {e}")
    return m


def list_missions():
    return sorted(_load(), key=lambda m: -m.get("created", 0))


def get(mid):
    return next((m for m in _load() if m["id"] == mid), None)


def progress(m):
    done = sum(1 for s in m["steps"] if s["status"] in ("done", "skipped"))
    return done, len(m["steps"])


# ------------------------------------------------------------------ planning
def plan(goal):
    import llm
    data = llm.ask(
        f"Today is {datetime.now().strftime('%A %Y-%m-%d %H:%M')}. The user gave their AI assistant this mission:\n"
        f"\"{goal}\"\n\nThe assistant has tools for: calendar, reminders, tasks, notes, web search, reading websites, "
        f"news, prices, weather, email (asks first), files in the user's folder, opening apps, music, study files, "
        f"journal and thinking tools. Break the mission into 2-{MAX_STEPS} concrete steps it can do with those tools. "
        f"If something must happen later or repeat (e.g. 'every morning for 3 days'), make separate steps and set "
        f"wait_hours = hours to wait AFTER the previous step before doing this one (0 = straight away). "
        f"The last step should report the result to the user.\n"
        f'Reply as JSON: {{"title": "short title", "steps": [{{"do": "what to do", "wait_hours": 0}}]}}',
        model="smart", json_mode=True)
    steps = []
    for s in (data.get("steps") or [])[:MAX_STEPS]:
        text = str(s.get("do") or "").strip()
        if text:
            try:
                wait = max(0.0, min(24 * 30, float(s.get("wait_hours") or 0)))
            except (TypeError, ValueError):
                wait = 0.0
            steps.append({"text": text, "wait_hours": wait, "status": "pending", "result": "", "at": None})
    if not steps:
        raise ValueError("I couldn't make a plan for that.")
    return str(data.get("title") or goal)[:80], steps


def create(goal, start=True):
    title, steps = plan(goal)
    now = time.time()
    steps[0]["at"] = now + steps[0]["wait_hours"] * 3600
    m = {"id": uuid.uuid4().hex[:8], "goal": goal, "title": title, "steps": steps,
         "status": "active" if start else "paused", "created": now, "updated": now, "log": []}
    with _lock:
        items = _load()
        items.append(m)
        _save(items)
    if on_change:
        on_change(m)
    return m


# ------------------------------------------------------------------ doing a step
def _agent(m, idx, confirm):
    """Let the AI do one step with its tools. Returns its short report."""
    import llm
    import tools
    done = "\n".join(f"{i + 1}. {s['text']} -> {s['result'][:300]}" for i, s in enumerate(m["steps"][:idx]) if s["result"]) or "(nothing yet)"
    todo = "\n".join(f"{i + 1}. {s['text']}" for i, s in enumerate(m["steps"]))
    step = m["steps"][idx]
    messages = [
        {"role": "system", "content": (
            f"You are an AI assistant carrying out a mission for the user, one step at a time. "
            f"Now: {datetime.now().strftime('%A %Y-%m-%d %H:%M')}.\nMission: {m['goal']}\nPlan:\n{todo}\n"
            f"Results so far:\n{done}\n\nDo step {idx + 1} now using your tools. Don't do other steps. "
            f"Finish with a 1-3 sentence report of what you did or found (include the facts/numbers). "
            f"If it truly can't be done, start your report with 'FAILED:' and say why.")},
        {"role": "user", "content": f"Step {idx + 1}: {step['text']}"}]
    tool_list = [t for t in tools.pick(step["text"], m["goal"]) if t["function"]["name"] not in NO_TOOLS]
    client = llm.get_client()
    import pc
    for _ in range(MAX_ROUNDS):
        if pc.stop_event.is_set():
            return "FAILED: stopped by the emergency stop."
        r = client.chat.completions.create(model="smart", messages=messages, tools=tool_list, tool_choice="auto")
        msg = r.choices[0].message
        calls = getattr(msg, "tool_calls", None)
        calls = list(calls) if isinstance(calls, (list, tuple)) else []
        if not calls:
            return (msg.content or "Done.").strip()
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in calls]})
        for c in calls:
            if c.function.name == "more_tools":
                try:
                    need = json.loads(c.function.arguments or "{}").get("need", "")
                except (json.JSONDecodeError, AttributeError):
                    need = ""
                extra = [t for t in tools.more(need, [t["function"]["name"] for t in tool_list]) if t["function"]["name"] not in NO_TOOLS]
                tool_list = tool_list + extra
                messages.append({"role": "tool", "tool_call_id": c.id, "content": "Added: " + ", ".join(t["function"]["name"] for t in extra)})
                continue
            res = tools.run_tool(c.function.name, c.function.arguments, confirm=confirm)
            _log(m["id"], f"{c.function.name}: {res[:160]}")
            messages.append({"role": "tool", "tool_call_id": c.id, "content": res[:6000]})
    return "Done (used the maximum number of tool steps)."


def _log(mid, text):
    _update(mid, lambda m: m["log"].append({"at": time.time(), "text": text}) or m.__setitem__("log", m["log"][-60:]))


def run_step(mid, confirm=None):
    """Do the next pending step of a mission (blocking). Returns the updated mission."""
    if mid in _running:
        return get(mid)
    _running.add(mid)
    try:
        m = get(mid)
        if not m or m["status"] not in ("active",):
            return m
        idx = next((i for i, s in enumerate(m["steps"]) if s["status"] in ("pending", "running")), None)
        if idx is None:
            return _update(mid, lambda x: x.__setitem__("status", "done"))
        _update(mid, lambda x: x["steps"][idx].__setitem__("status", "running"))
        try:
            report = _agent(get(mid), idx, confirm)
        except Exception as e:
            report = f"FAILED: {e}"
        failed = report.upper().startswith("FAILED")

        def finish(x):
            s = x["steps"][idx]
            s["status"] = "failed" if failed else "done"
            s["result"] = report
            s["finished"] = time.time()
            if failed:
                x["status"] = "failed"
                return
            nxt = idx + 1
            if nxt >= len(x["steps"]):
                x["status"] = "done"
            else:
                x["steps"][nxt]["at"] = time.time() + x["steps"][nxt]["wait_hours"] * 3600
        return _update(mid, finish)
    finally:
        _running.discard(mid)


def due(now=None):
    """Ids of active missions whose next step should run now."""
    now = now or time.time()
    out = []
    for m in _load():
        if m["status"] != "active" or m["id"] in _running:
            continue
        s = next((s for s in m["steps"] if s["status"] in ("pending", "running")), None)
        if s and (s["at"] or 0) <= now:
            out.append(m["id"])
    return out


def run_due(confirm=None, now=None):
    """Run every due step (each mission in its own thread). Returns the ids started."""
    ids = due(now)
    for mid in ids:
        threading.Thread(target=run_step, args=(mid, confirm), daemon=True).start()
    return ids


# ------------------------------------------------------------------ control
def pause(mid):
    return _update(mid, lambda m: m.__setitem__("status", "paused") if m["status"] == "active" else None)


def resume(mid):
    def go(m):
        if m["status"] in ("paused", "failed"):
            m["status"] = "active"
            for s in m["steps"]:
                if s["status"] in ("failed", "running"):
                    s["status"], s["at"] = "pending", time.time()
    return _update(mid, go)


def run_now(mid):
    """Don't wait: make the next step due right away."""
    def go(m):
        s = next((s for s in m["steps"] if s["status"] == "pending"), None)
        if s:
            s["at"] = time.time()
        if m["status"] == "paused":
            m["status"] = "active"
    return _update(mid, go)


def skip_step(mid):
    def go(m):
        idx = next((i for i, s in enumerate(m["steps"]) if s["status"] in ("pending", "failed")), None)
        if idx is None:
            return
        m["steps"][idx]["status"] = "skipped"
        if idx + 1 < len(m["steps"]):
            m["steps"][idx + 1]["at"] = time.time()
            if m["status"] == "failed":
                m["status"] = "active"
        else:
            m["status"] = "done"
    return _update(mid, go)


def cancel(mid):
    return _update(mid, lambda m: m.__setitem__("status", "cancelled"))


def delete(mid):
    with _lock:
        items = [m for m in _load() if m["id"] != mid]
        _save(items)
    return True


def find(name):
    """Mission by id or (part of) its title/goal, newest first."""
    name = (name or "").lower().strip()
    for m in list_missions():
        if m["id"] == name or (name and (name in m["title"].lower() or name in m["goal"].lower())):
            return m
    return None


def status_text():
    items = [m for m in list_missions() if m["status"] in ("active", "paused", "failed")]
    if not items:
        return "No missions running."
    lines = []
    for m in items[:8]:
        d, n = progress(m)
        nxt = next((s for s in m["steps"] if s["status"] == "pending"), None)
        when = ""
        if nxt and nxt["at"] and nxt["at"] > time.time() + 60:
            when = f", next step {datetime.fromtimestamp(nxt['at']).strftime('%a %H:%M')}"
        last = next((s["result"] for s in reversed(m["steps"]) if s["result"]), "")
        lines.append(f"- {m['title']} ({m['status']}, {d}/{n} steps{when}). {last[:200]}")
    return "\n".join(lines)
