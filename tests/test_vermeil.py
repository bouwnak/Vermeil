"""
Automated tests for Vermeil (pinakamain.py + f1.py).

Run from the project folder:   python -m unittest discover -s tests -v

No microphone, speakers, camera, Docker or internet needed: the network, Groq,
the mic and the audio player are replaced with fakes, and all files are written
to a temporary folder (your real data.json / notes / memory are never touched).
"""
import os
import sys
import json
import shutil
import tempfile
import datetime
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)

# Libraries that need hardware are replaced only if they aren't installed.
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import f1                 # noqa: E402
import pinakamain as pm   # noqa: E402

try:
    import sympy  # noqa: F401
    HAVE_SYMPY = True
except ImportError:
    HAVE_SYMPY = False


class TempFilesMixin:
    """Point every file Vermeil writes at a temp folder."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [
            mock.patch.object(f1, "DATA_FILE", os.path.join(self.tmp, "data.json")),
            mock.patch.object(f1, "NOTES_FILE", os.path.join(self.tmp, "notes.txt")),
            mock.patch.object(f1, "PLAYLIST_FILE", os.path.join(self.tmp, "playlist.txt")),
            mock.patch.object(pm, "MEMORY_FILE", os.path.join(self.tmp, "vermeil_memory_0.json")),
            mock.patch.object(pm, "ARCHIVE_FILE", os.path.join(self.tmp, "vermeil_archive.json")),
        ]
        for p in self.patches:
            p.start()
        f1.user_data = f1._empty_data()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def saved(self):
        with open(f1.DATA_FILE, encoding="utf-8") as f:
            return json.load(f)


# ----------------------------------------------------------------- f1 features
class NotesTests(TempFilesMixin, unittest.TestCase):
    def test_add_view_remove_clear(self):
        self.assertEqual(f1.manage_notes("view"), "No notes found.")
        f1.manage_notes("add", "buy milk")
        f1.manage_notes("add", "call mom")
        self.assertEqual(f1.manage_notes("view"), "buy milk\ncall mom")
        self.assertEqual(f1.manage_notes("remove", "MILK"), "Note removed.")
        self.assertEqual(f1.manage_notes("view"), "call mom")
        self.assertEqual(f1.manage_notes("remove", "xyz"), "Note not found.")
        self.assertEqual(f1.manage_notes("clear"), "All notes cleared.")
        self.assertEqual(f1.manage_notes("view"), "No notes found.")

    def test_missing_input_does_not_crash_or_save(self):
        self.assertEqual(f1.manage_notes("add", None), f1.NOT_HEARD)
        self.assertEqual(f1.manage_notes("remove", None), f1.NOT_HEARD)
        self.assertFalse(os.path.exists(f1.NOTES_FILE))


class RemindersTests(TempFilesMixin, unittest.TestCase):
    def test_add_view_remove(self):
        f1.add_reminder("Dentist", "2026-10-20 09:00")
        self.assertEqual(self.saved()["reminders"][0]["event"], "Dentist")
        self.assertIn("Dentist on 2026-10-20 09:00", f1.get_reminders())
        self.assertEqual(f1.remove_reminder("dentist"), "Removed reminder for dentist.")
        self.assertEqual(f1.get_reminders(), "No upcoming reminders.")

    def test_reminder_without_time_is_rejected(self):
        self.assertIn("didn't save", f1.add_reminder("birthday", None))
        self.assertEqual(f1.user_data["reminders"], [])

    def test_old_reminder_with_no_time_still_displays(self):
        f1.user_data["reminders"] = [{"event": "birthday", "date_time": None, "added": "x"}]
        self.assertEqual(f1.get_reminders(), "birthday on no time set")


class TaskTests(TempFilesMixin, unittest.TestCase):
    def test_tasks_sorted_by_priority(self):
        f1.add_task("laundry", None, "low")
        f1.add_task("thesis revisions", "18:00", "high", "2026-10-25")
        f1.add_task("dishes", None, "weird-value")
        lines = f1.get_tasks().splitlines()
        self.assertTrue(lines[0].startswith("thesis revisions at 18:00 | priority high | due 2026-10-25"))
        self.assertIn("dishes | priority normal", lines[1])
        self.assertIn("laundry | priority low", lines[2])
        self.assertEqual(f1.remove_task("Dishes"), "Task removed: Dishes.")
        self.assertEqual(len(self.saved()["tasks"]), 2)
        f1.clear_tasks()
        self.assertEqual(f1.get_tasks(), "No tasks in the to-do list.")


class ScheduleTests(TempFilesMixin, unittest.TestCase):
    def test_add_view_remove(self):
        f1.add_schedule("Monday", "gym", "17:00")
        f1.add_schedule("Monday", "study", None)
        self.assertEqual(f1.get_schedule(), "Monday: gym at 17:00, study")
        self.assertEqual(f1.remove_schedule("Monday", "GYM"), "Removed GYM from your schedule on Monday.")
        self.assertEqual(f1.remove_schedule("Friday", "x"), "Day not found in schedule.")
        f1.clear_schedule()
        self.assertEqual(f1.get_schedule(), "No schedule set for the week.")

    def test_old_list_format_is_converted(self):
        with open(f1.DATA_FILE, "w") as f:
            json.dump({"schedule": [{"day": "Tuesday", "activity": "swim", "time": "08:00", "added": "x"}]}, f)
        data = f1.load_data()
        self.assertEqual(data["schedule"], {"Tuesday": [{"activity": "swim", "time": "08:00", "added": "x"}]})


class AgendaAndBirthdayTests(TempFilesMixin, unittest.TestCase):
    def test_agenda_shows_only_today(self):
        today = datetime.datetime(2026, 10, 19, 8, 0)          # a Monday
        f1.add_reminder("meeting", "2026-10-19 14:00")
        f1.add_reminder("later thing", "2026-11-01 10:00")
        f1.add_schedule("Monday", "gym", "17:00")
        f1.add_schedule("Friday", "party", "20:00")
        f1.add_task("email adviser", None)
        agenda = f1.daily_agenda(today)
        self.assertIn("Reminder: meeting at 14:00", agenda)
        self.assertIn("Schedule: gym at 17:00", agenda)
        self.assertIn("Task: email adviser", agenda)
        self.assertNotIn("later thing", agenda)
        self.assertNotIn("party", agenda)

    def test_agenda_empty(self):
        self.assertEqual(f1.daily_agenda(datetime.datetime(2026, 10, 19)), "Nothing on your agenda today.")

    def test_birthday_parsing_and_countdown(self):
        self.assertEqual(f1.add_birthday("Mia", "October 22nd"), "Birthday for Mia added.")
        f1.add_birthday("Leo", "2001-10-19")
        self.assertIn("couldn't understand", f1.add_birthday("Bob", "someday"))
        alerts = f1.check_upcoming_birthdays(datetime.date(2026, 10, 19))
        self.assertIn("Today is Leo's birthday!", alerts)
        self.assertIn("Mia's birthday is in 3 days.", alerts)
        # birthday that already passed this year counts toward next year, not negative days
        self.assertEqual(f1._days_until_birthday("01-01", datetime.date(2026, 12, 31)), 1)
        self.assertEqual(f1._days_until_birthday("02-29", datetime.date(2027, 2, 28)), 1)


class ShoppingTests(TempFilesMixin, unittest.TestCase):
    def test_add_categorize_view_clear(self):
        f1.add_shopping_items("chicken, rice and soap, eggs")
        f1.add_shopping_items("eggs")                           # no duplicates
        listing = f1.get_shopping_list()
        self.assertIn("Meat: chicken", listing)
        self.assertIn("Grains: rice", listing)
        self.assertIn("Household: soap", listing)
        self.assertIn("Other: eggs", listing)
        self.assertEqual(listing.count("eggs"), 1)
        f1.clear_shopping_list()
        self.assertEqual(f1.get_shopping_list(), "Shopping list is empty.")


class WeatherAndSearchTests(TempFilesMixin, unittest.TestCase):
    WAPI = {"location": {"name": "Manila", "country": "Philippines"},
            "current": {"condition": {"text": "Partly cloudy"}, "temp_c": 31},
            "forecast": {"forecastday": [{"date": "2026-10-21", "day": {"condition": {"text": "Rain"}, "mintemp_c": 25,
                                                                        "maxtemp_c": 31, "daily_chance_of_rain": 80}}]}}

    def test_weather_success_uses_https_and_timeout(self):
        import web
        fake = mock.Mock(status_code=200)
        fake.json.return_value = self.WAPI
        with mock.patch.dict(os.environ, {"WEATHER_API_KEY": "k"}), \
                mock.patch.object(web.requests, "get", return_value=fake) as get:
            self.assertEqual(f1.get_weather("manila"),
                             "The weather in Manila is partly cloudy with a temperature of 31°C.")
        self.assertTrue(get.call_args.args[0].startswith("https://"))
        self.assertIn("timeout", get.call_args.kwargs)

    def _meteo(self, url, params=None, timeout=None):
        r = mock.Mock(status_code=200)
        if "geocoding" in url:
            r.json.return_value = {"results": [{"name": "Manila", "country": "Philippines", "latitude": 14.6, "longitude": 121}]}
        else:
            r.json.return_value = {"current": {"temperature_2m": 29.5, "weather_code": 61},
                                   "daily": {"time": ["2026-10-21"], "weather_code": [63], "temperature_2m_min": [25],
                                             "temperature_2m_max": [31], "precipitation_probability_max": [70]}}
        return r

    def test_weather_falls_back_when_weatherapi_times_out(self):
        import web
        def get(url, params=None, timeout=None):
            if "weatherapi" in url:
                raise web.requests.ConnectTimeout("timed out")
            return self._meteo(url, params, timeout)
        with mock.patch.dict(os.environ, {"WEATHER_API_KEY": "k"}), mock.patch.object(web.requests, "get", side_effect=get), \
                mock.patch.object(web.time, "sleep"):
            self.assertEqual(f1.get_weather("Manila"), "The weather in Manila is light rain with a temperature of 29.5°C.")
            f = web.forecast("Manila", 1)
        self.assertEqual((f["days"][0]["text"], f["days"][0]["rain_chance"], f["alerts"]), ("Rain", 70, []))

    def test_weather_without_key_uses_free_service(self):
        import web
        with mock.patch.dict(os.environ, {"WEATHER_API_KEY": ""}), mock.patch.object(web.requests, "get", side_effect=self._meteo):
            self.assertIn("Manila", f1.get_weather("Manila"))

    def test_weather_failures(self):
        import web
        self.assertEqual(f1.get_weather(None), f1.NOT_HEARD)
        with mock.patch.dict(os.environ, {"WEATHER_API_KEY": "k"}), \
                mock.patch.object(web.requests, "get", side_effect=web.requests.ConnectionError), mock.patch.object(web.time, "sleep"):
            self.assertIn("couldn't reach", f1.get_weather("Manila"))
            self.assertTrue(web.forecast("Manila").get("offline"))

    def test_search_url_encoded(self):
        with mock.patch.object(f1.webbrowser, "open") as op:
            f1.web_search("C++ & python")
        self.assertEqual(op.call_args.args[0], "https://www.google.com/search?q=C%2B%2B+%26+python")


class VolumeTests(unittest.TestCase):
    def test_uses_windows_slider_scale_and_clamps(self):
        iface = mock.Mock()
        with mock.patch.object(f1, "_volume_interface", return_value=iface):
            self.assertEqual(f1.set_volume(50), "Volume set to 50%.")
            iface.SetMasterVolumeLevelScalar.assert_called_with(0.5, None)
            self.assertEqual(f1.set_volume(250), "Volume set to 100%.")
        self.assertEqual(f1.set_volume(None), f1.NOT_HEARD)


@unittest.skipUnless(HAVE_SYMPY, "sympy not installed")
class MathTests(unittest.TestCase):
    def test_math(self):
        self.assertEqual(f1.solve_math("12 times 8"), "The answer is 96.")
        self.assertEqual(f1.solve_math("2x + 3 = 7"), "x = 2")
        self.assertEqual(f1.solve_math("what is 10 divided by 4"), "The answer is 2.5.")
        self.assertEqual(f1.solve_math("x squared = 9"), "x = -3, 3")
        self.assertEqual(f1.solve_math("square root of 16"), "The answer is 4.")
        self.assertIn("doesn't look like", f1.solve_math("import os; os.system('x')"))
        self.assertEqual(f1.solve_math(None), f1.NOT_HEARD)


class CalendarTests(TempFilesMixin, unittest.TestCase):
    def test_add_list_remove_events(self):
        self.assertIn("on Friday, October 23 at 10:00", f1.add_event("Dentist", "2026-10-23", "10:00"))
        f1.add_event("Thesis defense", "2026-10-21")
        f1.add_event("Far away", "2026-12-25")
        listing = f1.list_events("2026-10-20", 7)
        self.assertEqual(listing.splitlines(), ["Wed Oct 21: Thesis defense", "Fri Oct 23 10:00: Dentist"])
        self.assertIn("need a title and a date", f1.add_event("x", "next friday"))
        self.assertEqual(f1.remove_event("dentist"), "Removed 1 event called 'dentist'.")
        self.assertEqual(len(self.saved()["events"]), 2)
        self.assertIn("Event: Thesis defense (all day)", f1.daily_agenda(datetime.datetime(2026, 10, 21, 8)))

    def test_alerts_fire_once(self):
        f1.add_reminder("Call mom", "2026-10-20 17:00")
        f1.add_event("Meeting", "2026-10-20", "18:00")
        self.assertEqual(f1.due_alerts(datetime.datetime(2026, 10, 20, 16, 59)), [])
        self.assertEqual(f1.due_alerts(datetime.datetime(2026, 10, 20, 17, 0)), ["Reminder: Call mom"])
        self.assertEqual(f1.due_alerts(datetime.datetime(2026, 10, 20, 17, 52)), ["Coming up at 18:00: Meeting"])
        self.assertEqual(f1.due_alerts(datetime.datetime(2026, 10, 20, 17, 55)), [])          # only once

    def test_remove_shopping_item(self):
        f1.add_shopping_items("eggs, rice")
        self.assertEqual(f1.remove_shopping_item("Eggs"), "Removed eggs from your shopping list.")
        self.assertEqual(f1.get_shopping_list(), "Grains: rice")


class ToolTests(TempFilesMixin, unittest.TestCase):
    def test_every_tool_has_an_action(self):
        import tools
        names = {t["function"]["name"] for t in tools.TOOLS}
        self.assertEqual(names, set(tools._ACTIONS))

    def test_run_tool_calls_feature(self):
        import tools
        self.assertIn("Added 'Gym' to your calendar", tools.run_tool("add_event", '{"title": "Gym", "date": "2026-10-22", "time": "07:00"}'))
        self.assertEqual(f1.user_data["events"][0]["title"], "Gym")
        self.assertIn("not valid JSON", tools.run_tool("add_event", "{oops"))
        self.assertIn("Wrong arguments", tools.run_tool("add_event", '{"colour": "red"}'))
        self.assertIn("Unknown tool", tools.run_tool("make_coffee", "{}"))

    def test_risky_tools_need_a_yes(self):
        import tools
        f1.add_task("laundry", None)
        self.assertIn("said no", tools.run_tool("clear_tasks", "{}", confirm=lambda q: False))
        self.assertEqual(len(f1.user_data["tasks"]), 1)
        asked = []
        tools.run_tool("clear_tasks", "{}", confirm=lambda q: asked.append(q) or True)
        self.assertEqual(f1.user_data["tasks"], [])
        self.assertEqual(asked, ["delete all your tasks"])
        with mock.patch.object(f1, "system_control") as sc:
            self.assertIn("said no", tools.run_tool("system_control", '{"command": "shutdown"}', confirm=None))
            sc.assert_not_called()


class EmailTests(unittest.TestCase):
    def test_spoken_address(self):
        self.assertEqual(f1._spoken_email("John dot Doe at gmail dot com"), "john.doe@gmail.com")

    def test_needs_setup_and_valid_address(self):
        with mock.patch.dict(os.environ, {"EMAIL_ADDRESS": "", "EMAIL_APP_PASSWORD": ""}):
            self.assertIn("isn't set up", f1.send_email("a@b.com", "hi", "hello"))
        with mock.patch.dict(os.environ, {"EMAIL_ADDRESS": "me@gmail.com", "EMAIL_APP_PASSWORD": "pw"}):
            self.assertIn("isn't a valid email", f1.send_email("bob", "hi", "hello"))
            with mock.patch.object(f1.smtplib, "SMTP_SSL") as smtp:
                self.assertEqual(f1.send_email("bob at gmail dot com", "Hi", "Hello"), "Email sent to bob@gmail.com.")
                sent = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
                self.assertEqual(sent["To"], "bob@gmail.com")

    def test_send_message_does_not_crash(self):
        self.assertIn("isn't set up", f1.send_message("discord", "bob", "hi"))


class MusicTests(TempFilesMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        f1._clear_queue()
        self.ensure = mock.patch.object(f1, "_ensure_player").start()

    def tearDown(self):
        mock.patch.stopall()
        f1._clear_queue()
        super().tearDown()

    def test_queue_controls(self):
        self.assertEqual(f1.music_control("play", "song a"), "Playing 'song a' now.")
        self.assertEqual(f1.music_control("play", "song b", "later"), "Added 'song b' to the end of the queue (2 waiting).")
        self.assertEqual(f1.music_control("queue"), "Queued songs:\n1. song a\n2. song b")
        self.assertEqual(f1.music_control("shuffle"), "Shuffled the queue.")
        self.assertEqual(sorted(f1.music_queue.queue), ["song a", "song b"])   # same songs, any order
        self.assertEqual(f1.music_control("clear queue"), "Cleared all upcoming songs from the queue.")
        self.assertEqual(f1.music_control("queue"), "The queue is empty.")
        self.assertEqual(f1.music_control("play", ""), "Please tell me what song to play.")
        self.assertEqual(f1.music_control("skip"), "No song to skip.")

    def test_stop_clears_queue_before_killing(self):
        f1.music_queue.put("next song")
        proc = mock.Mock()
        proc.poll.return_value = None
        proc.kill.side_effect = lambda: self.assertTrue(f1.music_queue.empty())
        with mock.patch.object(f1, "current_process", proc):
            self.assertEqual(f1.music_control("stop"), "Stopped music and cleared the queue.")
        proc.kill.assert_called_once()

    def test_playlist_strips_numbers(self):
        with open(f1.PLAYLIST_FILE, "w", encoding="utf-8") as f:
            f.write("1. truthfully by DNCE\n\n2) no sabo by micah palace\nplain song\n")
        self.assertEqual(f1.load_playlist(), ["truthfully by DNCE", "no sabo by micah palace", "plain song"])
        self.assertEqual(f1.music_control("playlist"), "Loaded 3 songs from your playlist.")


class CameraCommandTests(unittest.TestCase):
    def test_camera_commands(self):
        with mock.patch.object(f1, "presence", None):
            self.assertEqual(f1.camera_off(), "The camera is already off.")
            self.assertIn("camera is off", f1.who_do_you_see())
        fake = mock.Mock(running=True, owner={"name": "JP"}, owner_name="JP",
                         state={"present": True, "who": "owner"})
        with mock.patch.object(f1, "presence", fake):
            self.assertEqual(f1.who_do_you_see(), "I see you, JP.")
            fake.state = {"present": True, "who": "someone"}
            self.assertIn("don't think it's you", f1.who_do_you_see())
            fake.state = {"present": False, "who": None}
            self.assertEqual(f1.who_do_you_see(), "I don't see anyone right now.")
            self.assertEqual(f1.camera_off(), "Camera off.")
            fake.stop.assert_called_once()


# ----------------------------------------------------------------- pinakamain
class CommandMatchingTests(unittest.TestCase):
    cm = pm.build_command_map()

    def check(self, phrase, expected):
        self.assertEqual(pm.get_best_command_match(phrase, self.cm), expected, phrase)

    def test_natural_phrases(self):
        cases = {
            "what's the weather like": "weather",
            "can you add a note for me": "add note",
            "show me my notes": "view note",
            "delete a note": "remove note",
            "show my reminders": "view reminder",
            "add a task please": "add task",
            "what's on my agenda today": "today agenda",
            "turn vision mode off": "vision mode off",
            "start vision mode": "vision mode",
            "play some music": "play music",
            "play my playlist": "play playlist",
            "show my playlist": "show playlist",
            "add eggs to my shopping list": "add shopping",
            "set the volume": "set volume",
            "vermi turn the camera on": "camera on",
            "turn off the camera": "camera off",
            "add a birthday": "add birthday",
            "solve a math problem": "solve math",
            "shut down": "shutdown",
        }
        for phrase, expected in cases.items():
            self.check(phrase, expected)

    def test_chat_is_not_a_command(self):
        for phrase in ("can you see me", "how many fingers can you see", "tell me a joke", "I had a great time today", "how are you darling",
                       "I love you", "what time is it", "good morning"):
            self.check(phrase, None)

    def test_shutdown_needs_confirmation(self):
        with mock.patch.object(pm, "ask", return_value="no"), mock.patch.object(f1, "system_control") as sc:
            self.assertEqual(self.cm["shutdown"](), "Okay, I won't shut down the computer.")
            sc.assert_not_called()
        with mock.patch.object(pm, "ask", return_value="yes"), mock.patch.object(f1, "system_control",
                                                                               return_value="ok") as sc:
            self.assertEqual(self.cm["shutdown"](), "ok")
            sc.assert_called_once_with("shutdown")

    def test_wake_word(self):
        for heard in ("vermi", "hey vermie", "Vermeil are you there", "ok vermy"):
            self.assertTrue(pm._is_wake_word(heard), heard)
        for heard in ("very nice", "remind me", "hello"):
            self.assertFalse(pm._is_wake_word(heard), heard)


class ParsingTests(unittest.TestCase):
    def test_time(self):
        for spoken, expected in {"17:30": "17:30", "5:30 pm": "17:30", "5 pm": "17:00", "12 am": "00:00",
                                 "12:15 pm": "12:15", "5.30 p.m.": "17:30"}.items():
            self.assertEqual(pm._parse_time(spoken).strftime("%H:%M"), expected, spoken)
        for bad in ("banana", "25:00", "5"):
            with self.assertRaises(ValueError):
                pm._parse_time(bad)

    def test_datetime(self):
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        self.assertEqual(pm._parse_datetime("tomorrow at 5:30 pm"), f"{tomorrow} 17:30")
        self.assertEqual(pm._parse_datetime("2026-10-20 18:30"), "2026-10-20 18:30")
        self.assertEqual(pm._parse_datetime("remind me tomorrow 9 am")[-5:], "09:00")
        self.assertIsNone(pm._parse_datetime("whenever"))

    def test_follow_up_questions_in_text_mode(self):
        with mock.patch.object(pm, "voice_mode", False), \
                mock.patch("builtins.input", side_effect=["", "ninety five percent"]):
            self.assertEqual(pm.ask_for_percentage(), 95)
        with mock.patch.object(pm, "voice_mode", False), mock.patch("builtins.input", return_value="note this down: buy eggs"):
            self.assertEqual(pm.ask_for_note(), "buy eggs")
        with mock.patch.object(pm, "voice_mode", False), mock.patch("builtins.input", return_value="High please"):
            self.assertEqual(pm.ask_for_priority(), "high")

    def test_voice_mode_speaks_the_question(self):
        with mock.patch.object(pm, "voice_mode", True), mock.patch.object(pm, "speak") as sp, \
                mock.patch.object(pm, "listen_for_input", return_value="Manila"):
            self.assertEqual(pm.ask_for_city(), "Manila")
        sp.assert_called_once_with("Which city?")


class MemoryTests(TempFilesMixin, unittest.TestCase):
    def test_save_load_and_overflow_goes_to_archive(self):
        msgs = [{"role": "user", "content": str(i)} for i in range(pm.MEMORY_LIMIT + 10)]
        memory = {"user": {"conversations": list(msgs), "preferences": {}}}
        for _ in range(3):
            pm.save_memory(memory)
        loaded = pm.load_memory()
        self.assertEqual(len(loaded["user"]["conversations"]), pm.MEMORY_LIMIT)
        self.assertEqual(loaded["user"]["conversations"][-1]["content"], str(pm.MEMORY_LIMIT + 9))
        with open(pm.ARCHIVE_FILE, encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["user"]), 10)
        self.assertEqual(sorted(os.listdir(self.tmp)), ["vermeil_archive.json", "vermeil_memory_0.json"])

    def test_corrupt_memory_file(self):
        with open(pm.MEMORY_FILE, "w") as f:
            f.write("{broken")
        self.assertEqual(pm.load_memory(), {})


class ChatTests(TempFilesMixin, unittest.TestCase):
    def fake_client(self, text):
        client = mock.Mock()
        client.chat.completions.create.return_value.choices = [mock.Mock(message=mock.Mock(content=text))]
        return client

    def test_reply_cleaned_saved_and_history_limited(self):
        memory = {"user": {"conversations": [{"role": "user", "content": str(i)} for i in range(100)],
                           "preferences": {}}}
        client = self.fake_client("*smiles* I'm an AI " + "word " * 80)
        with mock.patch.object(pm, "get_client", return_value=client), mock.patch.object(pm.random, "random", return_value=0.9):
            reply = pm.get_vermeil_response("user", "hello", memory)
        self.assertFalse(reply.startswith("*"))
        self.assertIn("I'm Vermeil", reply)
        self.assertLessEqual(len(reply.split()), 50)
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertEqual(len(sent), 1 + pm.HISTORY_MESSAGES + 1)     # system + history + new message
        self.assertIn("current time", sent[0]["content"])
        self.assertEqual(pm.load_memory()["user"]["conversations"][-2]["content"], "hello")

    def test_visual_question_sends_camera_picture(self):
        client = self.fake_client("I see three fingers!")
        with mock.patch.object(pm, "get_client", return_value=client), \
                mock.patch.object(pm, "vision_source", lambda: "QUJD"), mock.patch.object(pm, "always_look", False):
            reply = pm.get_vermeil_response("user", "how many fingers can you see", {})
        self.assertIn("three fingers", reply)
        kw = client.chat.completions.create.call_args.kwargs
        self.assertEqual(kw["model"], pm.VISION_MODEL)
        parts = kw["messages"][-1]["content"]
        self.assertEqual(parts[1]["image_url"]["url"], "data:image/jpeg;base64,QUJD")
        self.assertEqual(pm.load_memory()["user"]["conversations"][-2]["content"], "how many fingers can you see")

    def test_normal_chat_does_not_send_picture(self):
        client = self.fake_client("Hello!")
        with mock.patch.object(pm, "get_client", return_value=client), \
                mock.patch.object(pm, "vision_source", lambda: "QUJD"), mock.patch.object(pm, "always_look", False):
            pm.get_vermeil_response("user", "tell me a joke", {})
        self.assertEqual(client.chat.completions.create.call_args.kwargs["model"], pm.LLM_MODEL)

    def test_camera_off_tells_the_ai(self):
        client = self.fake_client("My camera is off.")
        with mock.patch.object(pm, "get_client", return_value=client), mock.patch.object(pm, "vision_source", lambda: None):
            pm.get_vermeil_response("user", "what am I holding", {})
        kw = client.chat.completions.create.call_args.kwargs
        self.assertEqual(kw["model"], pm.LLM_MODEL)
        self.assertIn("camera is off", kw["messages"][0]["content"])

    def test_vision_failure_falls_back_to_text(self):
        client = mock.Mock()
        ok = mock.Mock(); ok.choices = [mock.Mock(message=mock.Mock(content="I couldn't look, sorry."))]
        client.chat.completions.create.side_effect = [RuntimeError("model not found"), ok]
        with mock.patch.object(pm, "get_client", return_value=client), mock.patch.object(pm, "vision_source", lambda: "QUJD"):
            reply = pm.get_vermeil_response("user", "what do you see", {})
        self.assertIn("couldn't look", reply)
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_learn_preferences(self):
        p = {}
        pm.learn_preferences("call me JP please, my favorite color is purple", p)
        pm.learn_preferences("I love matcha and I hate mornings", p)
        pm.learn_preferences("I love mornings now", p)                # changed their mind
        pm.learn_preferences("I like you. I hate when it rains", p)    # not real preferences
        self.assertEqual(p, {"name": "JP", "favourite color": "purple", "likes: matcha": "love", "likes: mornings": "love"})
        self.assertIn("loves matcha", pm.describe_preferences(p))
        self.assertEqual(pm.describe_preferences({}), "")

    def test_think_tags_removed(self):
        self.assertEqual(pm.clean_text("<think>hmm let me count</think>Two fingers!"), "Two fingers!")

    def test_api_failure_returns_fallback_and_saves_nothing(self):
        memory = {}
        client = mock.Mock()
        client.chat.completions.create.side_effect = RuntimeError("network down")
        with mock.patch.object(pm, "get_client", return_value=client):
            self.assertIn("Say that again", pm.get_vermeil_response("user", "hi", memory))
        self.assertFalse(os.path.exists(pm.MEMORY_FILE))

    def test_handle_input_uses_ai_and_falls_back_to_commands(self):
        cm = {"view note": lambda: "your notes", "boom": lambda: 1 / 0}
        with mock.patch.object(pm, "get_vermeil_response", return_value="chat reply"):
            self.assertEqual(pm.handle_input("show my notes", {}, cm), "chat reply")      # the AI handles everything
        with mock.patch.object(pm, "get_vermeil_response", return_value=None):            # AI unreachable
            self.assertEqual(pm.handle_input("show my notes", {}, cm), "your notes")
            self.assertIn("something went wrong", pm.handle_input("boom", {}, cm))
            self.assertIn("can't reach", pm.handle_input("tell me a story", {}, cm))

    def test_ai_uses_tools_then_answers(self):
        call = mock.Mock(id="c1")
        call.function.name = "add_shopping_items"
        call.function.arguments = '{"items": "eggs, milk"}'
        first = mock.Mock(); first.choices = [mock.Mock(message=mock.Mock(content="", tool_calls=[call]))]
        second = mock.Mock(); second.choices = [mock.Mock(message=mock.Mock(content="Added eggs and milk, darling!", tool_calls=None))]
        client = mock.Mock()
        client.chat.completions.create.side_effect = [first, second]
        with mock.patch.object(pm, "get_client", return_value=client), \
                mock.patch.object(pm.tools, "run_tool", return_value="Added to your shopping list: eggs, milk.") as run, \
                mock.patch.object(pm.random, "random", return_value=0.9):
            reply = pm.get_vermeil_response("user", "add eggs and milk to my shopping list", {})
        self.assertEqual(reply, "Added eggs and milk!")
        self.assertEqual(run.call_args.args[:2], ("add_shopping_items", '{"items": "eggs, milk"}'))
        sent = client.chat.completions.create.call_args_list[1].kwargs["messages"]
        self.assertEqual(sent[-1], {"role": "tool", "tool_call_id": "c1", "content": "Added to your shopping list: eggs, milk."})
        self.assertIn("tools", client.chat.completions.create.call_args_list[0].kwargs)


class VoiceLoopTests(unittest.TestCase):
    def test_wake_word_loop_survives_silence_then_wakes(self):
        heard = iter([None, "random noise", "hey vermi"])
        import wakeword
        with mock.patch.object(pm, "voice_mode", True), mock.patch.object(wakeword, "trained", return_value=False), \
                mock.patch.object(pm, "listen_for_input", side_effect=lambda **k: next(heard)), \
                mock.patch.object(pm, "speak") as sp:
            self.assertTrue(pm.listen_for_wake_word())
        self.assertTrue(pm.conversation_active)
        sp.assert_called_once_with("Yes?")

    def test_command_loop_times_out_after_silence(self):
        clock = iter([0, 5, 200, 200])
        with mock.patch.object(pm, "voice_mode", True), mock.patch.object(pm, "conversation_active", True), \
                mock.patch.object(pm, "listen_for_input", return_value=None), \
                mock.patch.object(pm.time, "time", side_effect=lambda: next(clock)):
            pm.listen_for_command({}, {})
            self.assertFalse(pm.conversation_active)

    def test_speak_without_kokoro_just_prints(self):
        with mock.patch.object(pm, "tts_ready", False), mock.patch.object(pm.requests, "post") as post:
            pm.speak("hello")
        post.assert_not_called()

    def test_kokoro_already_running_starts_nothing(self):
        import kokoro
        with mock.patch.dict(kokoro._state, {"ready": True}), mock.patch.object(kokoro, "_load") as load:
            self.assertTrue(pm.ensure_kokoro())
        load.assert_not_called()

    def test_online_voice_only_when_online_and_kokoro_ready(self):
        import kokoro
        with mock.patch.object(pm, "VOICE_ONLINE", "kokoro:af_heart"), mock.patch.object(pm, "VOICE", "piper:x"):
            with mock.patch.object(pm, "online_now", return_value=True), mock.patch.object(kokoro, "ready", return_value=True):
                self.assertEqual(pm.active_voice(), "kokoro:af_heart")
            with mock.patch.object(pm, "online_now", return_value=False), mock.patch.object(kokoro, "ready", return_value=True):
                self.assertEqual(pm.active_voice(), "piper:x")
            # online but Kokoro still loading: wait for it (Kokoro is THE online voice); only if it can't load -> Piper
            with mock.patch.object(pm, "online_now", return_value=True), mock.patch.object(kokoro, "ready", return_value=False), \
                    mock.patch.object(kokoro, "installed", return_value=True), mock.patch.object(kokoro, "start", return_value=True):
                self.assertEqual(pm.active_voice(), "kokoro:af_heart")
            with mock.patch.object(pm, "online_now", return_value=True), mock.patch.object(kokoro, "ready", return_value=False), \
                    mock.patch.object(kokoro, "installed", return_value=True), mock.patch.object(kokoro, "start", return_value=False):
                self.assertEqual(pm.active_voice(), "piper:x")
        # a character without its own Kokoro voice still speaks Kokoro online (a default that fits)
        with mock.patch.object(pm, "VOICE_ONLINE", None), mock.patch.object(pm, "VOICE_GENDER", "male"), \
                mock.patch.object(pm, "online_now", return_value=True), mock.patch.object(kokoro, "ready", return_value=True):
            self.assertEqual(pm.active_voice(), "kokoro:am_michael")

    def test_kokoro_failure_falls_back_to_offline_voice(self):
        import kokoro, tts
        with mock.patch.object(kokoro, "synth", side_effect=OSError("down")), \
                mock.patch.object(tts, "_piper_audio", return_value=("audio", 22050)) as piper:
            self.assertEqual(tts.synth("hi", "kokoro:af_heart", fallback="piper:en_US-amy-medium"), ("audio", 22050))
        self.assertEqual(piper.call_args[0][1], "en_US-amy-medium")


class EnvTests(unittest.TestCase):
    def test_load_env(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, ".env")
        with open(p, "w") as f:
            f.write("# comment\nTEST_VERMEIL_KEY='abc=123'\n\n")
        with mock.patch.dict(os.environ, {}, clear=False):
            pm.load_env(p)
            self.assertEqual(os.environ["TEST_VERMEIL_KEY"], "abc=123")
        shutil.rmtree(d)

    def test_no_hardcoded_keys_in_code(self):
        import glob
        root = os.path.dirname(HERE)
        files = [f for d in ("", "brain", "senses", "skills", "scripts") for f in glob.glob(os.path.join(root, d, "*.py"))]
        self.assertGreater(len(files), 30)
        for name in files:
            with open(name, encoding="utf-8") as f:
                src = f.read()
            self.assertNotRegex(src, r"gsk_[A-Za-z0-9]{20,}", name)
            self.assertNotRegex(src, r"key=\"[0-9a-f]{20,}\"", name)


if __name__ == "__main__":
    unittest.main()
