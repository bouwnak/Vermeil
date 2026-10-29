import os, sys, json, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import baking


class BakingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(baking, "_file", lambda kind: os.path.join(self.tmp, f"{kind}.json")); self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_parse_and_convert(self):
        p = baking.parse_line("2 1/2 cups all-purpose flour")
        self.assertEqual((p["qty"], p["unit"], p["name"]), (2.5, "cup", "all-purpose flour"))
        labels = [c["label"] for c in baking.convert(p["qty"], p["unit"], p["name"])]
        self.assertIn("312 g", labels); self.assertIn("591 ml", labels)
        self.assertEqual(baking.parse_line("½ tsp salt")["qty"], 0.5)
        self.assertIn("100 g", [c["label"] for c in baking.convert(2, "pc", "raw eggs")])

    def test_alternatives_builtin(self):
        self.assertTrue(baking.alternatives("2 large eggs")["options"])
        self.assertTrue(baking.alternatives("soy sauce")["options"])

    def test_two_books_save_edit_star(self):
        baking.ensure_sample("baking"); baking.ensure_sample("cooking")
        self.assertEqual(baking.list_recipes("baking")[0]["title"], "Chocolate Chip Cookies")
        self.assertEqual(baking.list_recipes("cooking")[0]["title"], "Chicken Adobo")
        r = baking.get_recipe(baking.list_recipes("baking")[0]["id"], "baking")
        r["ingredients"].append("1 cup milk"); r["ingredients"] = r["ingredients"][1:]
        r = baking.save_recipe(r, "baking")
        self.assertEqual(r["ingredients"][-1]["unit"], "cup")
        self.assertTrue(baking.toggle_saved(r["id"], "baking")["saved"])

    def test_import_json_ld(self):
        page = '<script type="application/ld+json">{"@type":"Recipe","name":"Brownies","recipeYield":"16",' \
               '"recipeIngredient":["1 cup sugar","2 eggs"],"recipeInstructions":[{"@type":"HowToStep","text":"Bake 25 minutes."}],' \
               '"nutrition":{"calories":"200 kcal"}}</script>'
        with mock.patch.object(baking.requests, "get", return_value=mock.Mock(text=page, raise_for_status=lambda: None)):
            r = baking.import_url("https://x.com/brownies", "baking")
        self.assertEqual((r["title"], r["servings"], len(r["ingredients"]), r["steps"]), ("Brownies", 16, 2, ["Bake 25 minutes."]))
        self.assertEqual(r["nutrition"]["rows"][0]["value"], "200 kcal")

    def test_search_mixes_places(self):
        import web
        def fake(q, n=8):
            if "tiktok" in q:
                return [{"title": f"tt {i}", "url": f"https://www.tiktok.com/@chef/video/{i}{abs(hash(q)) % 99}", "snippet": ""} for i in range(4)]
            return [{"title": f"{q} {i}", "url": f"https://www.allrecipes.com/{abs(hash(q))}/{i}", "snippet": ""} for i in range(4)]
        yt = [{"title": "Cookies", "url": "https://www.youtube.com/watch?v=abcdefghijk", "channel": "Tasty", "minutes": 8.5}]
        with mock.patch.object(web, "search", side_effect=fake), mock.patch.object(web, "youtube_search", return_value=yt), \
                mock.patch.object(baking, "video_thumb", side_effect=lambda u: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" if "youtube" in u else "https://p16.tiktokcdn.com/x.jpg"):
            res = baking.search_online("cookie")
        self.assertEqual([r["type"] for r in res[:3]], ["YouTube", "TikTok", "Website"])
        self.assertTrue(res[0]["thumb"].startswith("https://i.ytimg.com/vi/abcdefghijk"))
        self.assertIn("tiktokcdn", res[1]["thumb"])

    def test_video_thumbnail_not_site_logo(self):
        self.assertEqual(baking.video_thumb("https://youtu.be/abcdefghijk"), "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg")
        r = baking.save_recipe({"title": "Smoothie bowl", "source": "https://www.tiktok.com/@a/video/1", "image": "https://ads.example/logo.png",
                                "ingredients": ["1 banana"]}, "cooking")
        self.assertEqual(baking.list_recipes("cooking")[0]["image"], "")          # old wrong picture is hidden...
        with mock.patch.object(baking, "video_thumb", return_value="https://p16.tiktokcdn.com/food.jpg"):
            self.assertEqual(baking.find_image(r["id"], "cooking")["image"], "https://p16.tiktokcdn.com/food.jpg")   # ...and replaced

    def test_clumped_video_instructions_split_into_steps(self):
        clumped = (
            "1. Preheat oven to 375 degrees F. 2. In a medium bowl, whisk flour, baking soda, and salt. "
            "3. Beat the butter and sugars until fluffy. 4. Add the eggs and vanilla. "
            "5. Stir in chocolate chips and bake for 10-12 minutes."
        )
        steps = baking._flatten_steps(clumped)
        self.assertGreaterEqual(len(steps), 5)
        self.assertIn("Preheat oven to 375 degrees F.", steps[0])

    def test_sync_baking_and_cooking(self):
        recipe = {
            "title": "Universal Pancakes",
            "ingredients": ["1 cup flour", "1 cup milk", "1 egg"],
            "steps": ["Mix ingredients.", "Cook on griddle."],
        }
        saved = baking.save_recipe(recipe, kind="baking")
        rid = saved["id"]
        self.assertEqual(baking.get_recipe(rid, "baking")["title"], "Universal Pancakes")
        self.assertEqual(baking.get_recipe(rid, "cooking")["title"], "Universal Pancakes")
        baking.delete_recipe(rid, "baking")
        self.assertIsNone(baking.get_recipe(rid, "baking"))
        self.assertIsNone(baking.get_recipe(rid, "cooking"))
