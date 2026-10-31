"""Run the game in a normal web browser (for testing without the Vermeil window):
    python game_tools/dev_server.py 8770      then open  http://localhost:8770/game/index.html?bridge
Serves the ui/ folder and answers /api/<name> with the real Python game engine."""
import http.server, json, os, sys, functools
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
for d in ("brain", "senses", "skills"):
    sys.path.insert(0, os.path.join(ROOT, d))
# test games never touch the real saves (data/game/saves belongs to the player)
os.environ.setdefault("GAME_SAVE_DIR", os.path.join(ROOT, "data", "game", "test_saves"))
from game.api import GameAPI
if os.environ.get("GAME_NO_AI") == "1":
    from game import ai
    ai.disable(True)
API = GameAPI()
_GN = type("GN", (), {"_xp": lambda self, *a, **k: {}})()        # stands in for the Vermeil window in Game Night calls


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def end_headers(self):                            # always serve the newest files while testing
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        name = self.path.split("/api/")[-1].split("?")[0]
        n = int(self.headers.get("Content-Length") or 0)
        args = json.loads(self.rfile.read(n) or b"[]")
        fn = getattr(API, name, None)
        if name.startswith("build_"):                 # the 3D Build Lab (ui/builder/) for browser testing
            import builder
            fn = {"build_design": lambda p: builder.design(p, use_ai=os.environ.get("GAME_NO_AI") != "1"), "build_projects": builder.list_projects,
                  "build_save": builder.save_project, "build_load": builder.load_project, "build_delete": builder.delete_project,
                  "build_pending": lambda *a: None}.get(name)
        if name.startswith("retro_"):                 # the Games hub (ui/games/) for browser testing
            import retrogames
            test_dir = os.path.join(os.environ["GAME_SAVE_DIR"], "retro")     # test saves/lists aren't your real ones
            os.makedirs(test_dir, exist_ok=True)
            retrogames.SAVE_DIR = os.path.join(test_dir, "saves")
            retrogames.LIBRARY_FILE = os.path.join(test_dir, "library.json")
            fn = {"retro_games": retrogames.list_games, "retro_play": retrogames.play_url, "retro_prepare": retrogames.prepare,
                  "retro_progress": retrogames.progress, "retro_save": retrogames.save_data, "retro_load": retrogames.load_data,
                  "retro_library": retrogames.library, "retro_favorite": retrogames.favorite,
                  "retro_downloads": retrogames.downloads, "retro_delete": retrogames.delete_download,
                  "retro_fullscreen": lambda on=True: {"ok": True}}.get(name)
        if name.startswith("games_"):                 # the hub's own games (skills/mygames.py), kept in a test folder
            import mygames
            test_dir = os.path.join(os.environ["GAME_SAVE_DIR"], "mygames")
            mygames.GAMES_DIR, mygames.LIST_FILE = os.path.join(test_dir, "games"), os.path.join(test_dir, "my_games.json")
            fn = {"games_list": mygames.list_games, "games_remove": lambda g: {**mygames.remove(g), **mygames.list_games()},
                  "games_add_file": lambda p=None: {**(mygames.add_path(p) if p else {"error": "Pick a file in the app (browser test: pass a path)."}), **mygames.list_games()},
                  "games_add_url": lambda u: {**mygames.add_url(u), **mygames.list_games()},
                  "games_launch": lambda g: {"ok": True, "name": "(test: not started)"}}.get(name)
        if name.startswith("gn_") or name == "mm":   # Game Night (ui/games/night.html), its scores kept in the test folder
            import gamenight
            gamenight.FILE = os.path.join(os.environ["GAME_SAVE_DIR"], "gamenight.json")
            import app as vermeil_app
            fn = getattr(vermeil_app.Api, name, None)
            fn = fn and functools.partial(fn, _GN)
        if name == "dev_preview_image":               # save a game picture for the Games hub (ui/games/img/<name>.jpg)
            def fn(pic, data_url):
                import base64, re
                if not re.fullmatch(r"[a-z0-9_]+", pic) or not data_url.startswith("data:image/jpeg;base64,"):
                    return {"error": "bad picture"}
                os.makedirs(os.path.join(ROOT, "ui", "games", "img"), exist_ok=True)
                with open(os.path.join(ROOT, "ui", "games", "img", pic + ".jpg"), "wb") as f:
                    f.write(base64.b64decode(data_url.split(",", 1)[1]))
                return {"ok": True}
        if name == "dev_save_rigged_model":           # save a model rigged in the test page (same as the app's save_rigged_model)
            def fn(model, data_b64):
                import base64, re
                model = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(model or "")) or "model-rigged.glb"
                data = base64.b64decode(data_b64)
                if data[:4] != b"glTF" or not model.lower().endswith(".glb"):
                    return {"error": "That isn't a .glb file."}
                with open(os.path.join(ROOT, "ui", "models", model), "wb") as f:
                    f.write(data)
                return {"name": model}
        out = fn(*args) if fn and not name.startswith("_") else {"error": f"no api {name}"}
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    handler = functools.partial(H, directory=os.path.join(ROOT, "ui"))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
