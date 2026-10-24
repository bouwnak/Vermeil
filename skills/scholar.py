"""
scholar.py - finds REAL academic papers and formats them in APA 7th edition.

Where it searches (free, no API key, needs internet only for the search itself):
  - OpenAlex  (openalex.org)  - 250M+ scholarly works: journals (ScienceDirect/Elsevier, Springer, Wiley, IEEE,
                                Taylor & Francis, SAGE, MDPI...), books, conference papers, theses
  - Crossref  (crossref.org)  - the DOI registry, used as a backup
The references are built from each paper's real data (authors, year, journal, volume, pages, DOI),
so they can't be invented by the AI. The local AI only writes the answer from these papers' abstracts.
"""
import re
import html

import requests

OPENALEX = "https://api.openalex.org/works"
CROSSREF = "https://api.crossref.org/works"
HEADERS = {"User-Agent": "Vermeil-study-assistant/1.0 (personal use)"}
GOOD_TYPES = {"article", "review", "book", "book-chapter", "proceedings-article", "dissertation", "report",
              "journal-article", "monograph", "edited-book", "reference-entry", "posted-content", "preprint"}
_SMALL = {"a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "of", "in", "with", "as", "vs"}


# ------------------------------------------------------------------ names & APA pieces
def _initials(given):
    parts = []
    for word in given.replace(".", " ").split():
        sub = [p for p in word.split("-") if p]
        parts.append("-".join(f"{p[0].upper()}." for p in sub))
    return " ".join(parts)


def split_name(full):
    """'Jin-Keun Kim' -> ('Kim', 'J.-K.'); 'Kim, Jin Keun' -> ('Kim', 'J. K.')"""
    full = re.sub(r"\s+", " ", (full or "").strip())
    if not full:
        return "", ""
    if "," in full:
        family, given = [x.strip() for x in full.split(",", 1)]
    else:
        words = full.split(" ")
        particles = {"de", "da", "del", "dela", "van", "von", "der", "di", "la", "le", "dos", "das"}
        i = len(words) - 1
        while i > 1 and words[i - 1].lower() in particles:
            i -= 1
        family, given = " ".join(words[i:]), " ".join(words[:i])
    return family, _initials(given)


def apa_authors(people):
    """[(family, initials)] -> APA author list (up to 20, then … last)."""
    names = [f"{f}, {i}".strip(", ") if i else f for f, i in people if f]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) <= 20:
        return ", ".join(names[:-1]) + ", & " + names[-1]
    return ", ".join(names[:19]) + ", . . . " + names[-1]


def in_text(people, year):
    fam = [f for f, _ in people if f]
    y = year or "n.d."
    if not fam:
        return f"(Anonymous, {y})"
    if len(fam) == 1:
        return f"({fam[0]}, {y})"
    if len(fam) == 2:
        return f"({fam[0]} & {fam[1]}, {y})"
    return f"({fam[0]} et al., {y})"


def sentence_case(title):
    """APA article titles: only the first word, the first word after a colon, and proper nouns/acronyms capitalised."""
    title = html.unescape(re.sub(r"<[^>]+>", "", title or "")).strip().rstrip(".")
    words, out, cap_next = title.split(" "), [], True
    letters = [w for w in words[1:] if w[:1].isalpha() and w.lower() not in _SMALL]
    if letters and sum(w[:1].isupper() for w in letters) / len(letters) < 0.6:
        return title[:1].upper() + title[1:]          # already sentence case - keep names like Manila as they are
    for w in words:
        keep = (sum(c.isupper() for c in w) > 1) or any(c.isdigit() for c in w) \
            or bool(re.fullmatch(r"[IVX]+[:,.]?", w))                               # NASA, COVID-19, Part II
        if cap_next:
            out.append(w[:1].upper() + w[1:])
        elif keep:
            out.append(w)
        else:
            out.append(w.lower())
        cap_next = w.endswith((":", "?", "!", "—"))
    return " ".join(out)


def title_case(name):
    words = (name or "").split(" ")
    return " ".join(w if (i and w.lower() in _SMALL) or sum(c.isupper() for c in w) > 1 else w[:1].upper() + w[1:]
                    for i, w in enumerate(words))


def apa_reference(work):
    """work dict -> (plain text, markdown with *italics*)."""
    people, year = work["authors"], work.get("year") or "n.d."
    authors = apa_authors(people) or sentence_case(work["title"])
    title = sentence_case(work["title"])
    doi = f"https://doi.org/{work['doi']}" if work.get("doi") else (work.get("url") or "")
    kind = work.get("type", "article")
    if kind in ("book", "monograph", "edited-book"):
        pub = f" {work['publisher']}." if work.get("publisher") else ""
        plain = f"{authors} ({year}). {title}.{pub} {doi}".strip()
        md = f"{authors} ({year}). *{title}*.{pub} {doi}".strip()
        return plain, md
    venue = title_case(work.get("venue") or "")
    vol, issue, pages = work.get("volume"), work.get("issue"), work.get("pages")
    tail_plain, tail_md = venue, f"*{venue}*" if venue else ""
    if vol:
        tail_plain += f", {vol}"
        tail_md = f"*{venue}, {vol}*" if venue else f"*{vol}*"
    if issue:
        tail_plain += f"({issue})"
        tail_md += f"({issue})"
    if pages:
        tail_plain += f", {pages}"
        tail_md += f", {pages}"
    plain = f"{authors} ({year}). {title}. {tail_plain + '. ' if tail_plain else ''}{doi}".strip()
    md = f"{authors} ({year}). {title}. {tail_md + '. ' if tail_md else ''}{doi}".strip()
    return plain, md


# ------------------------------------------------------------------ searching
def _abstract(inverted):
    if not inverted:
        return ""
    pos = sorted((p, w) for w, ps in inverted.items() for p in ps)
    return " ".join(w for _, w in pos)


def _from_openalex(r):
    loc = r.get("primary_location") or {}
    src = loc.get("source") or {}
    b = r.get("biblio") or {}
    pages = "-".join(x for x in (b.get("first_page"), b.get("last_page")) if x) if b.get("first_page") else ""
    if pages and b.get("first_page") == b.get("last_page"):
        pages = b["first_page"]
    doi = (r.get("doi") or "").replace("https://doi.org/", "")
    return {"title": r.get("display_name") or r.get("title") or "", "year": r.get("publication_year"),
            "authors": [split_name(a.get("author", {}).get("display_name", "")) for a in r.get("authorships", [])],
            "venue": src.get("display_name", ""), "publisher": src.get("host_organization_name", ""),
            "volume": b.get("volume"), "issue": b.get("issue"), "pages": pages, "doi": doi,
            "url": (r.get("open_access") or {}).get("oa_url") or loc.get("landing_page_url") or "",
            "type": r.get("type", "article"), "abstract": _abstract(r.get("abstract_inverted_index")),
            "cited_by": r.get("cited_by_count", 0), "source": "OpenAlex"}


def search_openalex(query, n=8, from_year=None):
    params = {"search": query, "per_page": n * 2,
              "select": "id,doi,display_name,publication_year,authorships,primary_location,biblio,"
                        "abstract_inverted_index,cited_by_count,type,open_access",
              "filter": "has_abstract:true" + (f",from_publication_date:{from_year}-01-01" if from_year else "")}
    r = requests.get(OPENALEX, params=params, headers=HEADERS, timeout=20)
    r.raise_for_status()
    works = [_from_openalex(x) for x in r.json().get("results", [])]
    return [w for w in works if w["title"] and w["type"] in GOOD_TYPES][:n]


def _from_crossref(it):
    date = (it.get("issued") or {}).get("date-parts") or [[None]]
    return {"title": (it.get("title") or [""])[0], "year": date[0][0],
            "authors": [(a.get("family", ""), _initials(a.get("given", ""))) if a.get("family")
                        else split_name(a.get("name", "")) for a in it.get("author", [])],
            "venue": (it.get("container-title") or [""])[0], "publisher": it.get("publisher", ""),
            "volume": it.get("volume"), "issue": it.get("issue"), "pages": (it.get("page") or "").replace("–", "-"),
            "doi": it.get("DOI", ""), "url": it.get("URL", ""),
            "type": {"journal-article": "article", "book-chapter": "book-chapter"}.get(it.get("type"), it.get("type", "article")),
            "abstract": re.sub(r"<[^>]+>", "", it.get("abstract", "")), "cited_by": it.get("is-referenced-by-count", 0),
            "source": "Crossref"}


def search_crossref(query, n=8):
    r = requests.get(CROSSREF, params={"query": query, "rows": n * 2, "filter": "has-abstract:true"},
                     headers=HEADERS, timeout=20)
    r.raise_for_status()
    works = [_from_crossref(x) for x in r.json().get("message", {}).get("items", [])]
    return [w for w in works if w["title"] and w["type"] in GOOD_TYPES][:n]


def find_papers(queries, n=8):
    """Search each query; merge, remove duplicates, keep the most relevant/cited."""
    seen, works, errors = set(), [], []
    for q in queries:
        for fn in (search_openalex, search_crossref):
            try:
                found = fn(q, n)
            except Exception as e:
                errors.append(f"{getattr(fn, '__name__', 'search')}: {e}")
                continue
            for w in found:
                key = (w["doi"] or w["title"]).lower()
                if key not in seen:
                    seen.add(key)
                    works.append(w)
            if found:
                break                                   # OpenAlex worked; Crossref only as backup
    if not works and errors:
        raise ConnectionError("Couldn't reach the paper databases (are you online?). " + "; ".join(errors[:2]))
    return works[:n]


def with_citations(works):
    """Adds 'cite' (in-text), 'apa' (plain) and 'apa_md' (italics) to each work; makes in-text cites unique."""
    counts = {}
    for w in works:
        w["cite"] = in_text(w["authors"], w.get("year"))
        counts[w["cite"]] = counts.get(w["cite"], 0) + 1
    letters = {}
    for w in sorted(works, key=lambda x: sentence_case(x["title"])):      # Kim, 2020a / 2020b
        if counts[w["cite"]] > 1:
            i = letters.get(w["cite"], 0)
            letters[w["cite"]] = i + 1
            w["year"] = f"{w.get('year') or 'n.d.'}{'abcdefghij'[i]}"
            w["cite"] = in_text(w["authors"], w["year"])
    for w in works:
        w["apa"], w["apa_md"] = apa_reference(w)
    return sorted(works, key=lambda w: w["apa"].lower())
