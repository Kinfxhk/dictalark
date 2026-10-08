#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Independent Python oracle for Dictalark (standard library only).

Shares no code with the TypeScript core. It builds random cases, works out the expected
answer itself, runs the same cases through the real TypeScript code (tools/oracle/bridge.ts,
via node) and compares. Covered:

- alignment: optimal string alignment distance (own dynamic programme), and that every
  alignment the TypeScript code returns is valid (it rebuilds both strings and its cost
  equals the distance);
- marking: right/wrong, closest accepted answer and distance, with the typing rules
  (case, spaces, curly quotes, full-width letters, invisible characters, optional final
  punctuation, Chinese punctuation);
- review schedule: Leitner boxes and intervals, calendar arithmetic over 2000–2999
  (leap years; days outside 2000–2999 must be refused), "due today" order, and the local calendar day in IANA time zones;
- seeded shuffle: the same seed gives the same order (PRNG and Fisher–Yates written again).

    python3 tools/oracle/oracle.py [--seed N] [--quick]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import re
import subprocess
import sys
import unicodedata
from fractions import Fraction

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---- optimal string alignment ---------------------------------------------------------
def osa(a, b):
    n, m = len(a), len(b)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1] and a[i - 1] != a[i - 2]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[n][m]


def check_ops(a, b, ops, distance):
    """None if the alignment is valid, else the reason."""
    ra, rb, cost = [], [], 0
    for op in ops:
        k, x, y = op["kind"], op["a"], op["b"]
        if k == "same":
            if len(x) != 1 or x != y:
                return "bad same"
        elif k == "sub":
            if len(x) != 1 or len(y) != 1 or x == y:
                return "bad sub"
            cost += 1
        elif k == "ins":
            if x or len(y) != 1:
                return "bad ins"
            cost += 1
        elif k == "del":
            if y or len(x) != 1:
                return "bad del"
            cost += 1
        elif k == "swap":
            if len(x) != 2 or y != [x[1], x[0]] or x[0] == x[1]:
                return "bad swap"
            cost += 1
        else:
            return "unknown op"
        ra += x
        rb += y
    if ra != list(a) or rb != list(b):
        return "does not rebuild the strings"
    if cost != distance:
        return f"cost {cost} != distance {distance}"
    return None


# ---- marking, typing rules written again from docs ---------------------------------------
def is_han(ch):
    o = ord(ch)
    return 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF


def norm(s, chinese):
    s = re.sub("[\u200b\u2060\ufeff]", "", s)
    s = "".join(chr(ord(c) - 0xFEE0) if (0xFF10 <= ord(c) <= 0xFF19 or 0xFF21 <= ord(c) <= 0xFF3A
                                        or 0xFF41 <= ord(c) <= 0xFF5A) else c for c in s)
    s = re.sub("[\u2018\u2019\u02bc\u2032]", "'", s)
    s = re.sub("[\u201c\u201d]", '"', s)
    s = re.sub("[ \t\u00a0\u3000]+", " ", s).strip(" ")
    if chinese:
        s = s.translate(str.maketrans(",.?!:;()", "，。？！：；（）"))
    else:
        s = re.sub(r"[.!?]+$", "", s).rstrip(" ")
    return [c.lower() for c in s]


def mark(expected, answer, accept):
    chinese = any(is_han(c) for c in expected)
    ga = norm(answer, chinese)
    best = None
    for t, target in enumerate([expected] + accept):
        dist = osa(norm(target, chinese), ga)
        if best is None or dist < best[1]:
            best = (t - 1, dist)
            if dist == 0:
                break
    return {"correct": best[1] == 0, "target": best[0], "distance": best[1]}


LATIN = "abcdefghijklmnopqrstuvwxyz"
HAN = "默書雲雀羣群學校老師同學今天明日天氣晴朗"


def variant(rng, word, chinese):
    """A typed answer near `word`: edits, then typing noise the rules forgive."""
    w = list(word)
    for _ in range(rng.choice([0, 0, 0, 1, 1, 2, 3])):
        k = rng.randrange(5)
        pool = HAN if chinese else LATIN
        if k == 0 and w:
            w.pop(rng.randrange(len(w)))
        elif k == 1:
            w.insert(rng.randrange(len(w) + 1), rng.choice(pool))
        elif k == 2 and w:
            w[rng.randrange(len(w))] = rng.choice(pool)
        elif k == 3 and len(w) > 1:
            i = rng.randrange(len(w) - 1)
            w[i], w[i + 1] = w[i + 1], w[i]
    s = "".join(w)
    if not chinese:
        s = "".join(c.upper() if rng.random() < 0.15 else c for c in s)
        s = "".join(chr(ord(c) + 0xFEE0) if c.isalpha() and rng.random() < 0.05 else c for c in s)
        s = s.replace("'", rng.choice(["'", "\u2019", "\u02bc"]))
        if rng.random() < 0.2:
            s += rng.choice([".", "!", "?", "..."])
        if rng.random() < 0.1:
            s = "  " + s.replace(" ", rng.choice(["  ", "\u00a0", "\u3000"])) + " "
    elif rng.random() < 0.3:
        s += rng.choice(["。", ".", "!", "？"])
    if rng.random() < 0.05:
        i = rng.randrange(len(s) + 1)
        s = s[:i] + "\u200b" + s[i:]
    return s


def rand_word(rng, chinese):
    if chinese:
        return "".join(rng.choice(HAN) for _ in range(rng.randint(1, 6)))
    words = ["".join(rng.choice(LATIN[:rng.choice([4, 8, 26])]) for _ in range(rng.randint(1, 8)))
             for _ in range(rng.choice([1, 1, 1, 2, 3]))]
    w = " ".join(words)
    if rng.random() < 0.1:
        w = w[:1] + "'" + w[1:]
    return w + (rng.choice([".", "!", "?"]) if rng.random() < 0.1 else "")


# ---- review schedule --------------------------------------------------------------------
def next_card(card, result, today, intervals):
    box = min(5, (card["box"] if card else 1) + 1) if result == "right" else 1
    due = dt.date.fromisoformat(today) + dt.timedelta(days=intervals[box - 1])
    return {"box": box, "due": due.isoformat()}


def rand_day(rng):
    """Mostly 2000–2998 (the range Dictalark accepts); now and then just outside it."""
    if rng.random() < 0.03:
        return rng.choice(["1999-12-31", "3000-01-01", "2026-02-29", "2024-02-30", "2026-13-01"])
    return (dt.date(2000, 1, 1) + dt.timedelta(days=rng.randrange(365_000))).isoformat()


def valid_day(s):
    try:
        d = dt.date.fromisoformat(s)
    except ValueError:
        return False
    return 2000 <= d.year <= 2999


def rand_intervals(rng):
    xs = sorted(rng.randint(0, 365) for _ in range(5))
    return xs if rng.random() < 0.7 else [0, 1, 3, 7, 14]


# ---- seeded shuffle, written again from the description ------------------------------------
M32 = 0xFFFFFFFF


def prng(seed):
    state = (seed ^ 0x9E3779B9) & M32

    def nxt():
        nonlocal state
        state = (state + 0x6D2B79F5) & M32
        z = state
        z = ((z ^ (z >> 16)) * 0x21F0AAAD) & M32
        z = ((z ^ (z >> 15)) * 0x735A2D97) & M32
        return (z ^ (z >> 15)) & M32

    return nxt


def below(nxt, n):
    limit = 2 ** 32 - (2 ** 32 % n)
    while True:
        x = nxt()
        if x < limit:
            return x % n


def shuffle(n, seed):
    out = list(range(n))
    nxt = prng(seed)
    for i in range(n - 1, 0, -1):
        j = below(nxt, i + 1)
        out[i], out[j] = out[j], out[i]
    return out


# ---- QR code: Reed–Solomon over GF(256) with log/antilog tables, and the data bit stream ----
GF_EXP = [0] * 512
GF_LOG = [0] * 256
_x = 1
for _i in range(255):
    GF_EXP[_i] = _x
    GF_LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    GF_EXP[_i] = GF_EXP[_i - 255]


def gf_mul(a, b):
    return 0 if a == 0 or b == 0 else GF_EXP[GF_LOG[a] + GF_LOG[b]]


def rs_remainder(data, n):
    """Generator = (x - a^0)(x - a^1)...(x - a^(n-1)); remainder of data*x^n by long division."""
    gen = [1]
    for i in range(n):
        nxt = [0] * (len(gen) + 1)
        for j, c in enumerate(gen):
            nxt[j] ^= c
            nxt[j + 1] ^= gf_mul(c, GF_EXP[i])
        gen = nxt
    msg = list(data) + [0] * n
    for i in range(len(data)):
        coef = msg[i]
        if coef:
            for j in range(1, len(gen)):
                msg[i + j] ^= gf_mul(gen[j], coef)
    return msg[len(data):]


def qr_data(text, version, capacity):
    raw = text.encode("utf-8")
    bits = "0100" + format(len(raw), "08b" if version <= 9 else "016b")
    bits += "".join(format(b, "08b") for b in raw)
    if len(bits) > capacity * 8:
        return None
    bits += "0" * min(4, capacity * 8 - len(bits))
    bits += "0" * (-len(bits) % 8)
    out = [int(bits[i:i + 8], 2) for i in range(0, len(bits), 8)]
    pads = [0xEC, 0x11]
    while len(out) < capacity:
        out.append(pads[(len(out) - len(bits) // 8) % 2])
    return out


# ---- class results files: counts, best / last try, missed words ----
def summarise(files):
    """Newest file per pupil (case/space-insensitive name); exact comparisons with Fraction."""
    def key(name):
        return unicodedata.normalize("NFC", name).strip().lower()
    latest = {}
    for f in files:
        k = key(f["pupil"])
        if k not in latest or f["madeAt"] >= latest[k]["madeAt"]:
            latest[k] = f
    chosen = [latest[k] for k in sorted(latest, key=lambda k: k.encode("utf-16-be"))]
    order, names = [], {}
    for f in chosen:
        for lst in f["lists"]:
            if lst["listId"] not in names:
                names[lst["listId"]] = lst["name"]
                order.append(lst["listId"])
    out = []
    for lid in order:
        rows, missed = [], {}
        for f in chosen:
            lst = next((x for x in f["lists"] if x["listId"] == lid), None)
            atts = lst["attempts"] if lst else []
            best = last = None
            for i, a in enumerate(atts):
                tot = a["right"] + a["wrong"] + a["blank"]
                share = Fraction(a["right"], tot)
                if best is None or share > best[0]:
                    best = (share, a["right"], tot)
                if last is None or a["day"] >= last[0]:
                    last = (a["day"], a["right"], tot)
            rows.append({"pupil": f["pupil"], "tries": len(atts),
                         "best": None if best is None else {"right": best[1], "total": best[2]},
                         "last": None if last is None else {"day": last[0], "right": last[1], "total": last[2]}})
            for m in (lst["missed"] if lst else []):
                if m["times"] == 0:
                    continue
                text = next(i["text"] for i in lst["items"] if i["id"] == m["itemId"])
                w = missed.setdefault(text, {"text": text, "pupils": 0, "times": 0})
                w["pupils"] += 1
                w["times"] += m["times"]
        ranked = sorted(missed.values(), key=lambda w: (-w["pupils"], -w["times"], w["text"].encode("utf-16-be")))
        out.append({"listId": lid, "name": names[lid], "rows": rows,
                    "tried": sum(1 for r in rows if r["tries"] > 0),
                    "allRight": sum(1 for r in rows if r["last"] and r["last"]["right"] == r["last"]["total"]),
                    "missed": ranked})
    return {"pupils": [f["pupil"] for f in chosen], "replaced": len(files) - len(chosen), "lists": out}


def results_of(lib, ids):
    out = []
    for lid in ids:
        lst = next(x for x in lib["lists"] if x["id"] == lid)
        item_ids = {i["id"] for i in lst["items"]}
        missed = {}
        atts = []
        for a in lib["attempts"]:
            if a["listId"] != lid or not a["entries"]:
                continue
            n = {"right": 0, "wrong": 0, "blank": 0}
            for e in a["entries"]:
                n[e["result"]] += 1
                if e["result"] != "right" and e["itemId"] in item_ids:
                    missed[e["itemId"]] = missed.get(e["itemId"], 0) + 1
            atts.append({"day": a["day"], "mode": a["mode"], **n})
        out.append({"listId": lid, "name": lst["name"],
                    "items": [{"id": i["id"], "text": i["text"]} for i in lst["items"]],
                    "attempts": atts,
                    "missed": [{"itemId": i["id"], "times": missed[i["id"]]} for i in lst["items"] if i["id"] in missed]})
    return out


def rand_results_files(rng):
    words = ["spoon", "colour", "茶壺", "Apple", "apple", "默書", "Zebra", "é", "e\u0301"]
    pupils = ["Amy", "amy ", "Ben", "陳大文", "Ｃat", "AMY", "Dan"]
    lists = []
    for k in range(rng.randint(1, 3)):
        items = [{"id": f"i{j}", "text": w} for j, w in enumerate(rng.sample(words, rng.randint(1, len(words))))]
        lists.append({"listId": f"L{k}", "name": f"List {k}", "items": items})
    files = []
    for _ in range(rng.randint(0, 8)):
        f_lists = []
        for lst in rng.sample(lists, rng.randint(0, len(lists))):
            atts = []
            for _ in range(rng.randint(0, 5)):
                tot = rng.randint(1, 6)
                r = rng.randint(0, tot)
                w = rng.randint(0, tot - r)
                atts.append({"day": f"2026-{rng.randint(9, 10):02d}-{rng.randint(1, 3):02d}", "mode": "paper",
                             "right": r, "wrong": w, "blank": tot - r - w})
            missed = [{"itemId": i["id"], "times": rng.randint(0, len(atts))}
                      for i in lst["items"] if atts and rng.random() < 0.5]
            f_lists.append({**lst, "attempts": atts, "missed": missed})
        files.append({"format": "dictalark-class-results", "schema": 1, "pupil": rng.choice(pupils),
                      "madeAt": f"2026-10-0{rng.randint(1, 3)}T00:00:00Z", "lists": f_lists})
    return files


def rand_pupil_lib(rng):
    lists = []
    attempts = []
    for k in range(rng.randint(1, 3)):
        items = [{"id": f"i{j}", "text": f"w{j}", "accept": [], "note": ""} for j in range(rng.randint(1, 6))]
        lists.append({"id": f"L{k}", "name": f"List {k}", "subject": "english", "lang": "en-GB",
                      "items": items, "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-10-01T00:00:00Z"})
        for a in range(rng.randint(0, 5)):
            ids = [i["id"] for i in items] + ["gone"]
            entries = [{"itemId": rng.choice(ids), "result": rng.choice(["right", "wrong", "blank"]), "answer": "x"}
                       for _ in range(rng.randint(0, 5))]
            attempts.append({"id": f"a{k}-{a}", "listId": f"L{k}", "day": "2026-10-0" + str(rng.randint(1, 9)),
                             "mode": rng.choice(["paper", "typing", "cards"]), "entries": entries})
    rng.shuffle(attempts)
    return {"lists": lists, "attempts": attempts, "srs": {}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=int(os.environ.get("ORACLE_SEED", "20261008")))
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    N = 1000 if a.quick else 6000

    align_cases = []
    for _ in range(N):
        alpha = rng.choice(["ab", "abc", LATIN[:6], HAN[:5]])
        x = [rng.choice(alpha) for _ in range(rng.randint(0, 12))]
        y = list(x) if rng.random() < 0.5 else [rng.choice(alpha) for _ in range(rng.randint(0, 12))]
        for _ in range(rng.randint(0, 3)):
            if y and rng.random() < 0.5:
                i = rng.randrange(len(y))
                y[i] = rng.choice(alpha)
            elif len(y) > 1:
                i = rng.randrange(len(y) - 1)
                y[i], y[i + 1] = y[i + 1], y[i]
        align_cases.append([x, y])

    mark_cases = []
    for _ in range(N):
        chinese = rng.random() < 0.35
        exp = rand_word(rng, chinese)
        accept = [rand_word(rng, chinese) if rng.random() < 0.5 else variant(rng, exp, chinese).strip()
                  for _ in range(rng.choice([0, 0, 1, 2]))]
        accept = [x for x in accept if x.strip()]
        base = rng.choice([exp] + accept)
        mark_cases.append({"expected": exp, "answer": variant(rng, base, chinese), "accept": accept})

    results = ["right", "wrong", "blank"]
    next_cases = [{"card": None if rng.random() < 0.2 else {"box": rng.randint(1, 5), "due": rand_day(rng)},
                   "result": rng.choice(results), "today": rand_day(rng), "intervals": rand_intervals(rng)}
                  for _ in range(N)]
    day_cases = [{"day": rand_day(rng), "n": rng.randint(-40000, 40000), "other": rand_day(rng)}
                 for _ in range(N)]
    for c in day_cases:  # keep results inside years 1..9999 for Python's date type
        if valid_day(c["day"]):
            d = dt.date.fromisoformat(c["day"])
            if not (dt.date(1, 1, 2) < d + dt.timedelta(days=c["n"]) < dt.date(9999, 12, 30)):
                c["n"] = 0
    due_cases = []
    for _ in range(N // 4):
        srs = {f"l{rng.randint(1, 3)}/i{k}": {"box": rng.randint(1, 5), "due": f"2026-10-{rng.randint(1, 20):02d}"}
               for k in range(rng.randint(0, 15))}
        due_cases.append({"srs": srs, "today": f"2026-10-{rng.randint(1, 20):02d}"})

    zones = ["Asia/Hong_Kong", "Asia/Taipei", "Europe/London", "America/New_York",
             "Australia/Lord_Howe", "Pacific/Chatham", "America/St_Johns", "Asia/Kolkata", "UTC"]
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo("Asia/Hong_Kong")
        have_zones = True
    except Exception:  # no tz database (e.g. some Windows Pythons): skip this part
        have_zones = False
    local_cases = []
    if have_zones:
        for _ in range(N // 2):
            ms = rng.randint(0, 4_102_444_800_000)  # 1970..2100
            if rng.random() < 0.3:  # near a midnight or a DST change
                ms = ms // 3_600_000 * 3_600_000 + rng.choice([-1, 0, 1, 59_999, 60_000])
            local_cases.append({"ms": ms, "zone": rng.choice(zones)})
    shuffle_cases = [{"n": rng.randint(0, 60), "seed": rng.randint(0, 999_999)} for _ in range(N // 4)]
    # large ranges, where rejection sampling really rejects (up to half the draws)
    below_cases = [{"n": rng.choice([3 * 2 ** 30, 2 ** 31 + 1, rng.randint(1, 2 ** 32)]),
                    "seed": rng.randint(0, 999_999), "count": 20} for _ in range(N // 20)]

    rs_cases = [{"data": [rng.randrange(256) for _ in range(rng.randint(1, 153))],
                 "ec": rng.choice([7, 10, 13, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30])}
                for _ in range(N // 10)]
    qr_texts = ["", "a", "默書", "https://kinfxhk.github.io/dictalark/#/share/"]
    qrdata_cases = [{"text": rng.choice(qr_texts) + "".join(rng.choice("abcXYZ09-_é雲")
                                                              for _ in range(rng.randint(0, 120))),
                     "v": rng.randint(1, 40), "ecc": rng.choice("LMQH")} for _ in range(N // 10)]

    summary_cases = [rand_results_files(rng) for _ in range(N // 10)]
    results_cases = []
    for _ in range(N // 10):
        lib = rand_pupil_lib(rng)
        ids = [l["id"] for l in lib["lists"]]
        results_cases.append({"lib": lib, "ids": rng.sample(ids, rng.randint(1, len(ids)))})

    payload = {"align": align_cases, "mark": mark_cases, "next": next_cases, "days": day_cases,
               "due": due_cases, "local": local_cases, "shuffle": shuffle_cases,
               "below": below_cases, "rs": rs_cases, "qrdata": qrdata_cases,
               "summary": summary_cases, "results": results_cases}
    proc = subprocess.run([os.environ.get("NODE", "node"), "--import", "tsx",
                           os.path.join("tools", "oracle", "bridge.ts")],
                          input=json.dumps(payload).encode(), capture_output=True, cwd=ROOT)
    if proc.returncode:
        sys.stderr.write(proc.stderr.decode())
        return 2
    got = json.loads(proc.stdout)
    fails = []

    def fail(m):
        fails.append(m)

    for c, g in zip(summary_cases, got["summary"]):
        want = summarise(c)
        if want != g:
            fail(f"summary {json.dumps(c, ensure_ascii=False)[:300]}: oracle {want} ts {g}")
    for c, g in zip(results_cases, got["results"]):
        want = results_of(c["lib"], c["ids"])
        if "error" in g or want != g["lists"]:
            fail(f"results {c['ids']}: oracle {want} ts {g}")
    for c, g in zip(rs_cases, got["rs"]):
        if rs_remainder(c["data"], c["ec"]) != g:
            fail(f"reedSolomon {c}: differs")
    qr_checked = 0
    qr_refused = 0
    for c, g in zip(qrdata_cases, got["qrdata"]):
        want = qr_data(c["text"], c["v"], g["cap"])
        if want is None:  # too long for this symbol: TS must refuse it
            qr_refused += 1
            if g["out"] != {"error": "too-large"}:
                fail(f"qr data {c}: should be refused, ts {g['out']}")
            continue
        qr_checked += 1
        if want != g["out"]:
            fail(f"qr data {c}: oracle {want} ts {g['out']}")
    for c, g in zip(below_cases, got["below"]):
        nxt = prng(c["seed"])
        if [below(nxt, c["n"]) for _ in range(c["count"])] != g:
            fail(f"below {c}: differs")
    for (x, y), g in zip(align_cases, got["align"]):
        if "error" in g:
            fail(f"align {x} {y}: ts refused ({g['error']})")
            continue
        want = osa(x, y)
        if g["distance"] != want:
            fail(f"align {x} {y}: oracle {want} ts {g['distance']}")
        why = check_ops(x, y, g["ops"], g["distance"])
        if why:
            fail(f"align {x} {y}: invalid alignment ({why})")
    for c, g in zip(mark_cases, got["mark"]):
        want = mark(c["expected"], c["answer"], c["accept"])
        if want != g:
            fail(f"mark {c}: oracle {want} ts {g}")
    for c, g in zip(next_cases, got["next"]):
        want = next_card(c["card"], c["result"], c["today"], c["intervals"]) if valid_day(c["today"]) \
            else {"error": "bad-date"}
        if want != g:
            fail(f"nextCard {c}: oracle {want} ts {g}")
    for c, g in zip(day_cases, got["days"]):
        if not (valid_day(c["day"]) and valid_day(c["other"])):
            want = {"error": "bad-date"}
        else:
            d = dt.date.fromisoformat(c["day"])
            want = {"added": (d + dt.timedelta(days=c["n"])).isoformat(),
                    "between": (dt.date.fromisoformat(c["other"]) - d).days}
        if want != g:
            fail(f"days {c}: oracle {want} ts {g}")
    for c, g in zip(due_cases, got["due"]):
        want = [k for k, _ in sorted(((k, v) for k, v in c["srs"].items() if v["due"] <= c["today"]),
                                     key=lambda kv: (kv[1]["due"], kv[0]))]
        if want != g:
            fail(f"dueKeys {c}: oracle {want} ts {g}")
    if have_zones:
        from zoneinfo import ZoneInfo
        for c, g in zip(local_cases, got["local"]):
            want = dt.datetime.fromtimestamp(c["ms"] / 1000, ZoneInfo(c["zone"])).date().isoformat()
            if want != g:
                fail(f"localDay {c}: oracle {want} ts {g}")
    for c, g in zip(shuffle_cases, got["shuffle"]):
        if shuffle(c["n"], c["seed"]) != g:
            fail(f"shuffle {c}: differs")

    print(f"dictalark oracle seed={a.seed}: align {len(align_cases)}, mark {len(mark_cases)}, "
          f"nextCard {len(next_cases)}, days {len(day_cases)}, due {len(due_cases)}, "
          f"localDay {len(local_cases)}{'' if have_zones else ' (no tz database: skipped)'}, "
          f"shuffle {len(shuffle_cases)}, below {len(below_cases)}, "
          f"classSummary {len(summary_cases)}, classResults {len(results_cases)}, "
          f"reedSolomon {len(rs_cases)}, qrData {qr_checked} (+{qr_refused} too long)")
    if fails:
        print(f"FAILED: {len(fails)} differences")
        for f in fails[:30]:
            print("  " + f)
        return 1
    print("OK: every result matches the independent Python oracle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
