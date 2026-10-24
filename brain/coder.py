"""
coder.py - a coding helper that HELPS with your code and BUILDS new code for you.

  Help:  choose a project folder; it reads and searches your code, then suggests or makes changes.
  Build: "make me a Python calculator" - it creates a new project folder (Documents/Vermeil Projects/...),
         writes complete working files, runs them to test, fixes errors, and tells you how to run it.

Safety: in YOUR folders every change and command is shown first and waits for your OK.
In projects it created itself, it may write files without asking (Settings can turn that off);
running commands always asks.
"""
import os
import re
import json
import difflib
import fnmatch
import subprocess

CODE_MODEL = "smart"           # local model role (llm.py)
MAX_ROUNDS = 25
PROJECTS_DIR = os.path.join(os.path.expanduser("~"), "Documents", "Vermeil Projects")
MARKER = ".vermeil-project"    # marks folders the helper created itself
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "env", "dist", "build", ".idea", ".vscode", "Packages"}
SECRET_FILES = {".env", "env", "id_rsa", "id_ed25519", "spotify_token.json", "google_token.json", "google_credentials.json"}
TEXT_LIMIT = 60000

SYSTEM = """You are a senior software engineer working with a beginner programmer. You both HELP with existing code
and BUILD new code when asked.

When they ask you to make/create/build/write something new (an app, game, script, website, bot...):
- If there's no workspace, or the request is a new thing unrelated to the current folder, call new_project first.
- Write COMPLETE, working code - never "..." or "add your code here". Use write_files to create all files at once.
- Default to Python (standard library when possible) unless they ask for something else. Websites: one
  index.html with CSS/JS inside unless it's big. Roblox: Luau scripts plus where each one goes in Studio.
- Add short comments that explain the code to a beginner, and a README.md with: what it does, how to install
  anything needed, and the exact command to run it.
- Then TEST it: run it with run_command (e.g. `python main.py` or `python -m py_compile main.py` for apps that
  open a window / wait for input). If there's an error, read it, fix the code, and run again.
- Finish with: what you built, the files, and exactly how to run it.

When they ask about existing code:
- Look at the relevant files before changing anything. Make small, focused changes that fit the existing style.
- Use edit_file for small changes, write_file/write_files for new or fully rewritten files.
- Explain what you changed and why in simple words, and how to test it.

Always:
- Never read or print secrets (API keys, passwords, .env files). Never write code that harms the computer,
  steals data, or attacks other people/systems.
- Changes and commands may need the user's approval, so describe each one clearly (the reason field).
- If the request is truly unclear, ask one short question first.

YOUR BRAIN - how you work on every task:
1. Deep code reasoning: trace how the code actually runs (callers, imports, data flow across files) before changing
   it. For a bug, find the ROOT cause and say WHY your fix works before you write it.
2. Codebase awareness: start from project_map (structure, functions/classes, who imports what) and the project memory
   below. Follow the project's existing conventions (naming, style, frameworks) instead of inventing new ones.
3. Self-improving debugging: when a fix fails, record it with remember(kind="failed") and try a DIFFERENT approach.
   Never repeat an approach the memory says failed.
4. Multi-step planning: for anything bigger than a small edit, first write a short numbered plan (files, order,
   dependencies), then do the steps in that order.
5. Code review: before you say "done", review your own changes for bugs, edge cases, security problems, performance
   and compatibility (Windows paths, Python version). Fix what you find.
6. Right tool for the size: small edits -> edit_file; new/rewritten files -> write_file(s); removals -> delete_file.
7. Persistent knowledge: use remember() for architecture facts, decisions, the user's preferences, fixes that worked
   and bugs still open, so the next session knows them.
8. Verification: never assume code works. Run it, its tests, or at least a syntax check (python -m py_compile,
   node --check) and read the output. A task is done only when the check passes.
9. Documentation-grounded: if you're not sure an API, package function or option exists, look it up with docs_lookup
   (official docs / source) instead of guessing. Never invent functions.
10. Autonomous loop: understand -> plan -> code -> test -> analyse failures -> revise, until it works or you hit a real
    blocker - then say exactly what blocks you and what you need from the user."""


def _fn(name, desc, props=None, req=None):
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props or {}, "required": req or []}}}


S = {"type": "string"}
TOOLS = [
    _fn("list_files", "List files in the workspace (or a sub-folder). Optional glob pattern like '*.py'.", {"folder": S, "pattern": S}),
    _fn("read_file", "Read a text file. Optional 1-based start/end line numbers.",
        {"path": S, "start": {"type": "integer"}, "end": {"type": "integer"}}, ["path"]),
    _fn("search_code", "Search all text files for a word or regex. Returns file:line matches.", {"query": S}, ["query"]),
    _fn("edit_file", "Replace one exact piece of text in a file (must match exactly once). Needs user approval.",
        {"path": S, "old_text": S, "new_text": S, "reason": S}, ["path", "old_text", "new_text"]),
    _fn("write_file", "Create a file or replace its whole content. Needs user approval.",
        {"path": S, "content": S, "reason": S}, ["path", "content"]),
    _fn("write_files", "Create or replace several files at once (best for building a new project).",
        {"files": {"type": "array", "items": {"type": "object", "properties": {"path": S, "content": S}, "required": ["path", "content"]}},
         "reason": S}, ["files"]),
    _fn("run_command", "Run a shell command in the workspace (tests, scripts, pip...). Needs user approval. 120 s limit.",
        {"command": S, "reason": S}, ["command"]),
    _fn("new_project", "Start a NEW project folder (in Documents/Vermeil Projects) and work there. Use before building "
        "something new.", {"name": {"type": "string", "description": "Short name, e.g. 'Calculator'"}}, ["name"]),
    _fn("open_in_editor", "Open the project in VS Code (or the file explorer if VS Code isn't installed)."),
    _fn("delete_file", "Delete a file from the project (it goes to a .trash folder inside the project, so it can be restored). "
        "Needs user approval.", {"path": S, "reason": S}, ["path"]),
    _fn("project_map", "Map of the project: every code file with its functions/classes and what it imports (who depends on whom). "
        "Use it first to understand a codebase."),
    _fn("remember", "Save a fact about this project for future sessions (architecture, decision, preference, fix, failed, bug).",
        {"kind": {"type": "string", "enum": ["architecture", "decision", "preference", "fix", "failed", "bug", "bug_fixed"]}, "text": S}, ["kind", "text"]),
    _fn("docs_lookup", "Look something up in official documentation / the web (APIs, package functions, error messages). "
        "Returns short extracts with sources.", {"query": S}, ["query"]),
]
MEMORY_FILE = None              # set lazily: data/coder_memory.json
CODE_EXT = (".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".lua", ".luau", ".java", ".cs", ".cpp", ".c", ".h", ".go", ".rs", ".rb", ".php", ".kt", ".swift", ".gd")


def _memory_path():
    global MEMORY_FILE
    if MEMORY_FILE is None:
        try:
            from paths import data_file
            MEMORY_FILE = data_file("coder_memory.json")
        except Exception:
            MEMORY_FILE = os.path.join(os.path.expanduser("~"), ".vermeil_coder_memory.json")
    return MEMORY_FILE


def load_memory():
    try:
        with open(_memory_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_memory(mem):
    p = _memory_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(mem, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def pick_model(message):
    """dynamic model choice: quick questions/small edits -> the fast chat model, real engineering -> the smart one."""
    m = (message or "").lower()
    big = len(m) > 220 or re.search(r"\b(build|create|make|app|game|website|refactor|debug|bug|error|crash|fix|architecture|design|implement|optimi[sz]e|test)\b", m)
    return CODE_MODEL if big else "chat"


class CodingAgent:
    def __init__(self, workspace=None, approve=None, on_event=None):
        self.workspace = None
        self.auto_write_own = True          # projects it created itself: write files without asking
        self.approve = approve or (lambda kind, details: False)     # (kind, details dict) -> bool
        self.on_event = on_event or (lambda e: None)
        self.history = []
        if workspace:
            self.set_workspace(workspace)

    # ---------- workspace ----------
    def set_workspace(self, folder):
        folder = os.path.realpath(folder)
        if not os.path.isdir(folder):
            raise ValueError("That folder doesn't exist.")
        self.workspace = folder
        self.history = []

    def _path(self, rel):
        """Resolve a path and refuse anything outside the workspace."""
        if not self.workspace:
            raise ValueError("Choose a project folder first.")
        full = os.path.realpath(os.path.join(self.workspace, rel or "."))
        if full != self.workspace and not full.startswith(self.workspace + os.sep):
            raise PermissionError("That path is outside the project folder.")
        if os.path.basename(full).lower() in SECRET_FILES:
            raise PermissionError("That file holds secrets, so it's off-limits.")
        return full

    def is_own_project(self):
        return bool(self.workspace) and os.path.exists(os.path.join(self.workspace, MARKER))

    def _ok(self, kind, details):
        """Ask the user - except for file writes in a project the helper made itself (if allowed)."""
        if kind in ("write", "edit") and self.auto_write_own and self.is_own_project():
            return True
        return self.approve(kind, details)

    def new_project(self, name):
        safe = re.sub(r'[<>:"/\\|?*]+', "", name or "").strip()[:60] or "New project"
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        folder, n = os.path.join(PROJECTS_DIR, safe), 2
        while os.path.exists(folder):
            folder, n = os.path.join(PROJECTS_DIR, f"{safe} ({n})"), n + 1
        os.makedirs(folder)
        with open(os.path.join(folder, MARKER), "w", encoding="utf-8") as f:
            f.write("Created by Vermeil's coding helper.\n")
        keep = self.history
        self.set_workspace(folder)
        self.history = keep                  # same conversation, new folder
        self.on_event({"type": "code_workspace", "workspace": self.workspace})
        return f"Created the project folder {folder} and switched to it."

    def open_in_editor(self):
        if not self.workspace:
            return "There's no project folder yet."
        import shutil as _sh
        code = _sh.which("code") or _sh.which("code.cmd")
        try:
            if code:
                subprocess.Popen([code, self.workspace], shell=os.name == "nt")
                return "Opened it in VS Code."
            if os.name == "nt":
                os.startfile(self.workspace)
                return "Opened the folder (VS Code isn't installed)."
        except OSError as e:
            return f"Couldn't open it: {e}"
        return f"The project is in {self.workspace}."

    def write_files(self, files, reason=""):
        files = [f for f in (files or []) if isinstance(f, dict) and f.get("path")]
        if not files:
            return "No files given."
        fulls, diffs, olds = [], [], []
        for f in files:
            full = self._path(f["path"])
            old = ""
            if os.path.exists(full):
                with open(full, "r", encoding="utf-8", errors="replace") as fh:
                    old = fh.read()
            fulls.append(full); olds.append(old)
            diffs.append(self._diff(f["path"], old, f.get("content", "")))
        if not self._ok("write", {"path": ", ".join(f["path"] for f in files), "reason": reason,
                                  "new": not any(olds), "diff": "\n".join(diffs)}):
            return "The user rejected these changes."
        for full, f in zip(fulls, files):
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(f.get("content", ""))
        return f"Wrote {len(files)} files: " + ", ".join(f["path"] for f in files)

    def _rel(self, full):
        return os.path.relpath(full, self.workspace).replace("\\", "/")

    # ---------- tools ----------
    def list_files(self, folder=".", pattern=None):
        root = self._path(folder)
        out = []
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
            for f in sorted(files):
                if pattern and not fnmatch.fnmatch(f, pattern):
                    continue
                if f.lower() in SECRET_FILES:
                    continue
                full = os.path.join(d, f)
                out.append(f"{self._rel(full)} ({os.path.getsize(full)} bytes)")
                if len(out) >= 300:
                    return "\n".join(out) + "\n... (more files not shown)"
        return "\n".join(out) or "No files."

    def read_file(self, path, start=None, end=None):
        full = self._path(path)
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        s = max(1, int(start or 1)); e = min(len(lines), int(end or len(lines)))
        text = "\n".join(f"{i:>5}| {lines[i - 1]}" for i in range(s, e + 1))
        if len(text) > TEXT_LIMIT:
            text = text[:TEXT_LIMIT] + "\n... (cut - read a smaller line range)"
        return f"{path} (lines {s}-{e} of {len(lines)})\n{text}"

    def search_code(self, query):
        try:
            rx = re.compile(query, re.I)
        except re.error:
            rx = re.compile(re.escape(query), re.I)
        hits = []
        for d, dirs, files in os.walk(self.workspace):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
            for f in files:
                if f.lower() in SECRET_FILES or os.path.splitext(f)[1].lower() in (".png", ".jpg", ".glb", ".onnx", ".exe", ".pt", ".zip", ".rar", ".mp3", ".wav", ".pdf"):
                    continue
                full = os.path.join(d, f)
                try:
                    with open(full, "r", encoding="utf-8") as fh:
                        for n, line in enumerate(fh, 1):
                            if rx.search(line):
                                hits.append(f"{self._rel(full)}:{n}: {line.strip()[:160]}")
                                if len(hits) >= 80:
                                    return "\n".join(hits) + "\n... (more matches)"
                except (UnicodeDecodeError, OSError):
                    continue
        return "\n".join(hits) or "No matches."

    def _diff(self, path, old, new):
        return "".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), f"a/{path}", f"b/{path}", n=3))

    def edit_file(self, path, old_text, new_text, reason=""):
        full = self._path(path)
        with open(full, "r", encoding="utf-8") as f:
            content = f.read()
        count = content.count(old_text)
        if count != 1:
            return f"old_text was found {count} times in {path}; it must match exactly once. Read the file again."
        updated = content.replace(old_text, new_text, 1)
        if not self._ok("edit", {"path": path, "reason": reason, "diff": self._diff(path, content, updated)}):
            return "The user rejected this change."
        with open(full, "w", encoding="utf-8") as f:
            f.write(updated)
        return f"Edited {path}."

    def write_file(self, path, content, reason=""):
        full = self._path(path)
        old = ""
        if os.path.exists(full):
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                old = f.read()
        if not self._ok("write", {"path": path, "reason": reason, "new": not old, "diff": self._diff(path, old, content)}):
            return "The user rejected this change."
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        return f"{'Created' if not old else 'Rewrote'} {path}."

    def run_command(self, command, reason=""):
        if not self.workspace:
            return "Make or choose a project folder first."
        if not self.approve("run", {"command": command, "reason": reason, "folder": self.workspace}):
            return "The user rejected running this command."
        try:
            p = subprocess.run(command, shell=True, cwd=self.workspace, capture_output=True, text=True, timeout=120)
            out = (p.stdout + ("\n" + p.stderr if p.stderr else "")).strip()
            return f"exit code {p.returncode}\n{out[-8000:] or '(no output)'}"
        except subprocess.TimeoutExpired:
            return "The command took longer than 120 seconds and was stopped."

    def delete_file(self, path, reason=""):
        full = self._path(path)
        if not os.path.isfile(full):
            return f"{path} doesn't exist."
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            old = f.read()
        if not self.approve("delete", {"path": path, "reason": reason, "diff": self._diff(path, old, "")}):
            return "The user rejected deleting this file."
        trash = os.path.join(self.workspace, ".trash")
        os.makedirs(trash, exist_ok=True)
        dest = os.path.join(trash, path.replace("/", "_").replace("\\", "_"))
        if os.path.exists(dest):
            os.remove(dest)
        os.replace(full, dest)
        return f"Deleted {path} (a copy is in .trash/ if you need it back)."

    def project_map(self):
        """files -> functions/classes and imports, plus a reverse 'used by' map for local modules."""
        if not self.workspace:
            return "No workspace yet."
        files, defs, imps = [], {}, {}
        for d, dirs, fs in os.walk(self.workspace):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
            for f in sorted(fs):
                if not f.endswith(CODE_EXT) or f.lower() in SECRET_FILES:
                    continue
                full = os.path.join(d, f); rel = self._rel(full)
                files.append(rel)
                try:
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        src = fh.read(200000)
                except OSError:
                    continue
                defs[rel] = re.findall(r"^\s*(?:async\s+)?(?:def|class|function|export\s+(?:async\s+)?function|export\s+class)\s+([A-Za-z_]\w*)", src, re.M)[:40]
                py = [a or b for a, b in re.findall(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", src, re.M)]
                js = re.findall(r"""(?:from|require\()\s*['"](\.{1,2}/[^'"]+)['"]""", src)
                imps[rel] = sorted(set(py + js))[:25]
                if len(files) >= 250:
                    break
        local = {os.path.splitext(os.path.basename(f))[0]: f for f in files}
        used_by = {}
        for f, ims in imps.items():
            for i in ims:
                key = os.path.splitext(os.path.basename(i.split(".")[-1] if not i.startswith(".") else i))[0]
                if key in local and local[key] != f:
                    used_by.setdefault(local[key], []).append(f)
        out = []
        for f in files:
            line = f"{f}: " + (", ".join(defs.get(f, [])) or "-")
            if used_by.get(f): line += f"  [used by: {', '.join(used_by[f][:6])}]"
            out.append(line)
        return "\n".join(out)[:TEXT_LIMIT] or "No code files."

    def _mem_key(self):
        return (self.workspace or "_global").lower()

    def remember(self, kind, text):
        mem = load_memory()
        entry = mem.setdefault(self._mem_key(), [])
        text = str(text).strip()[:400]
        if kind == "bug_fixed":                       # close the matching open bug
            for e in entry:
                if e["kind"] == "bug" and text.lower()[:40] in e["text"].lower():
                    e["kind"] = "fix"
        if not any(e["text"] == text for e in entry):
            entry.append({"kind": kind if kind != "bug_fixed" else "fix", "text": text, "at": __import__("time").strftime("%Y-%m-%d")})
        mem[self._mem_key()] = entry[-80:]
        save_memory(mem)
        return f"Remembered ({kind})."

    def memory_text(self):
        entry = load_memory().get(self._mem_key(), [])
        if not entry:
            return ""
        groups = {}
        for e in entry:
            groups.setdefault(e["kind"], []).append(e["text"])
        names = {"architecture": "Architecture", "decision": "Decisions", "preference": "User preferences", "fix": "Fixes that worked",
                 "failed": "Approaches that FAILED (don't repeat)", "bug": "Open bugs"}
        return "PROJECT MEMORY (from earlier sessions):\n" + "\n".join(f"{names.get(k, k)}:\n" + "\n".join(f"- {t}" for t in v[-12:]) for k, v in groups.items())

    def docs_lookup(self, query):
        try:
            import web
            res = web.search(f"{query} documentation", n=5)
        except Exception as e:
            return f"Couldn't search right now ({e.__class__.__name__}). Say clearly that you're not sure instead of guessing."
        lines = []
        for r in (res or [])[:5]:
            if isinstance(r, dict):
                lines.append(f"- {r.get('title', '')} ({r.get('url', '')}): {str(r.get('snippet') or r.get('body') or '')[:300]}")
        if res and isinstance(res[0], dict) and res[0].get("url"):
            try:
                lines.append("\nTop page extract:\n" + web.page_text(res[0]["url"], limit=5000))
            except Exception:
                pass
        return "\n".join(lines)[:9000] or "Nothing found."

    # ---------- conversation ----------
    def _review(self, client, changed):
        """self-review of what was just written: returns problems found ('' if it looks right)."""
        if not changed:
            return ""
        blob = []
        for p in list(dict.fromkeys(changed))[:6]:
            try:
                blob.append(f"=== {p}\n" + self.read_file(p)[:9000])
            except Exception:
                continue
        try:
            r = client.chat.completions.create(model=CODE_MODEL, temperature=0, messages=[
                {"role": "system", "content": "You are a strict code reviewer. List REAL problems only: bugs, crashes, security holes, "
                                              "missing pieces, wrong APIs, Windows incompatibilities. If everything is fine answer exactly: LGTM"},
                {"role": "user", "content": "\n\n".join(blob)}])
            out = (r.choices[0].message.content or "").strip()
            return "" if out.upper().startswith("LGTM") or len(out) < 8 else out[:3000]
        except Exception:
            return ""

    def ask(self, message):
        """One user message -> the agent's reply (it may use several tools in between).
        The loop: understand -> plan -> code -> test -> review -> revise (see SYSTEM, 'YOUR BRAIN')."""
        import pinakamain
        client = pinakamain.get_client()
        self.history.append({"role": "user", "content": message})
        where = (f"Workspace: {self.workspace}{' (a project you created)' if self.is_own_project() else ' (the user’s own folder)'}\n"
                 f"Files:\n{self.list_files()[:4000]}") if self.workspace else \
            "No workspace yet. To build something new call new_project first; to help with existing code, ask the user to choose their folder."
        mem = self.memory_text()
        messages = [{"role": "system", "content": SYSTEM + "\n" + where + ("\n\n" + mem if mem else "")}, *self.history[-30:]]
        model = pick_model(message)
        changed, reviewed, last_fail = [], False, None
        for _ in range(MAX_ROUNDS):
            r = client.chat.completions.create(model=model, messages=messages, tools=TOOLS, tool_choice="auto", temperature=0.2)
            msg = r.choices[0].message
            calls = getattr(msg, "tool_calls", None)
            calls = list(calls) if isinstance(calls, (list, tuple)) else []
            if not calls:
                # automated review before finishing: if it wrote code, check it once and let it fix what's found
                if changed and not reviewed:
                    reviewed = True
                    problems = self._review(client, changed)
                    if problems:
                        self.on_event({"type": "code_step", "tool": "review", "summary": "Self-review found issues - fixing them"})
                        messages.append({"role": "assistant", "content": msg.content or ""})
                        messages.append({"role": "user", "content": "Code review of your changes found these problems. Fix the real ones, "
                                                                    "verify again, then give the final answer:\n" + problems})
                        model = CODE_MODEL
                        continue
                reply = (msg.content or "").strip() or "Done."
                self.history.append({"role": "assistant", "content": reply})
                return reply
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in calls]})
            for c in calls:
                result = self.run_tool(c.function.name, c.function.arguments)
                self.on_event({"type": "code_step", "tool": c.function.name, "summary": result.splitlines()[0][:140] if result else ""})
                name = c.function.name
                if name in ("edit_file", "write_file", "write_files", "delete_file") and not result.startswith(("Error", "The user rejected")):
                    model = CODE_MODEL                      # real engineering now: keep the strong model
                    try:
                        a = json.loads(c.function.arguments or "{}")
                        changed += [f["path"] for f in a.get("files", [])] if name == "write_files" else [a.get("path")] if name != "delete_file" else []
                    except ValueError:
                        pass
                    reviewed = False
                if name == "run_command":                   # learn from test runs: failures and the fixes that followed
                    ok = result.startswith("exit code 0")
                    if not ok and result.startswith("exit code"):
                        err = [l for l in result.splitlines() if re.search(r"error|exception|traceback|failed", l, re.I)]
                        last_fail = (err[-1] if err else result.splitlines()[-1])[:200]
                        result += "\n\n(Verification FAILED. Find the root cause; if you already tried a fix for this, try a different approach.)"
                    elif ok and last_fail:
                        self.remember("fix", f"Fixed: {last_fail}")
                        last_fail = None
                messages.append({"role": "tool", "tool_call_id": c.id, "content": result[:TEXT_LIMIT]})
        reply = "I took a lot of steps without finishing. Tell me how you'd like to continue."
        self.history.append({"role": "assistant", "content": reply})
        return reply

    def run_tool(self, name, arguments):
        fn = {"list_files": self.list_files, "read_file": self.read_file, "search_code": self.search_code,
              "edit_file": self.edit_file, "write_file": self.write_file, "write_files": self.write_files,
              "run_command": self.run_command, "new_project": self.new_project, "open_in_editor": self.open_in_editor,
              "delete_file": self.delete_file, "project_map": self.project_map, "remember": self.remember, "docs_lookup": self.docs_lookup}.get(name)
        if not fn:
            return f"Unknown tool {name}."
        try:
            args = json.loads(arguments) if isinstance(arguments, str) and arguments.strip() else (arguments or {})
            return fn(**args)
        except (PermissionError, ValueError, FileNotFoundError, IsADirectoryError) as e:
            return f"Error: {e}"
        except TypeError as e:
            return f"Wrong arguments for {name}: {e}"
        except json.JSONDecodeError:
            return "The tool arguments were not valid JSON."
