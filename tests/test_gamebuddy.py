"""Her box over games (skills/gamebuddy.py): which programs are games, where she sits, what she says - no game, no AI needed."""
import os, sys, tempfile, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa
import sandbox  # noqa: E402,F401
import numpy as np
from PIL import Image
import gamebuddy as gb


def picture(left_bar=0.0, right_bar=0.0, brightness=120, w=160, h=90):
    a = np.full((h, w), brightness, dtype=np.uint8)
    a[:, :int(left_bar * w)] = 0
    if right_bar:
        a[:, w - int(right_bar * w):] = 0
    return Image.fromarray(a)


class WhichGame(unittest.TestCase):
    def test_steam_games_by_their_path(self):
        self.assertEqual(gb.game_name(r"E:\SteamLibrary\steamapps\common\Brawlhalla\Brawlhalla.exe", {}), "Brawlhalla")

    def test_steam_itself_isnt_a_game(self):
        self.assertIsNone(gb.game_name(r"C:\Program Files (x86)\Steam\steam.exe", {}))

    def test_other_launchers_by_their_folders(self):
        dirs = {os.path.normcase(r"D:\Epic\Fortnite"): "Fortnite"}
        self.assertEqual(gb.game_name(r"D:\Epic\Fortnite\bin\game.exe", dirs), "Fortnite")
        self.assertIsNone(gb.game_name(r"D:\Epic\Fortnite2\game.exe", dirs))

    def test_the_emulator_names_the_retro_game(self):
        with mock.patch.object(gb, "retro_title", "Pokemon Emerald"):
            self.assertEqual(gb.game_name(r"C:\x\retroarch.exe", {}), "Pokemon Emerald")

    def test_everything_else_isnt_a_game(self):
        for exe in (r"C:\Program Files\Google\Chrome\chrome.exe", r"C:\Windows\explorer.exe", ""):
            self.assertIsNone(gb.game_name(exe, {}))


class WhereSheSits(unittest.TestCase):
    GAME = (0, 0, 1920, 1080)

    def test_finds_black_bars(self):
        left, right = gb.side_bars(picture(0.25, 0.1))
        self.assertAlmostEqual(left, 0.25, places=2)
        self.assertAlmostEqual(right, 0.1, places=2)

    def test_a_dark_moment_says_nothing(self):
        self.assertIsNone(gb.side_bars(picture(brightness=0)))

    def test_a_full_picture_goes_in_the_corner(self):
        mode, x, y, size = gb.best_spot(gb.side_bars(picture()), self.GAME)
        self.assertEqual((mode, size), ("corner", gb.CORNER))
        self.assertEqual((x, y), (gb.MARGIN, gb.MARGIN))

    def test_a_wide_bar_on_the_right(self):
        mode, x, y, size = gb.best_spot(gb.side_bars(picture(0.05, 0.3)), self.GAME)
        self.assertEqual(mode, "side")
        self.assertGreaterEqual(x, 1920 * 0.7 - 1)                    # inside the bar
        self.assertLessEqual(x + size, 1920)

    def test_a_wide_bar_on_the_left(self):
        mode, x, y, size = gb.best_spot(gb.side_bars(picture(0.3, 0.0)), self.GAME)
        self.assertEqual(mode, "side")
        self.assertLessEqual(x + size, 1920 * 0.3 + 1)

    def test_a_narrow_bar_isnt_room_enough(self):
        self.assertEqual(gb.best_spot(gb.side_bars(picture(0.05, 0.05)), self.GAME)[0], "corner")

    def test_the_window_grows_for_her_words(self):
        self.assertEqual(gb.window_size("corner", 190, False), (190, 190))
        self.assertEqual(gb.window_size("corner", 190, True), (190 + gb.BUBBLE_WIDE, 190))
        self.assertEqual(gb.window_size("side", 300, True), (300, 300 + gb.BUBBLE_TALL))


class HerWords(unittest.TestCase):
    def test_a_good_answer(self):
        self.assertEqual(gb.parse_line('{"say": "Watch the left!", "mood": "Surprised"}'), ("Watch the left!", "surprised"))

    def test_nothing_usable_means_quiet(self):
        for bad in ("", None, "{broken", '{"say": ""}'):
            self.assertEqual(gb.parse_line(bad)[0], "", bad)

    def test_unknown_moods_are_dropped(self):
        self.assertEqual(gb.parse_line('{"say": "Hi", "mood": "evil"}'), ("Hi", ""))


class Looking(unittest.TestCase):
    """she only ever looks at the game, and only while it's in front"""
    def session(self):
        s = gb.Session("Game", 1)
        s.game_hwnd, s.hwnd, s.visible = 10, 20, True
        return s

    def run_loop(self, s, fg, see=True):
        think = mock.Mock(return_value=("Nice!", "happy"))
        ticks = iter(range(3))
        def sleep(_):
            if next(ticks, None) is None:
                s.closing = True
        with mock.patch.object(gb.ow, "foreground", return_value=fg), mock.patch.object(gb.ow, "rect", return_value=(0, 0, 100, 100)), \
             mock.patch.object(gb, "FIRST_TIP_AFTER", -1), mock.patch.object(gb.time, "sleep", side_effect=sleep), \
             mock.patch.object(gb, "settings", return_value={"on": True, "see": see}), mock.patch.object(gb.ow, "grab", return_value="pic") as grab, \
             mock.patch.object(s, "speak") as speak:
            s._tip_loop(think)
        return think, grab, speak

    def test_looks_while_the_game_is_in_front(self):
        s = self.session()
        think, grab, speak = self.run_loop(s, 10)
        grab.assert_called_once_with((0, 0, 100, 100))                # the game's window only
        speak.assert_called_once_with("Nice!", "happy")

    def test_never_looks_when_something_else_is_in_front(self):
        think, grab, _ = self.run_loop(self.session(), 999)
        grab.assert_not_called()

    def test_never_looks_when_you_said_no(self):
        think, grab, _ = self.run_loop(self.session(), 10, see=False)
        grab.assert_not_called()


class AppStepsAside(unittest.TestCase):
    def test_it_hears_when_a_game_comes_and_goes(self):
        heard = []
        exes = [r"E:\steamapps\common\Game\game.exe", r"E:\steamapps\common\Game\game.exe", r"C:\Windows\explorer.exe"]
        with mock.patch.object(gb, "on_game_front", heard.append), mock.patch.object(gb, "_front", False), mock.patch.object(gb, "_session", None), \
             mock.patch.object(gb, "settings", return_value={"on": False, "see": True}), mock.patch.object(gb.ow, "foreground", return_value=5), \
             mock.patch.object(gb.ow, "find", return_value=0), mock.patch.object(gb.ow, "pid_of", return_value=1), mock.patch.object(gb, "_exe_of", side_effect=exes):
            for _ in exes:
                gb._tick()
        self.assertEqual(heard, [True, False])                        # once each, not every second


class Dragging(unittest.TestCase):
    def test_she_stays_where_you_put_her(self):
        s = gb.Session("Game", 1)
        s.hwnd = 20
        with mock.patch.object(gb.ow, "rect", return_value=(100, 100, 300, 300)), mock.patch.object(gb.ow, "place") as place:
            gb.BoxApi(s).move_by(30, -10)
        place.assert_called_once_with(20, 130, 90, 200, 200)
        self.assertTrue(s.moved_by_you)


class Picture(unittest.TestCase):
    def test_no_window_no_picture(self):
        with self.assertRaises(ValueError):                           # never the whole screen
            gb.ow.grab(None)


class Settings(unittest.TestCase):
    def test_on_by_default_and_remembered(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(gb, "SETTINGS_FILE", os.path.join(d, "b.json")):
            self.assertEqual(gb.settings(), {"on": True, "see": True})
            gb.save_settings(on=False)
            self.assertEqual(gb.settings(), {"on": False, "see": True})


if __name__ == "__main__":
    unittest.main()
