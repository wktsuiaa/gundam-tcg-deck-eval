#!/usr/bin/env python3
"""
Scrape the official Gundam Card Game Asia-English catalog from:
https://www.gundam-gcg.com/asia-en/cards/
Uses curl HTTP/2 keepalive batching for fast, reliable fetching.
Produces data/packages.json and per-collection shards in data/collections/<code>.json.
"""

import html as html_lib
import json
import re
import subprocess
import time
from pathlib import Path

BASE_URL = "https://www.gundam-gcg.com/asia-en/cards/"
UA = "Mozilla/5.0 (compatible; GundamCardAtlas/1.0)"
DELIM = "__GCA_CARD_DELIM__"

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
COLLECTIONS_DIR = DATA_DIR / "collections"
RULES_FILE = DATA_DIR / "rules.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)
COLLECTIONS_DIR.mkdir(parents=True, exist_ok=True)


def curl_batch(urls: list[str]) -> dict[str, str]:
    """Fetch multiple URLs via curl reusing HTTP/2 keepalive."""
    cmd = ["curl", "-4", "-sL", "--connect-timeout", "5", "--max-time", "25", "-A", UA, "-w", f"\n{DELIM}%{{url}}\n"]
    cmd.extend(urls)
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        return {}
    text = proc.stdout.decode("utf-8", "ignore")
    out: dict[str, str] = {}
    pos = 0
    marker = f"\n{DELIM}"
    while True:
        idx = text.find(marker, pos)
        if idx == -1:
            break
        body = text[pos:idx]
        url_start = idx + len(marker)
        nl = text.find("\n", url_start)
        if nl == -1:
            url = text[url_start:].strip()
            pos = len(text)
        else:
            url = text[url_start:nl].strip()
            pos = nl + 1
        if url:
            out[url] = body
    return out


def clean_html_text(raw: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join([l for l in lines if l]).strip()


def classify_package(name: str) -> str:
    if "[GD" in name:
        return "Booster Pack"
    if "[ST" in name:
        return "Starter Deck"
    if "[EB" in name or "[SC" in name or "LIMITED" in name.upper():
        return "Special / Extra Set"
    if "Promotion" in name:
        return "Promotion"
    if "Basic" in name:
        return "Basic Cards"
    return "Other Product"


def parse_num(val: str) -> int | None:
    if not val or val == "-":
        return None
    m = re.search(r"-?\d+", val)
    return int(m.group(0)) if m else None


def parse_traits(raw: str) -> list[str]:
    if not raw or raw == "-":
        return []
    found = re.findall(r"\(([^)]+)\)", raw)
    if found:
        return [t.strip() for t in found if t.strip()]
    return [t.strip() for t in re.split(r"[/,]", raw) if t.strip() and t.strip() != "-"]


def parse_detail_html(print_id: str, dhtml: str) -> dict | None:
    if "cardDetailPageCol" not in dhtml:
        return None

    def extract_one(pattern: str) -> str:
        m = re.search(pattern, dhtml, re.S)
        return clean_html_text(m.group(1)) if m else ""

    card_no = extract_one(r'<div class="cardNo">\s*(.*?)\s*</div>') or print_id.split("_")[0]
    rarity = re.sub(r"\s+", "", extract_one(r'<div class="rarity">\s*(.*?)\s*</div>'))
    block_icon = extract_one(r'<div class="blockIcon">\s*(.*?)\s*</div>')
    name = extract_one(r'<h1 class="cardName">\s*(.*?)\s*</h1>')

    img_m = re.search(r'<div class="cardImage">\s*<img[^>]*src\s*=\s*"([^"]+)"', dhtml, re.S)
    image_path = ""
    if img_m:
        raw_src = img_m.group(1).split("?")[0].trim() if hasattr(str, "trim") else img_m.group(1).split("?")[0].strip()
        image_path = re.sub(r"^(\.\.\/)+", "", raw_src).lstrip("/")
    if not image_path:
        image_path = f"jp/images/cards/card/{print_id}.webp"

    fields: dict[str, str] = {}
    for dt_raw, dd_raw in re.findall(
        r'<dt class="dataTit">\s*(.*?)\s*</dt>\s*<dd[^>]*class="dataTxt[^"]*"[^>]*>\s*(.*?)\s*</dd>',
        dhtml,
        re.S,
    ):
        fields[clean_html_text(dt_raw)] = clean_html_text(dd_raw)

    effect = extract_one(
        r'<div class="cardDataRow overview">\s*<div[^>]*class="dataTxt[^"]*"[^>]*>\s*(.*?)\s*</div>\s*</div>'
    )

    faqs = []
    qa_idx = dhtml.find('class="cardQaCol"')
    if qa_idx != -1:
        qa_html = dhtml[qa_idx:]
        for q_raw, a_raw in re.findall(
            r'class="qaTit"[^>]*>(.*?)</div>.*?class="qaTxt"[^>]*>(.*?)</div>',
            qa_html,
            re.S,
        ):
            q_txt = clean_html_text(q_raw)
            a_txt = clean_html_text(a_raw)
            if q_txt and a_txt:
                faqs.append({"q": q_txt, "a": a_txt})

    lv = parse_num(fields.get("Lv.", ""))
    cost = parse_num(fields.get("COST", ""))
    ap_raw = fields.get("AP", "-")
    hp_raw = fields.get("HP", "-")
    ap = parse_num(ap_raw)
    hp = parse_num(hp_raw)
    color = fields.get("COLOR", "-")
    if color == "-" or not color:
        color = "Colorless"
    card_type = fields.get("TYPE", "UNIT")
    zone_raw = fields.get("Zone", "-")
    zones = [] if zone_raw == "-" or not zone_raw else [z.strip() for z in zone_raw.split() if z.strip()]
    traits = parse_traits(fields.get("Trait", "-"))
    link_raw = fields.get("Link", "-")
    link = "" if link_raw == "-" else link_raw
    source_title = fields.get("Source Title", "-")
    if source_title == "-":
        source_title = ""
    where_to_get = fields.get("Where to get it", "")

    return {
        "printId": print_id,
        "cardNo": card_no,
        "name": name or card_no,
        "rarity": rarity or "C",
        "blockIcon": block_icon or "1",
        "lv": lv,
        "cost": cost,
        "color": color,
        "type": card_type,
        "effect": effect,
        "zones": zones,
        "traits": traits,
        "link": link,
        "apRaw": ap_raw,
        "hpRaw": hp_raw,
        "ap": ap,
        "hp": hp,
        "sourceTitle": source_title,
        "whereToGet": where_to_get,
        "imagePath": image_path,
        "isParallel": ("_" in print_id) or ("+" in rarity),
        "faqs": faqs,
    }


def sort_key(c: dict):
    pid = c["printId"]
    base, _, suffix = pid.partition("_")
    m = re.match(r"^([A-Z]+)(\d*)-(\d+)$", base)
    if m:
        prefix, setnum, num = m.groups()
        return (prefix, int(setnum) if setnum else 0, int(num), 0 if not suffix else 1, suffix)
    return (base, 0, 0, 0 if not suffix else 1, suffix)


def sanitize_code(code: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", code)


def load_cached_card_faqs() -> dict[str, list[dict]]:
    if not RULES_FILE.exists():
        return {}
    try:
        rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
        return rules.get("cardFaqs", {})
    except Exception:
        return {}


def main():
    t0 = time.time()
    print("Fetching package index...", flush=True)
    main_html = curl_batch([BASE_URL]).get(BASE_URL, "")
    packages = []
    seen = set()
    for pkg_id, pkg_name in re.findall(r'data-val="([0-9]+)"[^>]*>\s*([^<]+?)\s*<', main_html):
        if pkg_id not in seen:
            seen.add(pkg_id)
            clean_name = html_lib.unescape(pkg_name).strip()
            code_match = re.search(r"\[([A-Z0-9-]+)\]", clean_name)
            packages.append({
                "id": pkg_id,
                "name": clean_name,
                "code": code_match.group(1) if code_match else pkg_id,
                "category": classify_package(clean_name),
            })

    print(f"Found {len(packages)} packages.", flush=True)

    pkg_urls = [f"{BASE_URL}index.php?package={p['id']}" for p in packages]
    pkg_htmls = {}
    for i in range(0, len(pkg_urls), 10):
        pkg_htmls.update(curl_batch(pkg_urls[i:i + 10]))

    print_to_pkgs: dict[str, list[dict]] = {}
    pkg_to_pids: dict[str, list[str]] = {}
    packages_out = []
    for pkg in packages:
        url = f"{BASE_URL}index.php?package={pkg['id']}"
        phtml = pkg_htmls.get(url, "")
        seen_pid = set()
        ordered_pids = []
        for pid in re.findall(r'detail\.php\?detailSearch=([A-Za-z0-9_-]+)', phtml):
            if pid not in seen_pid:
                seen_pid.add(pid)
                ordered_pids.append(pid)
                print_to_pkgs.setdefault(pid, []).append({
                    "id": pkg["id"],
                    "name": pkg["name"],
                    "code": pkg["code"],
                })
        pkg_to_pids[pkg["code"]] = ordered_pids
        pkg_out = dict(pkg)
        pkg_out["cardCount"] = len(seen_pid)
        packages_out.append(pkg_out)

    all_print_ids = sorted(print_to_pkgs.keys())
    print(f"Fetching details for {len(all_print_ids)} unique prints via 6x curl HTTP/2 workers...", flush=True)

    import concurrent.futures

    cached_faqs = load_cached_card_faqs()
    cards_map: dict[str, dict] = {}
    batches = [all_print_ids[i:i + 15] for i in range(0, len(all_print_ids), 15)]

    def run_detail_batch(batch_pids: list[str]) -> list[dict]:
        urls = [f"{BASE_URL}detail.php?detailSearch={pid}" for pid in batch_pids]
        html_map = curl_batch(urls)
        res = []
        for pid in batch_pids:
            dhtml = html_map.get(f"{BASE_URL}detail.php?detailSearch={pid}", "")
            card = parse_detail_html(pid, dhtml)
            if card:
                pkgs_for_card = print_to_pkgs[pid]
                card["packageIds"] = [p["id"] for p in pkgs_for_card]
                card["packageNames"] = [p["name"] for p in pkgs_for_card]
                card["packageCodes"] = [p["code"] for p in pkgs_for_card]
                if not card["faqs"] and card["cardNo"] in cached_faqs:
                    card["faqs"] = cached_faqs[card["cardNo"]]
                res.append(card)
        return res

    done_batches = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for batch_cards in ex.map(run_detail_batch, batches):
            done_batches += 1
            for c in batch_cards:
                cards_map[c["printId"]] = c
            if done_batches % 10 == 0 or done_batches == len(batches):
                print(
                    f"  Progress: {len(cards_map)}/{len(all_print_ids)} cards ({time.time() - t0:.1f}s)",
                    flush=True,
                )

    missed = [pid for pid in all_print_ids if pid not in cards_map]
    if missed:
        print(f"Retrying {len(missed)} missed cards...", flush=True)
        for i in range(0, len(missed), 10):
            for c in run_detail_batch(missed[i:i + 10]):
                cards_map[c["printId"]] = c

    synced_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with open(DATA_DIR / "packages.json", "w", encoding="utf-8") as f:
        json.dump(packages_out, f, ensure_ascii=False, indent=2)

    # Write per-collection JSON shards
    for pkg in packages_out:
        code = sanitize_code(pkg["code"])
        pids = pkg_to_pids.get(pkg["code"], [])
        pkg_cards = [cards_map[pid] for pid in pids if pid in cards_map]
        pkg_cards.sort(key=sort_key)
        shard = {
            "syncedAt": synced_at,
            "source": BASE_URL,
            "package": pkg,
            "cards": pkg_cards,
        }
        with open(COLLECTIONS_DIR / f"{code}.json", "w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False)

    print(
        f"Done! Wrote {len(packages_out)} collection shards covering {len(cards_map)} unique cards in {time.time() - t0:.1f}s.",
        flush=True,
    )


if __name__ == "__main__":
    main()
