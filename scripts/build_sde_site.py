from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from openpyxl import load_workbook  # type: ignore
except Exception:
    load_workbook = None

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DIST = ROOT / "dist"
TMP = ROOT / ".tmp"

LATEST_URL = "https://developers.eveonline.com/static-data/tranquility/latest.jsonl"
ZIP_TEMPLATE = "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-{build}-{variant}.zip"
CEVE_XLSX_URL = os.environ.get("CEVE_MARKET_XLSX_URL", "https://www.ceve-market.org/dumps/evedata.xlsx")

VARIANT = os.environ.get("SDE_VARIANT", "jsonl")
MAX_RECORDS = int(os.environ.get("MAX_RECORDS_PER_SHARD", "600"))
MAX_BYTES = int(os.environ.get("MAX_BYTES_PER_SHARD", "2500000"))
SEARCH_MIN = 2
USER_AGENT = "Mozilla/5.0 (compatible; EVE-SDE-Browser/2.0)"

PREFERRED_LANGS = ("zh", "zh-cn", "en", "en-us", "ja", "de", "fr", "ko", "ru", "es")

FILE_INFO = {
    "types": {"label": "物品类型", "desc": "游戏中的具体物品、舰船、模块、技能书、蓝图等类型定义。"},
    "groups": {"label": "物品分组", "desc": "类型所属的功能分组，如护盾模块、弹药、巡洋舰等。"},
    "categories": {"label": "物品大类", "desc": "更高层级的分类，如舰船、模块、技能、行星工业等。"},
    "marketgroups": {"label": "市场分类", "desc": "市场树中的分类结构，决定物品在市场浏览器中的层级。"},
    "metagroups": {"label": "元组分类", "desc": "Meta Group，用于区分 T1、T2、势力、死亡空间、官员等。"},
    "dogmaattributes": {"label": "Dogma 属性", "desc": "数值字段定义，如射程、CPU、PG、伤害修正、速度等。"},
    "dogmaeffects": {"label": "Dogma 效果", "desc": "物品或技能附带的规则效果定义。"},
    "mapregions": {"label": "星域", "desc": "EVE 宇宙中的 Region。"},
    "mapconstellations": {"label": "星座", "desc": "EVE 宇宙中的 Constellation。"},
    "mapsolarsystems": {"label": "星系", "desc": "EVE 宇宙中的 Solar System。"},
    "stastations": {"label": "空间站", "desc": "NPC 空间站资料。"},
    "factions": {"label": "势力", "desc": "NPC 势力与阵营定义。"},
    "races": {"label": "种族", "desc": "艾玛、加达里、盖伦特、米玛塔尔等种族定义。"},
    "blueprints": {"label": "蓝图", "desc": "蓝图生产、发明、研究活动定义。"},
    "schematics": {"label": "行星工业配方", "desc": "PI 设施的配方与产出定义。"},
    "skills": {"label": "技能", "desc": "技能训练属性、前置技能与训练倍率。"},
    "units": {"label": "单位", "desc": "属性数值使用的单位定义。"},
    "icons": {"label": "图标", "desc": "图标资源索引。"},
}

FIELD_INFO = {
    "_key": {"label": "记录键", "meaning": "该记录在当前文件中的主键或推断键。"},
    "typeID": {"label": "物品 ID", "meaning": "游戏内物品类型的唯一编号。"},
    "groupID": {"label": "分组 ID", "meaning": "该物品所属的 Group 编号。"},
    "categoryID": {"label": "大类 ID", "meaning": "该物品所属的 Category 编号。"},
    "marketGroupID": {"label": "市场分类 ID", "meaning": "该物品在市场树中的分类编号。"},
    "metaGroupID": {"label": "Meta 分类 ID", "meaning": "物品所属的 Meta 级别分组。"},
    "metaLevel": {"label": "Meta 等级", "meaning": "物品的 Meta Level 数值。"},
    "factionID": {"label": "势力 ID", "meaning": "与该物品或地点关联的 NPC 势力编号。"},
    "raceID": {"label": "种族 ID", "meaning": "关联种族编号。"},
    "regionID": {"label": "星域 ID", "meaning": "Region 唯一编号。"},
    "constellationID": {"label": "星座 ID", "meaning": "Constellation 唯一编号。"},
    "solarSystemID": {"label": "星系 ID", "meaning": "Solar System 唯一编号。"},
    "stationID": {"label": "空间站 ID", "meaning": "NPC 空间站唯一编号。"},
    "name": {"label": "名称", "meaning": "该记录在游戏内显示的名称，通常带多语言版本。"},
    "description": {"label": "描述", "meaning": "游戏内说明文本。"},
    "published": {"label": "是否发布", "meaning": "是否为对玩家公开可见的正式内容。"},
    "mass": {"label": "质量", "meaning": "物品或舰船的质量。"},
    "volume": {"label": "体积", "meaning": "物品体积。"},
    "capacity": {"label": "容量", "meaning": "容器、货舱、模块等可容纳体积。"},
    "portionSize": {"label": "份额", "meaning": "市场与工业中使用的默认份额数量。"},
    "radius": {"label": "半径", "meaning": "空间对象半径。"},
    "basePrice": {"label": "基础价格", "meaning": "系统定义的基础价格，用于税费、爆损等计算。"},
    "graphicID": {"label": "模型 ID", "meaning": "绑定到资源模型的图形编号。"},
    "iconID": {"label": "图标 ID", "meaning": "绑定到图标资源的编号。"},
    "soundID": {"label": "音效 ID", "meaning": "关联音效编号。"},
    "parentGroupID": {"label": "父级市场分类", "meaning": "市场树中的父节点编号。"},
    "hasTypes": {"label": "含物品", "meaning": "该市场分类下是否直接挂物品。"},
    "typeIDs": {"label": "物品列表", "meaning": "该分组、分类或市场分类中关联的物品 ID 列表。"},
    "groupIDs": {"label": "分组列表", "meaning": "该分类下包含的 Group 列表。"},
    "childMarketGroupIDs": {"label": "子市场分类", "meaning": "该市场分类的子节点列表。"},
    "dogmaAttributes": {"label": "属性值", "meaning": "该物品挂载的 Dogma 属性实值。"},
    "dogmaEffects": {"label": "效果列表", "meaning": "该物品挂载的 Dogma 效果。"},
    "requiredSkills": {"label": "前置技能", "meaning": "使用或学习该内容所需的技能与等级。"},
    "traits": {"label": "加成描述", "meaning": "舰船、结构或物品的加成说明。"},
    "activities": {"label": "工业活动", "meaning": "蓝图涉及的生产、复制、发明等活动。"},
    "materials": {"label": "材料", "meaning": "制造或反应所需输入材料。"},
    "products": {"label": "产物", "meaning": "制造或反应的输出结果。"},
    "time": {"label": "耗时", "meaning": "对应活动所需时间。"},
    "wormholeClassID": {"label": "虫洞等级", "meaning": "虫洞星系所属的 W-space 等级。"},
}

ID_FIELD_ENTITY_HINTS = {
    "typeID": "type",
    "groupID": "group",
    "categoryID": "category",
    "marketGroupID": "marketgroup",
    "metaGroupID": "metagroup",
    "regionID": "region",
    "constellationID": "constellation",
    "solarSystemID": "system",
    "stationID": "station",
    "factionID": "faction",
    "raceID": "race",
}

ENTITY_FILE_HINTS = {
    "types": "type",
    "groups": "group",
    "categories": "category",
    "marketgroups": "marketgroup",
    "metagroups": "metagroup",
    "mapregions": "region",
    "mapconstellations": "constellation",
    "mapsolarsystems": "system",
    "stastations": "station",
    "factions": "faction",
    "races": "race",
}


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


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def split_words(name: str) -> list[str]:
    parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", name)
    return [p.lower() for p in parts if p]


def humanize_field(name: str) -> str:
    if name in FIELD_INFO:
        return FIELD_INFO[name]["label"]
    if name.lower() in {k.lower(): k for k in FIELD_INFO}.keys():
        for key, value in FIELD_INFO.items():
            if key.lower() == name.lower():
                return value["label"]
    return " ".join(split_words(name)) or name


def field_meaning(name: str) -> str:
    info = FIELD_INFO.get(name)
    if info:
        return info["meaning"]
    lowered = name.lower()
    for key, value in FIELD_INFO.items():
        if key.lower() == lowered:
            return value["meaning"]
    if lowered.endswith("id"):
        return "这是一个 ID 字段，用来关联到另一份 SDE 数据记录。"
    if lowered.endswith("ids"):
        return "这是一个 ID 列表字段，用来关联到多条 SDE 记录。"
    if lowered.endswith("name"):
        return "这是一个名称字段。"
    return "该字段来自官方 SDE 原始数据。"


def file_key_from_stem(stem: str) -> str:
    return normalize_key(stem.replace("__", "_").replace(".jsonl", ""))


def file_display(stem: str) -> dict[str, str]:
    key = file_key_from_stem(stem)
    info = FILE_INFO.get(key)
    if info:
        return info
    return {"label": stem, "desc": "官方 SDE 数据文件。"}


def pick_lang(value: Any, preferred: tuple[str, ...] = PREFERRED_LANGS) -> str | None:
    if isinstance(value, str):
        v = value.strip()
        return v or None
    if isinstance(value, dict):
        lowered = {str(k).lower(): v for k, v in value.items()}
        for lang in preferred:
            candidate = lowered.get(lang)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for candidate in value.values():
            found = pick_lang(candidate, preferred)
            if found:
                return found
    if isinstance(value, list):
        for candidate in value:
            found = pick_lang(candidate, preferred)
            if found:
                return found
    return None


def pick_zh(value: Any) -> str | None:
    return pick_lang(value, ("zh", "zh-cn"))


def pick_en(value: Any) -> str | None:
    return pick_lang(value, ("en", "en-us"))


def flatten_text(value: Any) -> list[str]:
    if isinstance(value, str):
        value = value.strip()
        return [value] if value else []
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


def safe_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return pick_lang(value)


def infer_key(record: dict[str, Any], stem: str) -> str:
    if "_key" in record:
        return str(record["_key"])
    for key, value in record.items():
        if key.lower().endswith("id") and not isinstance(value, (dict, list)):
            return str(value)
    return f"{stem}-{abs(hash(json.dumps(record, ensure_ascii=False, sort_keys=True))) % 10**12}"


def guess_entity_kind(record: dict[str, Any], file_key: str) -> str | None:
    if file_key in ENTITY_FILE_HINTS:
        return ENTITY_FILE_HINTS[file_key]
    for field, kind in ID_FIELD_ENTITY_HINTS.items():
        if field in record:
            return kind
    return None


def infer_titles(record: dict[str, Any], stem: str, key: str, translation_map: dict[str, dict[str, str]]) -> tuple[str, str | None]:
    file_key = file_key_from_stem(stem)
    entity_kind = guess_entity_kind(record, file_key)
    entity_id = None
    for field, kind in ID_FIELD_ENTITY_HINTS.items():
        if kind == entity_kind and field in record and not isinstance(record[field], (dict, list)):
            entity_id = str(record[field])
            break

    zh: str | None = None
    if entity_kind and entity_id:
        zh = translation_map.get(entity_kind, {}).get(entity_id)

    if not zh:
        for field in ("name", "displayName", "description"):
            if field in record:
                zh = pick_zh(record[field])
                if zh:
                    break

    en: str | None = None
    for field in ("name", "displayName", "description", "effectName", "iconFile"):
        if field in record:
            if not zh:
                zh = pick_zh(record[field])
            en = pick_en(record[field]) if field != "effectName" else safe_text(record[field])
            if en or zh:
                break

    if not zh and "effectName" in record:
        zh = safe_text(record["effectName"])
    if not en and "effectName" in record:
        en = safe_text(record["effectName"])
    if not zh and "iconFile" in record:
        zh = safe_text(record["iconFile"])
    if not en and "iconFile" in record:
        en = safe_text(record["iconFile"])

    title = zh or en or f"{stem} #{key}"
    alt = en if en and en != title else None
    return title, alt


def collect_search_tokens(record: dict[str, Any], stem: str, title: str, alt_title: str | None) -> str:
    tokens = [stem, title]
    if alt_title:
        tokens.append(alt_title)
    for field in ("name", "displayName", "description", "effectName", "groupName", "categoryName"):
        if field in record:
            tokens.extend(flatten_text(record[field]))
    for field, value in record.items():
        if field.lower().endswith("id") and not isinstance(value, (dict, list)):
            tokens.append(str(value))
    return " ".join(" ".join(tokens).lower().split())


def short_value(value: Any) -> str:
    if isinstance(value, dict):
        zh = pick_zh(value)
        en = pick_en(value)
        if zh and en and zh != en:
            return f"{zh} / {en}"
        return zh or en or "对象"
    if isinstance(value, list):
        return f"{len(value)} 项"
    if isinstance(value, bool):
        return "是" if value else "否"
    text_value = safe_text(value)
    if text_value is None:
        return "空"
    if len(text_value) > 80:
        return text_value[:77] + "..."
    return text_value


def build_field_notes(record: dict[str, Any]) -> list[dict[str, str]]:
    notes: list[dict[str, str]] = []
    for field in record.keys():
        if field.startswith("_"):
            continue
        notes.append(
            {
                "key": field,
                "label": humanize_field(field),
                "meaning": field_meaning(field),
                "preview": short_value(record[field]),
            }
        )
    notes.sort(key=lambda item: (0 if item["key"] in FIELD_INFO else 1, item["label"]))
    return notes[:18]


def infer_summary(record: dict[str, Any], stem: str, key: str, title: str, alt_title: str | None) -> str:
    file_info = file_display(stem)
    bits = [file_info["label"], f"键值 {key}"]
    if alt_title:
        bits.append(alt_title)
    for field in ("groupID", "categoryID", "marketGroupID", "metaGroupID", "factionID", "raceID", "published"):
        if field in record:
            bits.append(f"{humanize_field(field)}: {short_value(record[field])}")
    return " · ".join(bits)


def compact(record: dict[str, Any], stem: str, translation_map: dict[str, dict[str, str]]) -> dict[str, Any]:
    out = dict(record)
    key = infer_key(out, stem)
    title, alt_title = infer_titles(out, stem, key, translation_map)
    file_info = file_display(stem)
    out["_ui"] = {
        "key": key,
        "title": title,
        "altTitle": alt_title,
        "summary": infer_summary(out, stem, key, title, alt_title),
        "fileLabel": file_info["label"],
        "fileDesc": file_info["desc"],
        "fieldNotes": build_field_notes(out),
    }
    return out


def process_file(
    source: Path,
    target_root: Path,
    search_entries: list[dict[str, Any]],
    rel_name: str,
    translation_map: dict[str, dict[str, str]],
) -> dict[str, Any]:
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
        (out_dir / f"{shard_i}.json").write_text(
            json.dumps(shard, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
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
            item = compact(record, stem, translation_map)
            ui = item["_ui"]
            search_entries.append(
                {
                    "file": stem,
                    "key": ui["key"],
                    "title": ui["title"],
                    "altTitle": ui["altTitle"],
                    "summary": ui["summary"],
                    "fileLabel": ui["fileLabel"],
                    "q": collect_search_tokens(record, stem, ui["title"], ui["altTitle"]),
                }
            )
            size = len(json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if shard and (len(shard) >= MAX_RECORDS or shard_bytes + size > MAX_BYTES):
                flush()
            shard.append(item)
            shard_bytes += size
    flush()

    file_info = file_display(stem)
    manifest = {
        "file": stem,
        "source": rel_name,
        "records": total,
        "shards": shard_i,
        "topFields": [k for k, _ in fields.most_common(16)],
        "title": file_info["label"],
        "description": file_info["desc"],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def xlsx_headers(row: list[Any]) -> list[str]:
    headers: list[str] = []
    for value in row:
        text_value = safe_text(value) or ""
        headers.append(text_value.strip())
    return headers


def guess_header_indexes(headers: list[str]) -> tuple[int | None, int | None, int | None]:
    normalized = [normalize_key(h) for h in headers]
    id_idx = None
    zh_idx = None
    en_idx = None
    id_priority = [
        "typeid", "itemid", "regionid", "constellationid", "solarsystemid", "systemid",
        "stationid", "npcstationid", "groupid", "categoryid", "marketgroupid", "factionid", "raceid", "id",
    ]
    zh_tokens = ("中文", "cn", "zh", "chinese", "namecn", "namezh", "cnname", "zhname", "名称")
    en_tokens = ("english", "nameen", "enname", "en", "英文")

    for token in id_priority:
        for idx, header in enumerate(normalized):
            if header == token or header.endswith(token):
                id_idx = idx
                break
        if id_idx is not None:
            break
    for idx, original in enumerate(headers):
        if any(token in original.lower() for token in zh_tokens):
            zh_idx = idx
            break
    for idx, original in enumerate(headers):
        if any(token in original.lower() for token in en_tokens):
            en_idx = idx
            break
    if zh_idx is None:
        for idx, header in enumerate(normalized):
            if header in {"name", "itemname"}:
                zh_idx = idx
                break
    return id_idx, zh_idx, en_idx


def guess_sheet_entity(sheet_name: str, headers: list[str]) -> str | None:
    normalized_sheet = normalize_key(sheet_name)
    if "station" in normalized_sheet:
        return "station"
    if "solarsystem" in normalized_sheet or normalized_sheet.endswith("system"):
        return "system"
    if "constellation" in normalized_sheet:
        return "constellation"
    if "region" in normalized_sheet:
        return "region"
    if "item" in normalized_sheet or "type" in normalized_sheet:
        return "type"

    joined = " ".join(headers).lower()
    if "space station" in joined or "npc空间站" in joined or "stationid" in joined:
        return "station"
    if "solarsystemid" in joined or "systemid" in joined:
        return "system"
    if "constellationid" in joined:
        return "constellation"
    if "regionid" in joined:
        return "region"
    if "typeid" in joined or "itemid" in joined:
        return "type"
    return None


def build_translation_map(xlsx_path: Path | None) -> dict[str, dict[str, str]]:
    mapping: dict[str, dict[str, str]] = {kind: {} for kind in {"type", "region", "constellation", "system", "station", "group", "category", "marketgroup", "faction", "race"}}
    if not xlsx_path or not xlsx_path.exists() or load_workbook is None:
        return mapping

    workbook = load_workbook(xlsx_path, read_only=True, data_only=True)
    for sheet in workbook.worksheets:
        rows = sheet.iter_rows(values_only=True)
        try:
            header_row = next(rows)
        except StopIteration:
            continue
        headers = xlsx_headers(list(header_row))
        id_idx, zh_idx, en_idx = guess_header_indexes(headers)
        kind = guess_sheet_entity(sheet.title, headers)
        if id_idx is None or zh_idx is None or kind is None:
            continue

        for row in rows:
            row = list(row)
            if id_idx >= len(row):
                continue
            raw_id = row[id_idx]
            if raw_id is None:
                continue
            text_id = str(raw_id).strip()
            if not text_id or text_id.lower() == "id":
                continue
            zh_value = safe_text(row[zh_idx]) if zh_idx < len(row) else None
            if not zh_value:
                continue
            mapping[kind][text_id] = zh_value
            if en_idx is not None and en_idx < len(row):
                en_value = safe_text(row[en_idx])
                if en_value and kind == "type":
                    mapping.setdefault("type_en", {})[text_id] = en_value
    return mapping


def build(extracted: Path, build_no: int, variant: str, translation_map: dict[str, dict[str, str]], translation_meta: dict[str, Any]) -> None:
    clean(DIST)
    data_root = DIST / "data" / "files"
    data_root.mkdir(parents=True, exist_ok=True)
    search_entries: list[dict[str, Any]] = []
    manifests: list[dict[str, Any]] = []

    files = sorted(extracted.rglob("*.jsonl"), key=lambda p: str(p.relative_to(extracted)).lower())
    if not files:
        raise RuntimeError("No JSONL files found in extracted SDE archive")

    for file in files:
        manifests.append(
            process_file(
                file,
                data_root,
                search_entries,
                file.relative_to(extracted).as_posix(),
                translation_map,
            )
        )

    search_entries.sort(key=lambda x: (x["title"].lower(), x["file"], x["key"]))

    glossary = [
        {"key": key, "label": value["label"], "meaning": value["meaning"]}
        for key, value in sorted(FIELD_INFO.items(), key=lambda item: item[1]["label"])
    ]

    (DIST / "data" / "search-index.json").write_text(
        json.dumps({"minimumQueryLength": SEARCH_MIN, "entries": search_entries}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DIST / "data" / "field-glossary.json").write_text(json.dumps(glossary, ensure_ascii=False, indent=2), encoding="utf-8")
    (DIST / "data" / "meta.json").write_text(
        json.dumps(
            {
                "siteTitle": "EVE SDE 中文资料站",
                "buildNumber": build_no,
                "variant": variant,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "fileCount": len(manifests),
                "files": manifests,
                "translationMeta": translation_meta,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    for path in SRC.rglob("*"):
        if path.is_file():
            target = DIST / path.relative_to(SRC)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def main() -> None:
    TMP.mkdir(parents=True, exist_ok=True)
    build_no = latest_build()
    zip_url = ZIP_TEMPLATE.format(build=build_no, variant=VARIANT)

    translation_meta: dict[str, Any] = {
        "displayLang": "zh",
        "sdeLocalizedText": "优先使用官方 SDE 自带中文字段，其次回退英文。",
        "externalTranslationWorkbook": None,
    }

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

        translation_map: dict[str, dict[str, str]] = {}
        ceve_path = tmp / "evedata.xlsx"
        try:
            if CEVE_XLSX_URL and load_workbook is not None:
                print(f"Downloading CEVE translation workbook from {CEVE_XLSX_URL}")
                download(CEVE_XLSX_URL, ceve_path)
                translation_map = build_translation_map(ceve_path)
                translation_meta["externalTranslationWorkbook"] = {
                    "url": CEVE_XLSX_URL,
                    "status": "loaded",
                    "sheetsApplied": sorted(k for k, v in translation_map.items() if v),
                }
            else:
                translation_meta["externalTranslationWorkbook"] = {
                    "url": CEVE_XLSX_URL,
                    "status": "skipped",
                    "reason": "openpyxl unavailable",
                }
        except Exception as exc:
            translation_meta["externalTranslationWorkbook"] = {
                "url": CEVE_XLSX_URL,
                "status": "failed",
                "reason": str(exc),
            }
            print(f"Warning: failed to load CEVE workbook: {exc}")

        print("Building localized static site")
        build(extracted, build_no, VARIANT, translation_map, translation_meta)
        print(f"Done. Output written to {DIST}")


if __name__ == "__main__":
    main()
