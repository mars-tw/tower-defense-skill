#!/usr/bin/env python3
"""Prepare and pack the R62 true-frame enemy animation atlas.

AI-inbetweened chroma-key strips are normalized once into transparent 128 px
walk strips under docs/evidence/R62/walk-strips/.  Runtime uses only the single
packed atlas.  The existing one-frame enemy masters are never overwritten.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ALPHA_INPUT_DIR = ROOT / "tmp" / "imagegen" / "r62"
ATLAS_PATH = ROOT / "assets" / "enemies" / "enemy-animation-atlas.png"
EVIDENCE_DIR = ROOT / "docs" / "evidence" / "R62"
WALK_STRIP_DIR = EVIDENCE_DIR / "walk-strips"
CONTACT_PATH = EVIDENCE_DIR / "enemy-animation-contact.png"
MEASURE_PATH = EVIDENCE_DIR / "enemy-alpha-diff.json"

CELL = 128
COLS = 9
ROWS = 18
DEATH_START = 6
ALPHA_DIFF_THRESHOLD = 0.08

ENEMIES = [
    ("slime", "ground", 4),
    ("goblin", "ground", 4),
    ("orc", "ground", 4),
    ("bat", "flying", 4),
    ("frostwolf", "ground", 4),
    ("imp", "ground", 4),
    ("shieldman", "ground", 4),
    ("medic", "ground", 4),
    ("frostwraith", "flying", 4),
    ("lavagolem", "ground", 4),
    ("emberbat", "flying", 4),
    ("thunderronin", "ground", 4),
    ("abysshound", "ground", 4),
    ("silencer", "ground", 4),
    ("mirrorling", "ground", 4),
    ("warden", "ground", 4),
    ("yaksha", "boss", 6),
    ("boss", "boss", 6),
]


def alpha_difference(left: Image.Image, right: Image.Image) -> float:
    a = np.asarray(left.getchannel("A"), dtype=np.float32) / 255.0
    b = np.asarray(right.getchannel("A"), dtype=np.float32) / 255.0
    return float(np.abs(a - b).mean())


def split_strip(strip: Image.Image, frame_count: int) -> list[Image.Image]:
    if strip.width % frame_count:
        raise ValueError(f"strip width {strip.width} is not divisible by {frame_count}")
    width = strip.width // frame_count
    return [strip.crop((index * width, 0, (index + 1) * width, strip.height)) for index in range(frame_count)]


def trim_frame(frame: Image.Image) -> Image.Image:
    alpha = frame.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 5 else 0).getbbox()
    if not bbox:
        raise ValueError("generated frame has empty alpha")
    return frame.crop(bbox)


def normalize_frames(raw_frames: list[Image.Image], anchor: str, target: int) -> list[Image.Image]:
    trimmed = [trim_frame(frame) for frame in raw_frames]
    max_width = max(frame.width for frame in trimmed)
    max_height = max(frame.height for frame in trimmed)
    width_limit = min(124, target + (6 if anchor in {"flying", "boss"} else 2))
    height_limit = min(124, target)
    scale = min(width_limit / max_width, height_limit / max_height)
    frames: list[Image.Image] = []
    for frame in trimmed:
        size = (max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
        frame = frame.resize(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CELL, CELL))
        x = (CELL - frame.width) // 2
        if anchor == "flying":
            y = (CELL - frame.height) // 2
        else:
            baseline = 123 if anchor == "boss" else 121
            y = baseline - frame.height
        canvas.alpha_composite(frame, (x, max(2, y)))
        frames.append(canvas)
    return frames


def prepare_walk_strip(enemy_id: str, anchor: str, frame_count: int) -> tuple[list[Image.Image], int]:
    source_path = ALPHA_INPUT_DIR / f"{enemy_id}-alpha.png"
    final_path = WALK_STRIP_DIR / f"{enemy_id}-walk.png"
    if source_path.exists():
        source = Image.open(source_path).convert("RGBA")
        raw_frames = split_strip(source, frame_count)
        frames: list[Image.Image] | None = None
        used_target = 0
        for target in (112, 116, 120, 124):
            candidate = normalize_frames(raw_frames, anchor, target)
            minimum = min(alpha_difference(candidate[a], candidate[b]) for a, b in itertools.combinations(range(frame_count), 2))
            if minimum > ALPHA_DIFF_THRESHOLD:
                frames, used_target = candidate, target
                break
        if frames is None:
            raise RuntimeError(f"{enemy_id}: generated poses do not clear alpha diff > {ALPHA_DIFF_THRESHOLD}")
        strip = Image.new("RGBA", (CELL * frame_count, CELL))
        for index, frame in enumerate(frames):
            strip.alpha_composite(frame, (index * CELL, 0))
        strip.save(final_path, optimize=True)
        return frames, used_target

    if not final_path.exists():
        raise FileNotFoundError(f"missing both {source_path} and {final_path}")
    strip = Image.open(final_path).convert("RGBA")
    if strip.size != (CELL * frame_count, CELL):
        raise ValueError(f"unexpected normalized strip size: {final_path} {strip.size}")
    return split_strip(strip, frame_count), 0


def fragment_frame(frame: Image.Image, stage: int, seed: int) -> Image.Image:
    """Create a deterministic 12-piece collapse/crumble death reaction."""
    rng = np.random.default_rng(seed + stage * 1009)
    output = Image.new("RGBA", frame.size)
    x_edges = [0, 32, 64, 96, 128]
    y_edges = [0, 43, 85, 128]
    for row in range(3):
        for col in range(4):
            box = (x_edges[col], y_edges[row], x_edges[col + 1], y_edges[row + 1])
            piece = frame.crop(box)
            if piece.getchannel("A").getbbox() is None:
                continue
            direction = -1 if col < 2 else 1
            spread = (stage + 1) * (2.5 + abs(col - 1.5) * 2.0)
            dx = int(round(direction * spread + rng.uniform(-1.5, 1.5)))
            dy = int(round((stage + 1) * (row * 3.2 + 1.2) + rng.uniform(-1.5, 1.5)))
            angle = float(direction * (stage + 1) * (2.5 + row * 2) + rng.uniform(-1.5, 1.5))
            piece = piece.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
            if stage == 2:
                piece.putalpha(piece.getchannel("A").point(lambda value: round(value * 0.62)))
            px = box[0] + dx - (piece.width - (box[2] - box[0])) // 2
            py = box[1] + dy - (piece.height - (box[3] - box[1])) // 2
            output.alpha_composite(piece, (px, py))
    return output


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
    WALK_STRIP_DIR.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (CELL * COLS, CELL * ROWS))
    metrics: dict[str, dict[str, object]] = {}
    all_frames: dict[str, tuple[list[Image.Image], list[Image.Image]]] = {}

    for row, (enemy_id, anchor, walk_count) in enumerate(ENEMIES):
        walk_frames, target_size = prepare_walk_strip(enemy_id, anchor, walk_count)
        pairs = [
            {"frames": [a, b], "alphaMeanAbsDiff": round(alpha_difference(walk_frames[a], walk_frames[b]), 6)}
            for a, b in itertools.combinations(range(walk_count), 2)
        ]
        minimum = min(float(item["alphaMeanAbsDiff"]) for item in pairs)
        if minimum <= ALPHA_DIFF_THRESHOLD:
            raise RuntimeError(f"{enemy_id}: normalized strip min alpha diff {minimum:.6f}")

        death_frames = [fragment_frame(walk_frames[-1], stage, row * 7919 + 17) for stage in range(3)]
        all_frames[enemy_id] = (walk_frames, death_frames)
        for column, frame in enumerate(walk_frames):
            atlas.alpha_composite(frame, (column * CELL, row * CELL))
        for index, frame in enumerate(death_frames):
            atlas.alpha_composite(frame, ((DEATH_START + index) * CELL, row * CELL))

        metrics[enemy_id] = {
            "row": row,
            "walkFrames": walk_count,
            "deathFrames": 3,
            "normalizationTarget": target_size or "existing",
            "minimumAlphaMeanAbsDiff": minimum,
            "pairs": pairs,
        }

    atlas.save(ATLAS_PATH, optimize=True)

    label_width, preview_cell = 116, 82
    contact = checkerboard((label_width + COLS * preview_cell, ROWS * preview_cell), 8)
    draw = ImageDraw.Draw(contact)
    font = ImageFont.load_default()
    for row, (enemy_id, _anchor, walk_count) in enumerate(ENEMIES):
        draw.text((8, row * preview_cell + 8), enemy_id, fill="#f8fafc", font=font)
        draw.text((8, row * preview_cell + 25), f"walk {walk_count} / death 3", fill="#94a3b8", font=font)
        walk_frames, death_frames = all_frames[enemy_id]
        for index, frame in enumerate(walk_frames):
            thumb = frame.resize((preview_cell, preview_cell), Image.Resampling.LANCZOS)
            contact.alpha_composite(thumb, (label_width + index * preview_cell, row * preview_cell))
        for index, frame in enumerate(death_frames):
            thumb = frame.resize((preview_cell, preview_cell), Image.Resampling.LANCZOS)
            contact.alpha_composite(thumb, (label_width + (DEATH_START + index) * preview_cell, row * preview_cell))
    contact.save(CONTACT_PATH, optimize=True)

    payload = {
        "atlas": str(ATLAS_PATH.relative_to(ROOT)).replace("\\", "/"),
        "cellSize": CELL,
        "columns": COLS,
        "rows": ROWS,
        "thresholdExclusive": ALPHA_DIFF_THRESHOLD,
        "enemies": metrics,
    }
    MEASURE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    minimum = min(float(item["minimumAlphaMeanAbsDiff"]) for item in metrics.values())
    print(f"atlas={ATLAS_PATH.relative_to(ROOT)} {atlas.width}x{atlas.height}")
    print(f"enemies={len(metrics)} minAlphaMeanAbsDiff={minimum:.6f}")
    print(f"walkStrips={WALK_STRIP_DIR.relative_to(ROOT)}")
    print(f"contact={CONTACT_PATH.relative_to(ROOT)}")
    print(f"metrics={MEASURE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
