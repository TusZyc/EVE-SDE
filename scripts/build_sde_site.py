from __future__ import annotations

import json
import os
import shutil
import tempfile
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DIST = ROOT / "dist"
TMP = ROOT / ".tmp"
LATEST_URL = "https://developers.eveonline.com/static-data/tranquility/latest.jsonl"
ZIP_TEMPLATE = "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-{build}-{variant}.zip"
VARIANT = os.environ.get("SDE_VARIANT", "jsonl")
MAX_RECORDS = int(os.environ.get("MAX_RECORDS_PER_SHARD", "600"))
MAX_BYTES = int(os.environ.get("MAX_BYTES_PER_SHARD", "2500000"))
PREFERRED_LANGS = ("en", "en-us", "zh", "ja", "de", "fr", "ko", "ru", "es")
SEARCH_MIN = 2
USER_AGENT = "Mozilla/5.0 (compatible; EVE-SDE-Browser/1.0)"


def request(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}))


def text(url: str) -> str:
    with request(url) as r:
        return r.read().decode("utf-8")


def download(url: str, dest: Path) -> None:
    with request(url) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)


def clean(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def latest_build() -> int:
    nums: list[int] = []
    for line in text(LATEST_URL).splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        for value in obj.values():
            if isinstance(value, int):
                nums.append(value)
            elif isinstance(value, str) and value.isdigit() and len(value) >= 6:
                nums.append(int(value))
    if not nums:
        raise RuntimeError("Could not determine latest SDE build")
    return max(nums)


def pick_text(value: Any) -> str | None:
    if isinstance(value, str):
        v = value.strip()
        return v or None
    if isinstance(value, dict):
        lowered = {str(k).lower(): v for k, v in value.items()}
        for lang in PREFERRED_LANGS:
            v = lowered.get(lang)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for v in value.values():
            found = pick_text(v)
            if found:
                return found
    if isinstance(value, list):
        for v in value:
            found = pick_text(v)
            if found:
                return found
    return None


def flatten_text(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, dict):
        out: list[str] = []
        for v in value.values():
            out.extend(flatten_text(v))
        return out
    if isinstance(value, list):
        out: list[str] = []
        for v in value:
            out.extend(flatten_text(v))
        return out
    return []


def infer_key(record: dict[str, Any], stem: str) -> str:
    if "_key" in record:
        return str(record["_key"])
    for key, value in record.items():
        if key.lower().endswith("id") and not isinstance(value, (dict, list)):
            return str(value)
    return f"{stem}-{abs(hash(json.dumps(record, ensure_ascii=False, sort_keys=True))) % 10**12}"


def infer_title(record: dict[str, Any], stem: str, key: str) -> str:
    for name in ("name", "displayName", "description", "effectName", "iconFile"):
        if name in record:
            found = pick_text(record[name])
            if found:
                return found
    return f"{stem} #{key}"


def infer_summary(record: dict[str, Any], stem: str, key: str, title: str) -> str:
    bits = [title, stem, f"key={key}"]
    for field in ("groupID", "categoryID", "marketGroupID", "factionID", "raceID", "published"):
        if field in record:
            bits.append(f"{field}={record[field]}")
    return " · ".join(str(x) for x in bits)


def search_blob(record: dict[str, Any], stem: str, key: str, title: str) -> str:
    tokens = [stem, key, title]
    for field in ("name", "displayName", "description", "effectName", "groupName", "categoryName"):
        if field in record:
            tokens.extend(flatten_text(record[field]))
    for field, value in record.items():
        if field.lower().endswith("id") and not isinstance(value, (dict, list)):
            tokens.append(str(value))
    return " ".join(" ".join(tokens).lower().split())


def compact(record: dict[str, Any], stem: str) -> dict[str, Any]:
    out = dict(record)
    key = infer_key(out, stem)
    title = infer_title(out, stem, key)
    out["_ui"] = {"key": key, "title": title, "summary": infer_summary(out, stem, key, title)}
    return out


def process_file(source: Path, target_root: Path, search_entries: list[dict[str, Any]], rel_name: str) -> dict[str, Any]:
    stem = rel_name.replace("/", "__").removesuffix(".jsonl")
    out_dir = target_root / stem
    out_dir.mkdir(parents=True, exist_ok=True)
    shard_i = 0
    shard: list[dict[str, Any]] = []
    shard_bytes = 0
    total = 0
    fields: Counter[str] = Counter()

    def flush() -> None:
        nonlocal shard_i, shard, shard_bytes
        if not shard:
            return
        (out_dir / f"{shard_i}.json").write_text(json.dumps(shard, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        shard_i += 1
        shard = []
        shard_bytes = 0

    with source.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                record = {"_value": record}
            total += 1
            fields.update(record.keys())
            key = infer_key(record, stem)
            title = infer_title(record, stem, key)
            search_entries.append({"file": stem, "key": key, "title": title, "summary": infer_summary(record, stem, key, title), "q": search_blob(record, stem, key, title)})
            item = compact(record, stem)
            size = len(json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if shard and (len(shard) >= MAX_RECORDS or shard_bytes + size > MAX_BYTES):
                flush()
            shard.append(item)
            shard_bytes += size
    flush()
    manifest = {"file": stem, "source": rel_name, "records": total, "shards": shard_i, "topFields": [k for k, _ in fields.most_common(16)]}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def build(extracted: Path, build_no: int, variant: str) -> None:
    clean(DIST)
    data_root = DIST / "data" / "files"
    data_root.mkdir(parents=True, exist_ok=True)
    search_entries: list[dict[str, Any]] = []
    manifests: list[dict[str, Any]] = []
    files = sorted(extracted.rglob("*.jsonl"), key=lambda p: str(p.relative_to(extracted)).lower())
    if not files:
        raise RuntimeError("No JSONL files found in extracted SDE archive")
    for file in files:
        manifests.append(process_file(file, data_root, search_entries, file.relative_to(extracted).as_posix()))
    search_entries.sort(key=lambda x: (x["title"].lower(), x["file"], x["key"]))
    (DIST / "data" / "search-index.json").write_text(json.dumps({"minimumQueryLength": SEARCH_MIN, "entries": search_entries}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DIST / "data" / "meta.json").write_text(json.dumps({"siteTitle": "EVE SDE Browser", "buildNumber": build_no, "variant": variant, "generatedAt": datetime.now(timezone.utc).isoformat(), "fileCount": len(manifests), "files": manifests}, ensure_ascii=False, indent=2), encoding="utf-8")
    for path in SRC.rglob("*"):
        if path.is_file():
            target = DIST / path.relative_to(SRC)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def main() -> None:
    TMP.mkdir(parents=True, exist_ok=True)
    build_no = latest_build()
    zip_url = ZIP_TEMPLATE.format(build=build_no, variant=VARIANT)
    with tempfile.TemporaryDirectory(dir=TMP) as tmp_name:
        tmp = Path(tmp_name)
        zip_path = tmp / f"eve-online-static-data-{build_no}-{VARIANT}.zip"
        extracted = tmp / "extracted"
        extracted.mkdir(parents=True, exist_ok=True)
        print(f"Downloading official SDE build {build_no} from {zip_url}")
        download(zip_url, zip_path)
        print(f"Extracting {zip_path.name}")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extracted)
        print("Building static site")
        build(extracted, build_no, VARIANT)
        print(f"Done. Output written to {DIST}")


if __name__ == "__main__":
    main()
