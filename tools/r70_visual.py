#!/usr/bin/env python3
"""td R70 Wave 1 visual production and verification pipeline.

Generation intentionally stays in the approved built-in image_gen surface.
This script prepares atlas references, converts generated chroma-key masters to
decontaminated RGBA, applies the R65 palette/1px outline cleanup, cuts tower
contact sheets with a shared scale, runs the Wave 0 alpha gate, and emits the
traceable R70 asset manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence" / "R70_art"
SOURCES = EVIDENCE / "generated_sources"
REFERENCES = EVIDENCE / "references"
PILOT_TOOLS = ROOT.parent / "VISUAL_REFRESH_PILOT" / "tools_visual"

HEROES = {
    "knight": (0, "聖騎士", "blue and silver plate armor, blond hair, sword and shield"),
    "archer": (4, "遊俠", "green ranger leathers, brown hair, longbow and quiver"),
    "mage": (8, "大法師", "red-orange fire robes, hood, flame staff"),
    "iceMage": (12, "冰霜法師", "blue-white frost robes, silver hair, ice staff"),
    "valkyrie": (16, "女武神", "gold winged armor, white hair, lightning spear"),
    "cleric": (20, "牧師", "white-gold holy robes, hood and cross staff"),
    "daji": (24, "妲己", "red fox-spirit robes, nine-tail silhouette and fire orb"),
    "guanyu": (26, "魔關羽", "dark green-red armor, long beard and crescent blade"),
    "wukong": (28, "孫悟空", "monkey king armor, golden staff and thunder ribbons"),
    "nezha": (30, "哪吒", "youthful flame-wheel hero, red ribbons and spear"),
    "leizhenzi": (32, "雷震子", "purple-gold storm armor, feathered wings and lightning bow"),
    "niumowang": (34, "牛魔王", "horned black-red heavy armor and massive axe"),
    "baisuzhen": (36, "白素貞", "pale blue-white serpent spirit robes and frost magic"),
    "erlangshen": (38, "二郎神", "three-eyed celestial warrior, dark gold armor and spear"),
    "zhongkui": (40, "鍾馗", "demon-quelling judge, dark red robes, talismans and sword"),
}

TOWERS = {
    "arrow": "crossbow archer tower",
    "cannon": "heavy iron cannon tower",
    "frost": "blue ice-crystal tower",
    "tesla": "golden lightning coil tower",
    "poison": "green alchemical poison tower",
    "support": "golden holy support tower",
    "beacon": "crimson spirit-lantern beacon tower",
    "sniper": "long-range precision ballista tower",
    "arcane": "violet arcane crystal obelisk tower",
    "mortar": "short-barrel bronze mortar tower",
}

R65_PALETTE = [
    "07120d", "0d1b16", "14231e", "172a1e", "204229", "2f6f38", "5d8d45", "9db66a",
    "2b1d25", "3d2b24", "61412d", "896040", "b9824e", "ddb472", "1f2433", "30364a",
    "46556e", "64748b", "94a3b8", "cbd5e1", "f1f5f9", "5b3627", "8a5434", "c0844d",
    "f0b36a", "2b314a", "1e5b78", "38bdf8", "7dd3fc", "d9fafe", "3b255e", "7c3aed",
    "a855f7", "e9d5ff", "3b2612", "a16207", "facc15", "fde68a", "fff7ad", "431407",
    "b45309", "f97316", "fb923c", "fed7aa", "3a1023", "9f1239", "fb7185", "fecdd3",
    "11402d", "16a34a", "22c55e", "86efac", "111827", "182033", "241703", "2a2130",
]
PALETTE_RGB = np.array(
    [[int(value[index:index + 2], 16) for index in (0, 2, 4)] for value in R65_PALETTE],
    dtype=np.int16,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def matte_for(kind: str, asset_id: str) -> str:
    if kind == "portrait" and asset_id == "archer":
        return "#ff00ff"
    if kind == "tower" and asset_id == "poison":
        return "#ff00ff"
    return "#00ff00"


def portrait_prompt(asset_id: str) -> str:
    _, label, identity = HEROES[asset_id]
    matte = matte_for("portrait", asset_id)
    return f"""Use case: stylized-concept
Asset type: 1024x1024 game UI portrait cutout for Endless Tower Defense
Input images: Image 1 is the authoritative idle-atlas identity reference for {label} ({asset_id})
Primary request: create a polished waist-up portrait of the exact referenced hero; preserve the atlas identity, costume, colors, face, weapon and elemental motif
Subject: {identity}; heroic three-quarter pose with face and primary identity symbol unobstructed
Style/medium: Eastern dark fantasy pixel-painted game art matching the supplied atlas; limited R65 palette; crisp clusters and a dark 1px native outline after downsampling
Composition/framing: centered square bust, subject inside the central 82%, generous clear padding, readable at 34px
Scene/backdrop: perfectly flat solid {matte} chroma-key background for local removal
Constraints: uniform background with no shadow, gradient, texture, reflection or floor; no text, badge, frame, watermark or emoji; no photorealism, soft painting or vector edge; do not use the matte color in the subject"""


def tower_prompt(asset_id: str) -> str:
    label = TOWERS[asset_id]
    matte = matte_for("tower", asset_id)
    return f"""Use case: stylized-concept
Asset type: three-tier tower progression contact sheet for Endless Tower Defense
Input images: Image 1 is the authoritative R61 {asset_id} tower identity reference; Image 2 is the authoritative R65 limited-palette reference
Primary request: show the same {label} in exactly three equal columns from left to right for Lv1-3, Lv4-6 and Lv7+; no labels or text
Subject: left tier is shortest and restrained; middle tier is visibly taller with an enlarged barrel or core plus one banner; right tier is tallest with the largest barrel or core plus twin banners or a crown; preserve tower identity while making all three silhouettes clearly different
Style/medium: Eastern dark fantasy pixel art tower defense, three-quarter orthographic view, mythic Chinese silhouette, limited R65 palette, crisp 1px native outline after downsampling
Composition/framing: 1536x1024 landscape contact sheet, three equal isolated columns, same camera, base alignment and common scale, generous padding, no overlap
Scene/backdrop: perfectly flat solid {matte} chroma-key background for local removal
Constraints: readable at a 36px cell from silhouette alone; progression must rely on height, barrel, core and banners, never LV text; no text, numbers, emoji, watermark, photorealism, soft painting, cast shadow, floor, gradient or texture; do not use the matte color in the subject"""


def load_pilot_module(name: str):
    path = PILOT_TOOLS / f"{name}.py"
    if not path.is_file():
        raise FileNotFoundError(f"Wave 0 calibration module missing: {path}")
    if str(PILOT_TOOLS) not in sys.path:
        sys.path.insert(0, str(PILOT_TOOLS))
    spec = importlib.util.spec_from_file_location(f"r70_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare_references() -> None:
    atlas_path = ROOT / "assets" / "heroes" / "hero-animation-atlas.png"
    with Image.open(atlas_path) as opened:
        atlas = opened.convert("RGBA")
    hero_dir = REFERENCES / "heroes"
    hero_dir.mkdir(parents=True, exist_ok=True)
    for asset_id, (row, _, _) in HEROES.items():
        frame = atlas.crop((0, row * 128, 128, row * 128 + 128))
        frame.resize((1024, 1024), Image.Resampling.NEAREST).save(hero_dir / f"{asset_id}-idle.png", optimize=True)
    tower_dir = REFERENCES / "towers"
    tower_dir.mkdir(parents=True, exist_ok=True)
    for asset_id in TOWERS:
        with Image.open(ROOT / "assets" / "towers" / f"{asset_id}.png") as opened:
            ref = opened.convert("RGBA")
        ref.resize((1024, 1024), Image.Resampling.NEAREST).save(tower_dir / f"{asset_id}-r61.png", optimize=True)
    shutil.copy2(ROOT / "docs" / "evidence" / "R65_polish" / "palette-strip.png", REFERENCES / "r65-palette-strip.png")


def normalize_rgb_source(path: Path, target: tuple[int, int], matte: str) -> Image.Image:
    key = tuple(int(matte[index:index + 2], 16) for index in (1, 3, 5))
    with Image.open(path) as opened:
        image = opened.convert("RGB")
    contained = ImageOps.contain(image, target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", target, key)
    canvas.paste(contained, ((target[0] - contained.width) // 2, (target[1] - contained.height) // 2))
    return canvas


def extract_rgba(image: Image.Image, matte: str) -> tuple[Image.Image, Image.Image, str]:
    pipeline = load_pilot_module("matte_pipeline")
    fallback = pipeline.parse_hex_color(matte)
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    estimated = pipeline.border_key(rgb, fallback)
    mask, _, final = pipeline.extract_cutout(rgb, estimated, 12.0, 220.0)
    return Image.fromarray(mask, "L"), Image.fromarray(final, "RGBA"), "#" + "".join(f"{int(round(v)):02x}" for v in estimated)


def nearest_palette(rgb: np.ndarray) -> np.ndarray:
    flat = rgb.reshape(-1, 3).astype(np.int32)
    palette = PALETTE_RGB.astype(np.int32)
    output = np.empty_like(flat, dtype=np.uint8)
    chunk = 32768
    for start in range(0, len(flat), chunk):
        part = flat[start:start + chunk]
        distance = np.sum((part[:, None, :] - palette[None, :, :]) ** 2, axis=2)
        output[start:start + len(part)] = PALETTE_RGB[np.argmin(distance, axis=1)].astype(np.uint8)
    return output.reshape(rgb.shape)


def cleanup_runtime(source: Image.Image, size: int = 128, common_scale: float | None = None) -> Image.Image:
    rgba = source.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("empty alpha subject")
    subject = rgba.crop(bbox)
    if common_scale is None:
        scale = min((size - 12) / subject.width, (size - 12) / subject.height)
    else:
        scale = common_scale
    target = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    array = np.asarray(subject, dtype=np.uint8).copy()
    visible = array[..., 3] > 0
    if np.any(visible):
        array[..., :3][visible] = nearest_palette(array[..., :3])[visible]
    array[..., :3][~visible] = 0
    subject = Image.fromarray(array, "RGBA")
    alpha = subject.getchannel("A")
    expanded = alpha.filter(ImageFilter.MaxFilter(3))
    outline = ImageChops.subtract(expanded, alpha)
    outlined = Image.new("RGBA", subject.size, (17, 24, 39, 0))
    outlined.putalpha(outline)
    outlined.alpha_composite(subject)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - outlined.width) // 2
    y = size - 5 - outlined.height
    canvas.alpha_composite(outlined, (x, y))
    data = np.asarray(canvas, dtype=np.uint8).copy()
    data[..., :3][data[..., 3] == 0] = 0
    return Image.fromarray(data, "RGBA")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def process_portraits(records: list[dict[str, Any]]) -> None:
    for asset_id in HEROES:
        source_path = SOURCES / "portraits" / f"{asset_id}.png"
        matte = matte_for("portrait", asset_id)
        source = normalize_rgb_source(source_path, (1024, 1024), matte)
        mask, rgba, estimated = extract_rgba(source, matte)
        master = EVIDENCE / "masters_opaque" / "portraits" / f"{asset_id}.png"
        mask_path = EVIDENCE / "masks" / "portraits" / f"{asset_id}.png"
        rgba_path = EVIDENCE / "rgba_master" / "portraits" / f"{asset_id}.png"
        runtime_path = ROOT / "assets" / "heroes" / "portraits" / f"{asset_id}.png"
        save_png(source, master)
        save_png(mask, mask_path)
        save_png(rgba, rgba_path)
        save_png(cleanup_runtime(rgba), runtime_path)
        records.append(asset_record("portrait", asset_id, matte, estimated, source_path, master, mask_path, rgba_path, runtime_path, portrait_prompt(asset_id)))


def split_three(image: Image.Image) -> list[Image.Image]:
    widths = [round(image.width * index / 3) for index in range(4)]
    return [image.crop((widths[index], 0, widths[index + 1], image.height)) for index in range(3)]


def process_towers(records: list[dict[str, Any]]) -> None:
    for asset_id in TOWERS:
        source_path = SOURCES / "tower_contact_sheets" / f"{asset_id}.png"
        matte = matte_for("tower", asset_id)
        with Image.open(source_path) as opened:
            raw = opened.convert("RGB")
        target = (1536, 1024)
        source = normalize_rgb_source(source_path, target, matte)
        contact_master = EVIDENCE / "contact_sheets" / f"{asset_id}-opaque.png"
        save_png(source, contact_master)
        panels = split_three(source)
        extracted: list[tuple[Image.Image, Image.Image, str]] = [extract_rgba(panel, matte) for panel in panels]
        bboxes = [item[1].getchannel("A").getbbox() for item in extracted]
        if any(bbox is None for bbox in bboxes):
            raise ValueError(f"{asset_id}: contact sheet contains an empty tier")
        max_width = max(int(bbox[2] - bbox[0]) for bbox in bboxes if bbox)
        max_height = max(int(bbox[3] - bbox[1]) for bbox in bboxes if bbox)
        common_scale = min(116 / max_width, 116 / max_height)
        for tier, ((mask, rgba, estimated), panel) in enumerate(zip(extracted, panels), 1):
            key = f"{asset_id}-tier{tier}"
            master = EVIDENCE / "masters_opaque" / "towers" / f"{key}.png"
            mask_path = EVIDENCE / "masks" / "towers" / f"{key}.png"
            rgba_path = EVIDENCE / "rgba_master" / "towers" / f"{key}.png"
            runtime_path = ROOT / "assets" / "towers" / "tiers" / f"{key}.png"
            save_png(panel, master)
            save_png(mask, mask_path)
            save_png(rgba, rgba_path)
            save_png(cleanup_runtime(rgba, common_scale=common_scale), runtime_path)
            records.append(asset_record("tower_tier", key, matte, estimated, source_path, master, mask_path, rgba_path, runtime_path, tower_prompt(asset_id), contact_master))


def asset_record(kind: str, asset_id: str, matte: str, estimated: str, generated: Path,
                 master: Path, mask: Path, rgba: Path, runtime: Path, prompt: str,
                 contact_sheet: Path | None = None) -> dict[str, Any]:
    paths = {"generated_source": generated, "opaque_master": master, "mask": mask, "rgba_master": rgba, "runtime": runtime}
    if contact_sheet:
        paths["contact_sheet"] = contact_sheet
    return {
        "kind": kind,
        "slug": asset_id,
        "prompt": prompt,
        "requested_matte": matte,
        "estimated_matte": estimated,
        "references": reference_records(kind, asset_id),
        "artifacts": {
            name: {"path": path.relative_to(ROOT).as_posix(), "sha256": sha256(path)}
            for name, path in paths.items()
        },
    }


def reference_records(kind: str, asset_id: str) -> list[dict[str, str]]:
    base_id = asset_id.split("-tier", 1)[0]
    if kind == "portrait":
        paths = [REFERENCES / "heroes" / f"{base_id}-idle.png"]
    else:
        paths = [REFERENCES / "towers" / f"{base_id}-r61.png", REFERENCES / "r65-palette-strip.png"]
    return [{"path": path.relative_to(ROOT).as_posix(), "sha256": sha256(path)} for path in paths]


def alpha_gate(records: list[dict[str, Any]]) -> dict[str, Any]:
    gate = load_pilot_module("alpha_gate")
    gate_dir = EVIDENCE / "gates"
    gate_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for record in records:
        runtime = ROOT / record["artifacts"]["runtime"]["path"]
        result = gate.gate_image(runtime, "cutout", (128, 128), record["requested_matte"])
        (gate_dir / f"{record['slug']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        results.append(result)
    summary = {"checked": len(results), "passed": sum(1 for item in results if item["pass"]), "failed": [item["path"] for item in results if not item["pass"]]}
    (gate_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def alpha_bbox(path: Path) -> tuple[int, int, int, int]:
    with Image.open(path) as opened:
        bbox = opened.convert("RGBA").getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"empty alpha: {path}")
    return bbox


def silhouette_gate(records: list[dict[str, Any]]) -> dict[str, Any]:
    towers: dict[str, list[Path]] = {asset_id: [] for asset_id in TOWERS}
    for record in records:
        if record["kind"] != "tower_tier":
            continue
        asset_id = record["slug"].split("-tier", 1)[0]
        towers[asset_id].append(ROOT / record["artifacts"]["runtime"]["path"])
    details = []
    for asset_id, paths in towers.items():
        paths.sort()
        bboxes = [alpha_bbox(path) for path in paths]
        heights = [bbox[3] - bbox[1] for bbox in bboxes]
        widths = [bbox[2] - bbox[0] for bbox in bboxes]
        areas = [width * height for width, height in zip(widths, heights)]
        alpha_masks = []
        for path in paths:
            with Image.open(path) as opened:
                alpha_masks.append(np.asarray(opened.convert("RGBA").getchannel("A"), dtype=np.float32) / 255.0)
        adjacent_diffs = [round(float(np.mean(np.abs(alpha_masks[index + 1] - alpha_masks[index]))), 6) for index in range(2)]
        height_progression = heights[0] < heights[1] < heights[2]
        area_progression = areas[1] > areas[0] and areas[2] >= areas[1] * 0.85
        distinct_masks = all(value >= 0.03 for value in adjacent_diffs)
        passed = height_progression and area_progression and distinct_masks
        details.append({"tower": asset_id, "pass": passed, "heights": heights, "widths": widths, "bbox_areas": areas,
                        "adjacent_alpha_mask_diff": adjacent_diffs,
                        "requirements": "strictly increasing height; tier2 area > tier1; tier3 area >= 85% of tier2; adjacent alpha-mask diff >= 0.03"})
    payload = {"pass": all(item["pass"] for item in details), "towers": details}
    (EVIDENCE / "gates" / "tower-silhouette.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def checkerboard(size: tuple[int, int], cell: int = 8) -> Image.Image:
    yy, xx = np.indices((size[1], size[0]))
    values = np.where(((xx // cell) + (yy // cell)) % 2 == 0, 38, 57).astype(np.uint8)
    return Image.fromarray(np.repeat(values[..., None], 3, axis=2), "RGB")


def make_contact_sheet() -> None:
    cell = 128
    preview = 36
    label = 110
    row_height = cell + 18
    sheet = Image.new("RGB", (label + cell * 3 + preview * 3 + 32, row_height * len(TOWERS) + 32), (9, 15, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((label + 8, 8), "TIER 1", fill=(241, 245, 249))
    draw.text((label + cell + 8, 8), "TIER 2", fill=(241, 245, 249))
    draw.text((label + cell * 2 + 8, 8), "TIER 3", fill=(241, 245, 249))
    for row, asset_id in enumerate(TOWERS):
        y = 30 + row * row_height
        draw.text((8, y + 52), asset_id, fill=(221, 180, 114))
        for tier in range(1, 4):
            path = ROOT / "assets" / "towers" / "tiers" / f"{asset_id}-tier{tier}.png"
            with Image.open(path) as opened:
                art = opened.convert("RGBA")
            bg = checkerboard((cell, cell))
            bg.paste(art, (0, 0), art)
            sheet.paste(bg, (label + (tier - 1) * cell, y))
            tiny = art.resize((preview, preview), Image.Resampling.NEAREST)
            tiny_bg = checkerboard((preview, preview), 4)
            tiny_bg.paste(tiny, (0, 0), tiny)
            sheet.paste(tiny_bg, (label + cell * 3 + 8 + (tier - 1) * preview, y + 46))
    save_png(sheet, EVIDENCE / "tower-tier-contact-sheet.png")


def make_portrait_contact_sheet() -> None:
    cell = 128
    label_height = 24
    columns = 5
    rows = 3
    sheet = Image.new("RGB", (cell * columns, (cell + label_height) * rows), (9, 15, 20))
    draw = ImageDraw.Draw(sheet)
    for index, asset_id in enumerate(HEROES):
        column = index % columns
        row = index // columns
        x = column * cell
        y = row * (cell + label_height)
        path = ROOT / "assets" / "heroes" / "portraits" / f"{asset_id}.png"
        with Image.open(path) as opened:
            art = opened.convert("RGBA")
        bg = checkerboard((cell, cell))
        bg.paste(art, (0, 0), art)
        sheet.paste(bg, (x, y))
        draw.text((x + 6, y + cell + 6), asset_id, fill=(221, 180, 114))
    save_png(sheet, EVIDENCE / "hero-portrait-contact-sheet.png")


def make_before_after() -> None:
    portraits = ["knight", "archer", "leizhenzi"]
    towers = ["arrow", "frost", "mortar"]
    panel = 128
    sheet = Image.new("RGB", (panel * 6, panel * 2 + 36), (9, 15, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 10), "BEFORE: runtime sprite / single tower", fill=(241, 245, 249))
    draw.text((panel * 3 + 8, 10), "AFTER: R70 UI portrait / tier progression", fill=(241, 245, 249))
    for index, asset_id in enumerate(portraits):
        before = REFERENCES / "heroes" / f"{asset_id}-idle.png"
        after = ROOT / "assets" / "heroes" / "portraits" / f"{asset_id}.png"
        for column, path in ((index, before), (index + 3, after)):
            with Image.open(path) as opened:
                art = ImageOps.contain(opened.convert("RGBA"), (panel, panel), Image.Resampling.NEAREST)
            bg = checkerboard((panel, panel))
            bg.paste(art, ((panel - art.width) // 2, (panel - art.height) // 2), art)
            sheet.paste(bg, (column * panel, 36))
    for index, asset_id in enumerate(towers):
        before = ROOT / "assets" / "towers" / f"{asset_id}.png"
        after = ROOT / "assets" / "towers" / "tiers" / f"{asset_id}-tier3.png"
        for column, path in ((index, before), (index + 3, after)):
            with Image.open(path) as opened:
                art = ImageOps.contain(opened.convert("RGBA"), (panel, panel), Image.Resampling.NEAREST)
            bg = checkerboard((panel, panel))
            bg.paste(art, ((panel - art.width) // 2, (panel - art.height) // 2), art)
            sheet.paste(bg, (column * panel, panel + 36))
    save_png(sheet, EVIDENCE / "before-after.png")


def process_all() -> int:
    records: list[dict[str, Any]] = []
    process_portraits(records)
    process_towers(records)
    gate_summary = alpha_gate(records)
    silhouettes = silhouette_gate(records)
    make_contact_sheet()
    make_portrait_contact_sheet()
    make_before_after()
    manifest = {
        "schema_version": "td-r70-wave1-art.v1",
        "model_slug": "gpt-image-2",
        "interface": "built-in image_gen",
        "prompt_version": "td-r70-wave1-v1.0",
        "calibration_pipeline": "VISUAL_REFRESH_PILOT/tools_visual",
        "assets": records,
        "alpha_gate": gate_summary,
        "silhouette_gate": {"pass": silhouettes["pass"], "path": "docs/evidence/R70_art/gates/tower-silhouette.json"},
    }
    manifest_path = EVIDENCE / "asset-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    runtime_manifest = ROOT / "assets" / "art-manifest-r70.json"
    runtime_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if gate_summary["failed"] == [] and silhouettes["pass"] else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    prompt = sub.add_parser("prompt")
    prompt.add_argument("kind", choices=("portrait", "tower"))
    prompt.add_argument("asset_id")
    sub.add_parser("process")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare_references()
        return 0
    if args.command == "prompt":
        print(portrait_prompt(args.asset_id) if args.kind == "portrait" else tower_prompt(args.asset_id))
        return 0
    return process_all()


if __name__ == "__main__":
    raise SystemExit(main())
