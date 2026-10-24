"""ai.py - safe calls to the assistant's AI (Groq or the local model) for the Dungeon Master and characters.

- every call has a time limit; when it's slow, broken, or there's no AI at all, the caller's fallback is used
- answers must be JSON and are checked before anything uses them (see dm.py)
- the API key never goes into prompts, logs or the game files
"""
import concurrent.futures as cf
import json
import re
import threading

_pool = cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="game-ai")
_disabled = {"on": False}
_cancelled = set()
_lock = threading.Lock()
stats = {"calls": 0, "ok": 0, "timeouts": 0, "errors": 0, "fallbacks": 0}


def disable(on=True):
    """tests / offline play: never call the AI."""
    _disabled["on"] = on


def cancel(req_id):
    with _lock:
        _cancelled.add(req_id)


def is_cancelled(req_id):
    with _lock:
        return req_id in _cancelled


def _client():
    try:
        import llm                     # the assistant's AI router (brain/llm.py)
        return llm.get_client()
    except Exception:
        return None


def _call(system, user, json_mode, temperature, max_tokens):
    cl = _client()
    if cl is None:
        raise RuntimeError("AI not available")
    r = cl.chat.completions.create(model="smart", messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                                   response_format={"type": "json_object"} if json_mode else None, temperature=temperature,
                                   max_tokens=max_tokens)
    return r.choices[0].message.content or ""


def ask(system, user, json_mode=True, timeout=22, temperature=0.8, max_tokens=700, req_id=None):
    """-> dict (json_mode) / str, or None if the AI failed, timed out, or the request was cancelled."""
    if _disabled["on"]:
        stats["fallbacks"] += 1
        return None
    stats["calls"] += 1
    fut = _pool.submit(_call, system, user, json_mode, temperature, max_tokens)
    try:
        text = fut.result(timeout=timeout)
    except cf.TimeoutError:
        stats["timeouts"] += 1
        return None
    except Exception as e:
        stats["errors"] += 1
        print(f"[game AI] {type(e).__name__}: {str(e)[:120]}")
        return None
    if req_id and is_cancelled(req_id):
        return None
    if not json_mode:
        stats["ok"] += 1
        return text.strip()
    d = parse_json(text)
    if d is None:
        stats["errors"] += 1
        return None
    stats["ok"] += 1
    return d


def parse_json(text):
    """tolerant JSON: strips code fences / text around the object."""
    if not text: return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    try:
        d = json.loads(t)
        return d if isinstance(d, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                d = json.loads(m.group(0))
                return d if isinstance(d, dict) else None
            except Exception:
                return None
    return None


def clean_text(s, limit=600):
    """make AI text safe to show/speak: no markup, bounded length."""
    if not isinstance(s, str): return ""
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[\*_#`]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]
