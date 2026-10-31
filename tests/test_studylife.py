"""Study round (skills/studylife.py): today's list, exam report, mistake notebook, grades, citations, essay coach,
handwritten notes with duplicates merged, video chapters, formula sheets by subject, USB subject sorting, exam week,
curiosity fact and pronunciation tips (the AI is faked)."""
import os, sys, tempfile, unittest
from datetime import date
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import studylife  # noqa: E402

TODAY = date(2026, 10, 31)
MCQ = {"question": "What is C in Q = CiA?", "choices": ["Area", "Runoff coefficient"], "answer_index": 1,
       "explanation": "Fraction that runs off.", "source": "Hydro.pdf, p. 4"}
TF = {"statement": "Steel is brittle.", "answer": False, "explanation": "It's ductile.", "source": "Steel.pdf, p. 2"}
BLANK = {"sentence": "Cover for beams is ___ mm.", "answer": "40", "source": "RCD.pptx, slide 3"}


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-studylife-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        p = mock.patch.object(studylife, "STATE_FILE", os.path.join(self.tmp, "studylife.json"))
        p.start()
        self.addCleanup(p.stop)


class TodayAndExamTests(unittest.TestCase):
    def test_today_list_orders_and_counts_minutes(self):
        r = studylife.today_list([{"id": "r1", "title": "Beams", "due": "2000-01-01"}], 20, 3,
                                 [{"topic": "Hardy Cross", "pct": 40}])
        self.assertEqual([i["action"] for i in r["items"]], ["review", "cards", "mistakes", "weak"])
        self.assertIn("days late", r["items"][0]["text"])
        self.assertEqual(r["minutes"], sum(i["minutes"] for i in r["items"]))
        self.assertEqual(studylife.today_list([], 0, 0, [])["items"], [])

    def test_exam_report_by_part(self):
        rep = studylife.exam_report({"items": [MCQ, TF, BLANK, MCQ]}, [True, False, False, True])
        self.assertEqual((rep["right"], rep["total"], rep["pct"], rep["grade"]), (2, 4, 50, "F"))
        self.assertEqual(rep["parts"][0]["pct"], 0)                      # worst part first
        self.assertEqual(set(rep["redo"]), {"Steel.pdf", "RCD.pptx"})


class MistakeTests(_Tmp):
    def test_wrong_answers_saved_once_with_the_right_answer(self):
        review = {"title": "Quiz", "items": [MCQ, TF, BLANK]}
        self.assertEqual(studylife.add_mistakes(review, [False, False, True], "Hydrology"), 2)
        self.assertEqual(studylife.add_mistakes(review, [False, False, True], "Hydrology"), 0)   # no duplicates
        book = studylife.mistakes()
        self.assertEqual({m["right"] for m in book}, {"Runoff coefficient", "False"})
        self.assertEqual(len(studylife.mistakes("hydrology")), 2)
        self.assertEqual(len(studylife.mistake_done(book[0]["id"])), 1)


class GradeTests(_Tmp):
    def test_what_you_need_on_the_final(self):
        c = {"parts": [{"name": "Quizzes", "weight": 20, "score": 80}, {"name": "Midterm", "weight": 30, "score": 70},
                       {"name": "Final", "weight": 50, "score": None}]}
        r = studylife.grade_calc(c, 75)
        self.assertEqual(r["current"], 74.0)
        self.assertEqual(r["needed"], 76.0)                    # 37 earned, need 38 more out of 50
        self.assertIn("76% on Final", r["message"])
        self.assertIn("isn't reachable", studylife.grade_calc(c, 99)["message"])
        done = {"parts": [{"name": "All", "weight": 100, "score": 88}]}
        self.assertEqual(studylife.grade_calc(done)["final"], 88.0)

    def test_save_checks_weights(self):
        self.assertIn("100%", studylife.grade_save({"name": "RCD", "parts": [{"name": "x", "weight": 50}]})["error"])
        r = studylife.grade_save({"name": "RCD", "target": 80, "parts": [{"name": "Mid", "weight": "40", "score": "90"},
                                                                         {"name": "Final", "weight": "60", "score": ""}]})
        self.assertEqual(r["grades"][0]["needed"], 73.3)
        self.assertEqual(studylife.grade_remove(r["grades"][0]["id"])["grades"], [])


class CitationTests(unittest.TestCase):
    BOOK = {"kind": "book", "authors": ["Ven Te Chow", "David R. Maidment", "Larry W. Mays"], "year": "1988",
            "title": "Applied Hydrology", "publisher": "McGraw-Hill"}

    def test_book_apa_and_mla(self):
        self.assertEqual(studylife.cite(self.BOOK, "apa"),
                         "Chow, V. T., Maidment, D. R., & Mays, L. W. (1988). *Applied Hydrology*. McGraw-Hill.")
        self.assertEqual(studylife.cite(self.BOOK, "mla"), "Chow, Ven Te, et al. *Applied Hydrology*. McGraw-Hill, 1988.")

    def test_link_reads_page_meta(self):
        html = ('<html><head><title>x</title><meta property="og:title" content="Unit Hydrographs">'
                '<meta name="author" content="Ana Cruz"><meta property="og:site_name" content="Water Blog">'
                '<meta property="article:published_time" content="2024-05-03T10:00"></head></html>')
        r = studylife.cite_lookup("https://www.water.example/uh", fetch=lambda u: html, today=TODAY)
        self.assertEqual(r["apa"], "Cruz, A. (2024-05-03). *Unit Hydrographs*. Water Blog. https://www.water.example/uh")
        self.assertIn("Accessed 31 Oct. 2026.", r["mla"])

    def test_book_title_uses_ai_and_refuses_unknown(self):
        r = studylife.cite_lookup("applied hydrology", ask=lambda p: {**self.BOOK, "kind": None})
        self.assertTrue(r["apa"].startswith("Chow, V. T."))
        self.assertIn("error", studylife.cite_lookup("zzz", ask=lambda p: {"title": ""}))


class EssayTests(unittest.TestCase):
    def test_outline_and_feedback(self):
        o = studylife.essay_outline("Flood control", ask=lambda p: {"thesis": "T", "points": []})
        self.assertEqual(o["thesis"], "T")
        self.assertIn("error", studylife.essay_outline(" "))
        self.assertIn("40+", studylife.essay_feedback(o, "too short")["error"])
        fb = studylife.essay_feedback(o, "word " * 50, ask=lambda p: {"score": 7, "fixes": []})
        self.assertEqual(fb["score"], 7)


class NotebookTests(_Tmp):
    def test_photo_notes_merge_same_topic(self):
        ask = lambda p: {"topic": "Hardy Cross method", "subject": "Hydrology", "notes": "- loops\n- dQ correction",
                         "formulas": ["h = kQ^n"]}
        a = studylife.photo_notes("a.jpg", ocr=lambda p: "scribbles", ask=ask)
        self.assertFalse(a["merged"])
        ask2 = lambda p: {"topic": "Hardy Cross", "notes": "- dQ correction\n- converge when dQ small", "formulas": ["h = kQ^n"]}
        b = studylife.photo_notes("b.jpg", "Hydrology", ocr=lambda p: "more", ask=ask2)
        self.assertTrue(b["merged"])
        n = studylife.notebook()
        self.assertEqual(len(n), 1)
        self.assertEqual(n[0]["text"].count("dQ correction"), 1)
        self.assertEqual(n[0]["sources"], ["a.jpg", "b.jpg"])
        self.assertIn("error", studylife.photo_notes("c.jpg", ocr=lambda p: " "))

    def test_merge_duplicates(self):
        studylife._write({"notebook": [
            {"id": "1", "topic": "Unit hydrograph", "subject": "Hydrology", "text": "- a", "formulas": [], "sources": ["x"], "updated": "2026-10-01"},
            {"id": "2", "topic": "Unit hydrographs lecture", "subject": "Hydrology", "text": "- a\n- b", "formulas": [], "sources": ["y"], "updated": "2026-10-02"},
            {"id": "3", "topic": "Unit hydrograph", "subject": "RCD", "text": "- c", "formulas": [], "sources": [], "updated": "2026-10-03"}]})
        r = studylife.merge_duplicates()
        self.assertEqual(r["merged"], 0)               # "hydrograph" vs "hydrographs" are different words
        studylife._write({"notebook": [
            {"id": "1", "topic": "Unit hydrograph", "subject": "Hydrology", "text": "- a", "formulas": [], "sources": ["x"], "updated": "2026-10-01"},
            {"id": "2", "topic": "Unit hydrograph notes", "subject": "Hydrology", "text": "- a\n- b", "formulas": [], "sources": ["y"], "updated": "2026-10-02"},
            {"id": "3", "topic": "Unit hydrograph", "subject": "RCD", "text": "- c", "formulas": [], "sources": [], "updated": "2026-10-03"}]})
        r = studylife.merge_duplicates()
        self.assertEqual(r["merged"], 1)               # different subject stays apart
        h = [n for n in r["notes"] if n["subject"] == "Hydrology"][0]
        self.assertEqual(h["text"], "- a\n- b")


class ChapterAndFormulaTests(_Tmp):
    def test_chapters_from_timed_transcript(self):
        pages = ["[0:05] welcome\n[4:10] bending moment", "[12:34] deflection now"]
        r = studylife.chapters("f1", pages, ask=lambda p: {"chapters": [{"time": "4:10", "title": "Moments"},
                                                                         {"time": "0:00", "title": "Intro"},
                                                                         {"time": "bad", "title": "x"}]})
        self.assertEqual([(c["time"], c["seconds"]) for c in r["chapters"]], [("0:00", 0), ("4:10", 250)])
        self.assertEqual(studylife.chapters("f1", [], ask=None)["chapters"][1]["title"], "Moments")     # cached
        self.assertIn("error", studylife.chapters("f2", ["no times here"]))

    def test_formula_sheet_per_subject(self):
        files = [{"id": "a", "subject": "Hydrology"}, {"id": "b", "subject": "Steel"}]
        got = {}
        make = lambda ids: got.setdefault("ids", ids) and {"topics": [{"topic": "Runoff", "formulas": []}], "count": 1}
        s = studylife.formula_for_subject("hydrology", files, make=make)
        self.assertEqual(got["ids"], ["a"])
        self.assertEqual(s["title"], "hydrology formula sheet")
        self.assertIn("hydrology", studylife.formula_saved())
        self.assertIn("No RCD files", studylife.formula_for_subject("RCD", files, make=make)["error"])
        self.assertEqual(studylife.subjects(files)[:3], ["Hydrology", "Steel", "RCD"])


class UsbAndExamWeekTests(_Tmp):
    def test_guess_subject(self):
        self.assertEqual(studylife.guess_subject(r"E:\Sem 2\Hydrology\week9.pdf"), "Hydrology")
        self.assertEqual(studylife.guess_subject("RCD_Lecture4_Flexure.pptx"), "RCD")
        self.assertEqual(studylife.guess_subject("AISC bolted connections.pdf", ["Steel Design"]), "Steel")
        self.assertEqual(studylife.guess_subject("Structural Theory 2 notes.pdf", ["Structural Theory 2"]), "Structural Theory 2")
        self.assertEqual(studylife.guess_subject("IMG_0001.jpg"), "")

    def test_usb_new_files_once(self):
        files = [{"name": "a.pdf", "size": 10}, {"name": "b.pdf", "size": 20}]
        self.assertEqual(len(studylife.usb_new(files, ["B.pdf"])), 1)          # already in the library
        studylife.usb_mark(files[:1])
        self.assertEqual(studylife.usb_new(files), files[1:])

    def test_exam_plan_and_active(self):
        exams = [{"subject": "RCD", "date": "2026-11-03"}, {"subject": "Hydrology", "date": "2026-11-01"}]
        plan = studylife.exam_plan(exams, TODAY, "22:00")
        self.assertEqual([d["date"] for d in plan], ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"])
        self.assertIn("Hydrology tomorrow", plan[0]["focus"])
        self.assertIn("exam today", plan[1]["focus"])
        self.assertIn("Bed by 22:00", " ".join(plan[2]["blocks"]))
        st = studylife.exam_save({"on": True, "exams": exams + [{"subject": "x", "date": "soon"}], "sleep": "22:00"})
        self.assertEqual(len(st["exams"]), 2)
        self.assertTrue(studylife.exam_active(studylife.exam_state(), TODAY))
        self.assertFalse(studylife.exam_active(studylife.exam_state(), date(2026, 11, 4)))
        self.assertFalse(studylife.exam_active({"on": False, "exams": exams}, TODAY))


class FactAndCoachTests(_Tmp):
    def test_fact_once_a_day(self):
        calls = []
        ask = lambda p: calls.append(p) or {"fact": "Q = CiA dates to 1851.", "subject": "Hydrology"}
        f = studylife.fact_of_day(["Hydrology"], TODAY, ask)
        self.assertEqual(f["fact"], "Q = CiA dates to 1851.")
        studylife.fact_of_day(["Hydrology"], TODAY, ask)
        self.assertEqual(len(calls), 1)

    def test_pron_coach(self):
        self.assertIsNone(studylife.pron_coach("x", "x", []))
        r = studylife.pron_coach("はじめまして", "はしめまして", ["じ"], "ja",
                                 ask=lambda p: {"tips": [{"word": "じ", "syllables": "ji", "how": "voiced"}], "encourage": "Close!"})
        self.assertEqual(r["tips"][0]["word"], "じ")
        self.assertEqual(r["encourage"], "Close!")


if __name__ == "__main__":
    unittest.main()
