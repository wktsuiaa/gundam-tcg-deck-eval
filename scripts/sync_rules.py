#!/usr/bin/env python3
"""
Scrape official Gundam Card Game Asia-English Play Rules & Card FAQs from:
- https://www.gundam-gcg.com/asia-en/rules/
- https://www.gundam-gcg.com/asia-en/rules/faqs/
- https://www.gundam-gcg.com/asia-en/rules/faqs/list.php?series=<CODE>

Produces data/rules.json and merges matched card FAQs into data/collections/*.json.
"""

import concurrent.futures
import html as html_lib
import json
import re
import time
import urllib.request
from pathlib import Path

RULES_URL = "https://www.gundam-gcg.com/asia-en/rules/"
FAQS_URL = "https://www.gundam-gcg.com/asia-en/rules/faqs/"
UA = "Mozilla/5.0 (compatible; GundamCardAtlas/1.0)"

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
COLLECTIONS_DIR = DATA_DIR / "collections"
RULES_FILE = DATA_DIR / "rules.json"


def fetch_text(url: str, timeout: int = 12) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def clean_html(raw: str) -> str:
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join([ln for ln in lines if ln]).strip()


def parse_rules_page(html_str: str) -> tuple[list[dict], list[dict]]:
    cleaned_html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html_str, flags=re.S | re.I)
    cleaned_html = re.sub(r"<style\b[^>]*>.*?</style>", " ", cleaned_html, flags=re.S | re.I)
    sections: list[dict] = []
    documents: list[dict] = []

    for href, label in re.findall(r'<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>(.*?)</a>', cleaned_html, re.S | re.I):
        clean_lbl = clean_html(label) or "Official Rule Document"
        abs_url = href
        if href.startswith("../../"):
            abs_url = "https://www.gundam-gcg.com/" + href.replace("../../", "")
        elif href.startswith("../"):
            abs_url = "https://www.gundam-gcg.com/asia-en/" + href.replace("../", "")
        elif href.startswith("/"):
            abs_url = "https://www.gundam-gcg.com" + href
        if not any(d["url"] == abs_url for d in documents):
            documents.append({"title": clean_lbl, "url": abs_url})

    for idx, m in enumerate(
        re.finditer(r"<h([23])[^>]*>(.*?)</h\1>(.*?)(?=<h[23][^>]*>|</main>|$)", cleaned_html, re.S | re.I),
        start=1,
    ):
        title = clean_html(m.group(2))
        body = clean_html(m.group(3))
        if not title or len(title) > 120:
            continue
        body_lines = [ln for ln in body.splitlines() if len(ln) > 3][:8]
        summary = " ".join(body_lines)[:600].strip()
        if not summary or title.upper() == "OFFICIAL RULES":
            continue
        sections.append({
            "id": f"rule-sec-{idx}",
            "title": title,
            "category": "Official Rules",
            "summary": summary,
            "sourceUrl": RULES_URL,
        })

    return sections, documents


def parse_faq_result_items(html_str: str) -> tuple[list[dict], dict[str, list[dict]]]:
    general_faqs: list[dict] = []
    card_faqs: dict[str, list[dict]] = {}

    for item in re.findall(r'<li[^>]*class="[^"]*faqResult_listItem[^"]*"[^>]*>(.*?)</li>', html_str, re.S):
        title_m = re.search(r'<h3[^>]*class="[^"]*faqResult_title[^"]*"[^>]*>(.*?)</h3>', item, re.S)
        q_block_m = re.search(r'<button[^>]*class="[^"]*faqResult_question[^"]*"[^>]*>(.*?)</button>', item, re.S)
        a_block_m = re.search(r'<div[^>]*class="[^"]*faqResult_answer[^"]*"[^>]*>(.*?)</div>', item, re.S)

        q_text_m = re.search(r'<p[^>]*class="[^"]*faqResult_text[^"]*"[^>]*>(.*?)</p>', q_block_m.group(1) if q_block_m else "", re.S)
        a_text_m = re.search(r'<p[^>]*class="[^"]*faqResult_text[^"]*"[^>]*>(.*?)</p>', a_block_m.group(1) if a_block_m else "", re.S)

        title = clean_html(title_m.group(1)) if title_m else ""
        q = clean_html(q_text_m.group(1)) if q_text_m else ""
        a = clean_html(a_text_m.group(1)) if a_text_m else ""
        if not q or not a:
            continue

        card_nos = sorted(set(re.findall(r"\b([A-Z]{1,4}\d*-\d{3})\b", title)))
        entry = {"q": q, "a": a}
        if card_nos:
            for cno in card_nos:
                arr = card_faqs.setdefault(cno, [])
                if not any(x["q"] == q for x in arr):
                    arr.append(entry)
        else:
            if not any(x["q"] == q for x in general_faqs):
                general_faqs.append(entry)

    return general_faqs, card_faqs


def scrape_all_faqs(faqs_index_html: str) -> tuple[list[dict], dict[str, list[dict]]]:
    rel_links = sorted(set(re.findall(r'href="(\./list\.php\?[^"]+)"', faqs_index_html)))
    urls = [f"{FAQS_URL}{lnk[2:]}" for lnk in rel_links]
    if not urls:
        return [], {}

    all_general: list[dict] = []
    all_card_faqs: dict[str, list[dict]] = {}

    def fetch_and_parse(u: str):
        try:
            return parse_faq_result_items(fetch_text(u))
        except Exception:
            return [], {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for gen, cf in ex.map(fetch_and_parse, urls):
            for entry in gen:
                if not any(x["q"] == entry["q"] for x in all_general):
                    all_general.append(entry)
            for cno, entries in cf.items():
                arr = all_card_faqs.setdefault(cno, [])
                for entry in entries:
                    if not any(x["q"] == entry["q"] for x in arr):
                        arr.append(entry)

    return all_general, all_card_faqs


def default_deck_construction_rules() -> dict:
    return {
        "mainDeckSize": 50,
        "resourceDeckSize": 10,
        "maxColors": 2,
        "maxCopiesPerCardNo": 4,
        "allowedMainTypes": ["UNIT", "PILOT", "COMMAND", "BASE"],
        "allowedResourceTypes": ["RESOURCE"],
        "startingHandSize": 5,
        "startingShieldCount": 6,
        "turnPhases": [
            {"phase": "Start Phase", "summary": "Set all rested cards active, then draw 1 card."},
            {"phase": "Resource Phase", "summary": "Place 1 Resource from Resource Deck into Resource Area (up to 10; Going 2nd starts with 1 EX Resource)."},
            {"phase": "Main Phase", "summary": "Deploy Units/Bases, pair Pilots onto Units (triggering Link if matched), play Main Commands, and declare Attacks."},
            {"phase": "Action Step", "summary": "Defending player may activate <Blocker> or Action Commands during combat windows."},
            {"phase": "End Phase", "summary": "Resolve end-of-turn triggers such as <Repair X> and discard down to hand limit if applicable."},
        ],
    }


def merge_faqs_into_collections(card_faqs: dict[str, list[dict]]) -> int:
    if not COLLECTIONS_DIR.exists() or not card_faqs:
        return 0
    updated_files = 0
    for path in sorted(COLLECTIONS_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        changed = False
        for card in payload.get("cards", []):
            cno = card.get("cardNo", "")
            matched = card_faqs.get(cno)
            if matched and card.get("faqs") != matched:
                card["faqs"] = matched
                changed = True
        if changed:
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            updated_files += 1
    return updated_files


def main():
    existing = {}
    if RULES_FILE.exists():
        try:
            existing = json.loads(RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    sections: list[dict] = existing.get("sections", [])
    documents: list[dict] = existing.get("documents", [])
    general_faqs: list[dict] = existing.get("generalFaqs", [])
    card_faqs: dict[str, list[dict]] = existing.get("cardFaqs", {})

    try:
        rules_html = fetch_text(RULES_URL)
        parsed_sections, parsed_docs = parse_rules_page(rules_html)
        if parsed_sections:
            sections = parsed_sections
        if parsed_docs:
            documents = parsed_docs
        print(f"Fetched rules page: {len(sections)} sections, {len(documents)} documents.", flush=True)
    except Exception as exc:
        print(f"Warning: could not fetch rules page ({exc}); keeping cached/default rules.", flush=True)

    try:
        faqs_html = fetch_text(FAQS_URL)
        parsed_gen, parsed_card_faqs = scrape_all_faqs(faqs_html)
        if parsed_gen:
            general_faqs = parsed_gen
        if parsed_card_faqs:
            card_faqs = parsed_card_faqs
        print(
            f"Fetched FAQs: {len(general_faqs)} general FAQs, {len(card_faqs)} cards with official rulings.",
            flush=True,
        )
    except Exception as exc:
        print(f"Warning: could not fetch FAQs ({exc}); keeping cached FAQs.", flush=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rules_payload = {
        "syncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": RULES_URL,
        "faqSource": FAQS_URL,
        "deckConstruction": default_deck_construction_rules(),
        "documents": documents,
        "sections": sections,
        "generalFaqs": general_faqs,
        "cardFaqs": card_faqs,
    }
    RULES_FILE.write_text(json.dumps(rules_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    merged = merge_faqs_into_collections(card_faqs)
    print(f"Wrote {RULES_FILE} and updated FAQs in {merged} collection shard(s).", flush=True)


if __name__ == "__main__":
    main()
