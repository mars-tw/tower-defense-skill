#!/usr/bin/env python3
"""Build the R63 true-frame hero animation atlas and evidence.

The generated chroma-key sources are normalized once. Runtime loads only one
RGBA atlas and crops fixed 128 px cells. Basic heroes keep four authored
directions; the nine former single-image mythic heroes keep their authored
three-quarter view plus an offline mirrored left-facing row.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
V1_DIR = ROOT / "tmp" / "imagegen" / "r63" / "alpha"
V2_DIR = ROOT / "tmp" / "imagegen" / "r63" / "alpha-v2"
ATLAS_PATH = ROOT / "assets" / "heroes" / "hero-animation-atlas.png"
EVIDENCE_DIR = ROOT / "docs" / "evidence" / "R63"
STRIP_DIR = EVIDENCE_DIR / "hero-strips"
CONTACT_PATH = EVIDENCE_DIR / "hero-animation-contact.png"
MEASURE_PATH = EVIDENCE_DIR / "hero-alpha-diff.json"

CELL = 128
COLS = 7
WALK_COLS = 4
ATTACK_START = 4
ALPHA_DIFF_THRESHOLD = 0.08
DIRECTIONS = ("down", "up", "left", "right")
BASIC = ("knight", "archer", "mage", "iceMage", "valkyrie", "cleric")
MYTHIC = ("daji", "guanyu", "wukong", "nezha", "leizhenzi", "niumowang", "baisuzhen", "erlangshen", "zhongkui")

# Each basic direction uses the two most distinct authored walk contacts.  The
# selection was measured after normalization; tuples are (source version, col).
BASIC_WALK_SELECTIONS = {
    "knight": {
        "down": (("v1", 1), ("v2", 3)), "up": (("v1", 1), ("v2", 3)),
        "left": (("v1", 0), ("v1", 1)), "right": (("v1", 1), ("v2", 1)),
    },
    "archer": {
        "down": (("v1", 3), ("v2", 0)), "up": (("v1", 1), ("v1", 3)),
        "left": (("v1", 0), ("v1", 3)), "right": (("v1", 0), ("v1", 3)),
    },
    "mage": {
        "down": (("v2", 0), ("v2", 1)), "up": (("v1", 3), ("v2", 2)),
        "left": (("v2", 1), ("v2", 3)), "right": (("v2", 1), ("v2", 3)),
    },
    "iceMage": {
        "down": (("v2", 1), ("v2", 3)), "up": (("v2", 0), ("v2", 3)),
        "left": (("v1", 1), ("v1", 3)), "right": (("v2", 1), ("v2", 3)),
    },
    "valkyrie": {
        "down": (("v1", 1), ("v1", 3)), "up": (("v1", 0), ("v1", 3)),
        "left": (("v1", 0), ("v1", 2)), "right": (("v1", 0), ("v1", 2)),
    },
    "cleric": {
        "down": (("v1", 1), ("v2", 2)), "up": (("v1", 3), ("v2", 1)),
        "left": (("v1", 0), ("v2", 2)), "right": (("v1", 0), ("v1", 1)),
    },
}


def alpha_difference(left: Image.Image, right: Image.Image) -> float:
    a = np.asarray(left.getchannel("A"), dtype=np.float32) / 255.0
    b = np.asarray(right.getchannel("A"), dtype=np.float32) / 255.0
    return float(np.abs(a - b).mean())


def source(version: str, hero_id: str) -> Image.Image:
    folder = V2_DIR if version == "v2" else V1_DIR
    path = folder / f"{hero_id}.png"
    if not path.exists():
        raise FileNotFoundError(path)
    return Image.open(path).convert("RGBA")


def split_cell(sheet: Image.Image, column: int, row: int, rows: int) -> Image.Image:
    x0, x1 = round(column * sheet.width / COLS), round((column + 1) * sheet.width / COLS)
    y0, y1 = round(row * sheet.height / rows), round((row + 1) * sheet.height / rows)
    return sheet.crop((x0, y0, x1, y1))


def normalize(frame: Image.Image) -> Image.Image:
    alpha = frame.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        raise ValueError("empty generated hero frame")
    frame = frame.crop(bbox)
    scale = min(124 / frame.width, 124 / frame.height)
    size = (max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
    frame = frame.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CELL, CELL))
    canvas.alpha_composite(frame, ((CELL - frame.width) // 2, 124 - frame.height))
    return canvas


def articulate_cleric_up(frame: Image.Image) -> Image.Image:
    """Move separated lower robe/leg groups, never the physics or whole sprite."""
    output = frame.copy()
    transparent = Image.new("RGBA", output.size)
    for box, dx in (((18, 80, 59, 128), -8), ((69, 80, 111, 128), 8)):
        part = output.crop(box)
        output.paste(transparent.crop(box), box)
        output.alpha_composite(part, (box[0] + dx, box[1]))
    return output


def basic_frames(hero_id: str, direction: str, row: int) -> list[Image.Image]:
    frames = []
    for index, (version, column) in enumerate(BASIC_WALK_SELECTIONS[hero_id][direction]):
        frame = normalize(split_cell(source(version, hero_id), column, row, 4))
        if hero_id == "cleric" and direction == "up" and index == 1:
            frame = articulate_cleric_up(frame)
        frames.append(frame)
    # Attack poses remain the authored anticipation / impact / recovery cells.
    v1 = source("v1", hero_id)
    attacks = [normalize(split_cell(v1, column, row, 4)) for column in range(ATTACK_START, COLS)]
    return frames + [Image.new("RGBA", (CELL, CELL)), Image.new("RGBA", (CELL, CELL))] + attacks


def mythic_frames(hero_id: str, flipped: bool) -> list[Image.Image]:
    sheet = source("v1", hero_id)
    frames = [normalize(split_cell(sheet, column, 0, 1)) for column in range(COLS)]
    if flipped:
        frames = [frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for frame in frames]
    return frames


def generated_sources_available(hero_id: str) -> bool:
    """Return whether the disposable ImageGen source sheets are still present."""
    required = {V1_DIR / f"{hero_id}.png"}
    if hero_id in BASIC:
        for selections in BASIC_WALK_SELECTIONS[hero_id].values():
            for version, _column in selections:
                folder = V2_DIR if version == "v2" else V1_DIR
                required.add(folder / f"{hero_id}.png")
    return all(path.exists() for path in required)


def cached_strip_rows(hero_id: str, row_count: int) -> list[list[Image.Image]]:
    """Load committed normalized frames when disposable generation sources are gone."""
    path = STRIP_DIR / f"{hero_id}.png"
    if not path.exists():
        raise FileNotFoundError(
            f"missing both ImageGen source sheets and normalized strip: {path}"
        )
    strip = Image.open(path).convert("RGBA")
    expected = (COLS * CELL, row_count * CELL)
    if strip.size != expected:
        raise ValueError(f"{path}: expected {expected}, got {strip.size}")
    return [
        [
            strip.crop((column * CELL, row * CELL, (column + 1) * CELL, (row + 1) * CELL))
            for column in range(COLS)
        ]
        for row in range(row_count)
    ]


def checkerboard(size: tuple[int, int], tile: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, "#202733")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#2c3745")
    return image


def main() -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    STRIP_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, str, list[Image.Image], int]] = []
    animation_rows: dict[str, dict[str, int]] = {}

    for hero_id in BASIC:
        animation_rows[hero_id] = {}
        hero_strip = Image.new("RGBA", (COLS * CELL, 4 * CELL))
        cached = None if generated_sources_available(hero_id) else cached_strip_rows(hero_id, 4)
        for direction_index, direction in enumerate(DIRECTIONS):
            frames = (
                basic_frames(hero_id, direction, direction_index)
                if cached is None else cached[direction_index]
            )
            animation_rows[hero_id][direction] = len(rows)
            rows.append((hero_id, direction, frames, 2))
            for column, frame in enumerate(frames):
                hero_strip.alpha_composite(frame, (column * CELL, direction_index * CELL))
        hero_strip.save(STRIP_DIR / f"{hero_id}.png", optimize=True)

    for hero_id in MYTHIC:
        animation_rows[hero_id] = {}
        if generated_sources_available(hero_id):
            normal = mythic_frames(hero_id, False)
            left = mythic_frames(hero_id, True)
        else:
            normal, left = cached_strip_rows(hero_id, 2)
        normal_row = len(rows)
        rows.append((hero_id, "default", normal, WALK_COLS))
        left_row = len(rows)
        rows.append((hero_id, "left", left, WALK_COLS))
        animation_rows[hero_id].update({"down": normal_row, "up": normal_row, "right": normal_row, "left": left_row})
        hero_strip = Image.new("RGBA", (COLS * CELL, 2 * CELL))
        for column, frame in enumerate(normal):
            hero_strip.alpha_composite(frame, (column * CELL, 0))
        for column, frame in enumerate(left):
            hero_strip.alpha_composite(frame, (column * CELL, CELL))
        hero_strip.save(STRIP_DIR / f"{hero_id}.png", optimize=True)

    atlas = Image.new("RGBA", (COLS * CELL, len(rows) * CELL))
    metrics: dict[str, object] = {}
    global_min = 1.0
    for row_index, (hero_id, direction, frames, walk_count) in enumerate(rows):
        for column, frame in enumerate(frames):
            atlas.alpha_composite(frame, (column * CELL, row_index * CELL))
        pairs = [
            {"frames": [a, b], "alphaMeanAbsDiff": round(alpha_difference(frames[a], frames[b]), 6)}
            for a, b in itertools.combinations(range(walk_count), 2)
        ]
        minimum = min(float(item["alphaMeanAbsDiff"]) for item in pairs)
        if minimum <= ALPHA_DIFF_THRESHOLD:
            raise RuntimeError(f"{hero_id}/{direction}: walk alpha diff {minimum:.6f} <= {ALPHA_DIFF_THRESHOLD}")
        attack_diffs = [alpha_difference(frames[4], frames[5]), alpha_difference(frames[5], frames[6])]
        if min(attack_diffs) <= 0.01:
            raise RuntimeError(f"{hero_id}/{direction}: attack phases are not distinct")
        global_min = min(global_min, minimum)
        metrics[f"{hero_id}:{direction}"] = {
            "row": row_index, "walkFrames": walk_count,
            "minimumAlphaMeanAbsDiff": minimum, "pairs": pairs,
            "attackPhaseDiffs": [round(value, 6) for value in attack_diffs],
        }

    atlas.save(ATLAS_PATH, optimize=True)

    preview_cell, label_width = 88, 150
    contact = checkerboard((label_width + COLS * preview_cell, len(rows) * preview_cell))
    draw = ImageDraw.Draw(contact)
    font = ImageFont.load_default()
    for row_index, (hero_id, direction, frames, walk_count) in enumerate(rows):
        y = row_index * preview_cell
        draw.text((8, y + 9), hero_id, fill="#f8fafc", font=font)
        draw.text((8, y + 27), f"{direction} walk {walk_count} / atk 3", fill="#94a3b8", font=font)
        for column, frame in enumerate(frames):
            thumb = frame.resize((preview_cell, preview_cell), Image.Resampling.LANCZOS)
            contact.alpha_composite(thumb, (label_width + column * preview_cell, y))
    contact.save(CONTACT_PATH, optimize=True)

    payload = {
        "atlas": str(ATLAS_PATH.relative_to(ROOT)).replace("\\", "/"),
        "cellSize": CELL, "columns": COLS, "rows": len(rows),
        "walkColumns": WALK_COLS, "attackStart": ATTACK_START,
        "thresholdExclusive": ALPHA_DIFF_THRESHOLD,
        "animationRows": animation_rows, "animations": metrics,
    }
    MEASURE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"atlas={ATLAS_PATH.relative_to(ROOT)} {atlas.width}x{atlas.height}")
    print(f"heroes={len(BASIC) + len(MYTHIC)} rows={len(rows)} minAlphaMeanAbsDiff={global_min:.6f}")
    print(f"contact={CONTACT_PATH.relative_to(ROOT)}")
    print(f"metrics={MEASURE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
