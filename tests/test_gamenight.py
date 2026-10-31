"""Game Night with Vermeil (skills/gamenight.py): the library and weekly tournament, puzzle of the day with a streak,
trivia, word games, typing words, escape rooms, the drawing game and song tempos (the AI is faked), plus retro games
on the phone (brain/phone.py serves the player and games only with the key cookie)."""
import json, os, sys, tempfile, unittest, urllib.request, urllib.error
from datetime import date, timedelta
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import gamenight  # noqa: E402
import phone  # noqa: E402

MON = date(2026, 10, 26)


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-gamenight-")
        p = mock.patch.object(gamenight, "FILE", os.path.join(self.tmp, "gamenight.json"))
        p.start()
        self.addCleanup(p.stop)


class LibraryTests(_Tmp):
    def test_hours_favourites_and_tournament_points(self):
        gamenight.record("chess", 1800, "win", MON)
        gamenight.record("trivia", 600, "draw", MON)
        r = gamenight.record("uno", 300, "loss", MON + timedelta(days=1))
        t = r["tournament"]
        self.assertEqual((t["you"], t["her"]), (4, 4))
        self.assertEqual(len(t["games"]), 3)
        lib = gamenight.toggle_fav("trivia")
        self.assertEqual(lib["games"][0]["id"], "trivia")                       # favourites first
        chess = next(g for g in lib["games"] if g["id"] == "chess")
        self.assertEqual((chess["minutes"], chess["win"]), (30, 1))
        gamenight.record("retro", 7200)                                          # time only, no result
        self.assertEqual(next(g for g in gamenight.library()["games"] if g["id"] == "retro")["hours"], 2.0)

    def test_new_week_gives_the_trophy(self):
        gamenight.record("chess", 60, "win", MON)
        t = gamenight.tournament(MON + timedelta(days=7))
        self.assertEqual((t["you"], t["her"]), (0, 0))
        self.assertEqual(t["trophies"][0]["winner"], "you")
        self.assertEqual(t["won"], 1)


class PuzzleTests(_Tmp):
    def test_sudoku_is_unique_and_the_streak_counts_days(self):
        p = gamenight.daily_puzzle("sudoku", MON)
        self.assertEqual(gamenight._sudoku_solve(p["grid"][:]), 1)
        self.assertEqual(p, gamenight.daily_puzzle("sudoku", MON))               # the same puzzle all day
        sol = gamenight.make_sudoku(f"sudoku:{MON.isoformat()}")["solution"]
        bad = sol[:]
        i = p["grid"].index(0)
        bad[i] = bad[i] % 9 + 1
        self.assertEqual(gamenight.puzzle_check("sudoku", bad, MON)["wrong"], [i])
        self.assertEqual(gamenight.puzzle_check("sudoku", sol, MON)["streak"], 1)
        tue = MON + timedelta(days=1)
        sol2 = gamenight.make_sudoku(f"sudoku:{tue.isoformat()}")["solution"]
        self.assertEqual(gamenight.puzzle_check("sudoku", sol2, tue)["streak"], 2)
        self.assertEqual(gamenight.daily_puzzle("sudoku", tue + timedelta(days=2))["streak"], 0)   # a missed day

    def test_nonogram_checks_the_clues(self):
        p = gamenight.daily_puzzle("nonogram", MON)
        sol = gamenight.make_nonogram(f"nonogram:{MON.isoformat()}")["solution"]
        self.assertTrue(gamenight.puzzle_check("nonogram", sol, MON)["solved"])
        self.assertFalse(gamenight.puzzle_check("nonogram", [[0] * p["size"]] * p["size"], MON)["solved"])
        with self.assertRaises(ValueError):
            gamenight.daily_puzzle("chess")


class AskTests(_Tmp):
    def test_trivia_from_ai_and_fallback(self):
        q = {"category": "Science", "question": "2+2?", "choices": ["3", "4", "5", "6"], "answer": 1, "fact": "x"}
        r = gamenight.trivia(["Science"], 3, ask=lambda p: {"questions": [q, {"question": "broken"}]})
        self.assertEqual(len(r["questions"]), 3)
        self.assertIn("2+2?", [x["question"] for x in r["questions"]])
        def boom(p): raise RuntimeError("no AI")
        r = gamenight.trivia(["Animals"], 3, ask=boom)
        self.assertTrue(all(x["category"] == "Animals" for x in r["questions"]))

    def test_words_other_language_cached(self):
        calls = []
        ai = lambda p: calls.append(p) or {"five": ["gatos", "perro", "casas", "mesas", "libro", "verde", "playa", "fuego", "nieve"],
                                           "hangman": [{"word": f"palabra{c}", "hint": "word"} for c in "abcde"]}
        r = gamenight.words("es", ask=ai)
        self.assertIn("perro", r["five"])
        gamenight.words("es", ask=ai)
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(len(w) == 5 for w in gamenight.words("en")["five"]))

    def test_escape_room_fallback_and_answers(self):
        def boom(p): raise RuntimeError("no AI")
        with mock.patch.object(gamenight, "_cards", return_value=[]):
            r = gamenight.escape_room("Math", ask=boom)
        self.assertEqual(len(r["rooms"]), 3)
        room = {"answer": "Mitochondria", "also": ["the mitochondrion"]}
        self.assertTrue(gamenight.escape_check("  mitochondria!", room))
        self.assertTrue(gamenight.escape_check("The Mitochondrion", room))
        self.assertFalse(gamenight.escape_check("", room))

    def test_typing_words_from_cards(self):
        cards = [{"front": f"term{i}", "back": "meaning", "deck": "Bio"} for i in range(12)]
        with mock.patch.object(gamenight, "_cards", return_value=cards):
            r = gamenight.typing_words(20)
        self.assertEqual((r["source"], r["decks"], len(r["words"])), ("your study cards", ["Bio"], 20))

    def test_drawing_and_doodles(self):
        r = gamenight.guess_drawing("data:image/jpeg;base64,AAAA", "cat", see=lambda d, p: {"guess": "Cat", "others": ["dog"], "comment": "meow"})
        self.assertTrue(r["right"])
        self.assertIn("error", gamenight.guess_drawing("nope"))
        d = gamenight.her_doodle()
        self.assertTrue(gamenight.doodle_check(d["id"], d["id"].upper()))
        self.assertTrue(gamenight.doodle_check("boat", "ship"))

    def test_song_bpm_cached_and_folded(self):
        self.assertEqual(gamenight.song_bpm("Slow", ask=lambda p: {"bpm": 60})["bpm"], 120)
        self.assertEqual(gamenight.song_bpm("Slow", ask=lambda p: {"bpm": 999})["bpm"], 120)     # cached
        self.assertEqual(gamenight.song_bpm("Unknown", ask=lambda p: {})["bpm"], 104)


class PhoneRetroTests(unittest.TestCase):
    KEY = "r" * 32

    @classmethod
    def setUpClass(cls):
        cls.srv = phone.PhoneServer({"retro_load": lambda p: {"args": p.get("args")}}, port=0, key=cls.KEY)
        cls.port = cls.srv.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def get(self, path, cookie=None):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}")
        if cookie:
            r.add_header("Cookie", cookie)
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_player_needs_the_cookie_and_stays_in_its_folder(self):
        self.assertEqual(self.get("/phone/retro/player.html")[0], 401)
        self.srv._fails = []
        code, body = self.get("/phone/retro/player.html", f"a=1; vk={self.KEY}")
        self.assertEqual(code, 200)
        self.assertIn(b"EJS_", body)
        for bad in ("/phone/retro/games.js", "/phone/retro/../../app.py", "/phone/retro/roms/%2e%2e/games.js", "/phone/retro/emulatorjs//x"):
            self.assertEqual(self.get(bad, f"vk={self.KEY}")[0], 404, bad)

    def test_save_states_may_be_big(self):
        self.assertGreater(phone.MAX_SAVE, phone.MAX_JSON)


if __name__ == "__main__":
    unittest.main()
