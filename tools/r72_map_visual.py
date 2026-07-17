#!/usr/bin/env python3
"""R72 map selection/loading asset governance.

The imagegen masters are immutable inputs. This tool verifies their embedded
C2PA manifests, creates deterministic center crops, and writes hash manifests.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image

try:
    import c2pa
except ImportError as exc:  # pragma: no cover - explicit operator guidance
    raise SystemExit("Missing dependency: py -3 -m pip install c2pa-python") from exc


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence" / "R72"
MASTER_DIR = EVIDENCE / "masters"
C2PA_DIR = EVIDENCE / "c2pa"
RUNTIME_DIR = ROOT / "assets" / "maps" / "r72"

REFERENCES = [
    ROOT / "assets" / "cover.png",
    ROOT / "docs" / "evidence" / "R65_polish" / "map-before-after.png",
]

MAPS = {
    "plains": {
        "label": "翠綠平原",
        "scene": "ancient emerald grassland with sparse worn stones and low ruined boundary markers; a warm compacted-earth route makes the existing standard winding identity clear",
        "palette": "#102419 #2E7D4F #6C8C4A #7B5732 #D8A34A",
    },
    "canyon": {
        "label": "迂迴峽谷",
        "scene": "deep ochre canyon terraces and weathered sandstone shelves; a pale carved-stone route makes the long precise switchback identity clear",
        "palette": "#1D1511 #6A3827 #A65A32 #D0A060 #E7C98A",
    },
    "lava": {
        "label": "熔岩峽道",
        "scene": "obsidian ravine with restrained lava seams confined to outer terrain; a cool ash-stone route makes the winding safe corridor identity clear",
        "palette": "#160E12 #3B2024 #7A2925 #C6422C #E0B27A",
    },
}

OUTPUTS = {
    "banner-high": (640, 320),
    "banner-med": (480, 240),
    "banner-low": (320, 160),
    "loading-high": (1024, 576),
    "loading-med": (768, 432),
    "loading-low": (512, 288),
}


def production_prompt(map_id: str) -> str:
    item = MAPS[map_id]
    lava_rule = "; lava glow must stay off the route and never obscure it" if map_id == "lava" else ""
    terrain = {
        "plains": "tactile grass, worn earth, sparse weathered stone",
        "canyon": "tactile sandstone, worn carved slabs, sparse dry scrub",
        "lava": "tactile obsidian, cool ash stone, restrained magma seams",
    }[map_id]
    return "\n".join([
        "Use case: stylized-concept",
        f"Asset type: landscape map-selection banner and loading-screen background for the existing Endless Tower Defense map {map_id} / {item['label']}",
        "Input images: Image 1 is the authoritative dark eastern-fantasy sanctum lighting and material reference only; do not copy its title, characters, goddess, towers, or composition. Image 2 is the authoritative R65 runtime palette and path-material reference only; do not copy labels or contact-sheet layout.",
        f"Primary request: create one environmental portrait of the existing map {item['label']}; this is UI art only and must never imply a new map, stage, reward, unlock, tower, or gameplay mechanic",
        f"Scene/backdrop: {item['scene']}",
        "Subject: one continuous, unmistakable route band crossing from the left edge to the right edge; terrain identity remains visible around it",
        "Style/medium: dark eastern-fantasy pixel-painted game environment; crisp material clusters; restrained high-frequency detail; consistent with the supplied references",
        f"Composition/framing: 3:2 landscape master; all route turns and the primary {'ravine' if map_id == 'lava' else 'canyon' if map_id == 'canyon' else 'terrain'} landmark stay inside the central 80% width and central 46% height so deterministic 2:1 and 16:9 center crops remain safe; no important subject at the outer 10%; readable at 320x160",
        f"Lighting/mood: controlled {'ember' if map_id == 'lava' else 'sanctum'} lighting, strong path-versus-terrain luminance separation, quiet edges, no central bloom over the route{lava_rule}",
        f"Color palette: {item['palette']} plus relic brass accents and deep near-black shadows",
        f"Materials/textures: {terrain}; route surface must have a different value and texture scale from adjacent buildable terrain",
        "Constraints: no text, letters, numbers, UI, badges, logos, watermarks, characters, enemies, heroes, goddess, towers, weapons, locks, stars, level markers, treasure, reward icons, or new structures; do not hide, break, blur, or overpaint the continuous route; no photorealism; no generic mobile-game splash layout",
        f"Avoid: illegible path, excessive micro-detail in the central route band, bright bloom on the route{', lava crossing or covering the route' if map_id == 'lava' else ''}, title treatment, map expansion, extra destinations",
    ])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def software_agent_from_manifest(data: dict) -> dict | str | None:
    active = data.get("active_manifest")
    manifest = data.get("manifests", {}).get(active, {})
    for assertion in manifest.get("assertions", []):
        if not str(assertion.get("label", "")).startswith("c2pa.actions"):
            continue
        for action in assertion.get("data", {}).get("actions", []):
            if action.get("action") == "c2pa.created" and action.get("softwareAgent"):
                return action["softwareAgent"]
    return None


def is_gpt_image_2(agent: dict | str | None) -> bool:
    if isinstance(agent, dict):
        name = str(agent.get("name", "")).lower()
        version = str(agent.get("version", ""))
        return name == "gpt-image" and bool(re.match(r"^2(?:\.|$)", version))
    return bool(re.search(r"gpt-image\s*2(?:\.|$)", str(agent or ""), re.I))


def verify_c2pa() -> dict:
    C2PA_DIR.mkdir(parents=True, exist_ok=True)
    results = {}
    for map_id in MAPS:
        master = MASTER_DIR / f"{map_id}-master.png"
        if not master.exists():
            raise SystemExit(f"Missing imagegen master: {master.relative_to(ROOT)}")
        with master.open("rb") as stream, c2pa.Reader("image/png", stream) as reader:
            data = json.loads(reader.json())
        (C2PA_DIR / f"{map_id}-manifest.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        active = data.get("active_manifest")
        manifest = data.get("manifests", {}).get(active, {})
        agent = software_agent_from_manifest(data)
        successes = data.get("validation_results", {}).get("activeManifest", {}).get("success", [])
        success_codes = {entry.get("code") for entry in successes}
        summary = {
            "master": str(master.relative_to(ROOT)).replace("\\", "/"),
            "sha256": sha256(master),
            "active_manifest": active,
            "claim_generator_info": manifest.get("claim_generator_info", []),
            "softwareAgent": agent,
            "software_agent_is_gpt_image_2_x": is_gpt_image_2(agent),
            "signature_info": manifest.get("signature_info", {}),
            "validation_state": data.get("validation_state"),
            "claim_signature_validated": "claimSignature.validated" in success_codes,
            "data_hash_valid": "assertion.dataHash.match" in success_codes,
            "validation_status": data.get("validation_status", []),
        }
        if not summary["software_agent_is_gpt_image_2_x"]:
            raise SystemExit(f"C2PA FAIL {map_id}: expected gpt-image 2.x, got {agent!r}")
        if not summary["claim_signature_validated"] or not summary["data_hash_valid"]:
            raise SystemExit(f"C2PA FAIL {map_id}: signature/data hash did not validate")
        results[map_id] = summary
        print(f"PASS C2PA {map_id}: {agent}")
    (C2PA_DIR / "summary.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return results


def center_crop(image: Image.Image, out_width: int, out_height: int) -> Image.Image:
    source_ratio = image.width / image.height
    target_ratio = out_width / out_height
    if source_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        box = (left, 0, left + crop_width, image.height)
    else:
        crop_height = round(image.width / target_ratio)
        top = (image.height - crop_height) // 2
        box = (0, top, image.width, top + crop_height)
    return image.crop(box)


def process_assets(c2pa_summary: dict) -> dict:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    refs = [
        {"path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(path)}
        for path in REFERENCES
    ]
    assets = []
    total_decoded = 0
    for map_id, item in MAPS.items():
        master = MASTER_DIR / f"{map_id}-master.png"
        with Image.open(master) as source:
            source = source.convert("RGB")
            for variant, (width, height) in OUTPUTS.items():
                runtime = RUNTIME_DIR / f"{map_id}-{variant}.webp"
                crop = center_crop(source, width, height)
                resized = crop.resize((width, height), Image.Resampling.LANCZOS)
                resized.save(runtime, format="WEBP", quality=82, method=6)
                decoded = width * height * 4
                total_decoded += decoded
                assets.append({
                    "map_id": map_id,
                    "map_label": item["label"],
                    "variant": variant,
                    "path": str(runtime.relative_to(ROOT)).replace("\\", "/"),
                    "sha256": sha256(runtime),
                    "width": width,
                    "height": height,
                    "decoded_rgba_bytes": decoded,
                    "postprocess": [
                        f"deterministic center crop to {width / height:.6f}:1",
                        f"Pillow Lanczos resize to {width}x{height}",
                        "Pillow WebP quality=82 method=6",
                    ],
                })
    manifest = {
        "schema_version": "td-r72-map-visual.v1",
        "model_slug": "gpt-image-2",
        "generation_interface": "Codex built-in imagegen",
        "generated_date": "2026-07-17",
        "scope": "existing maps only: selection banners and loading backgrounds; never gameplay Canvas",
        "maps": list(MAPS.keys()),
        "references": refs,
        "sources": [
            {
                "map_id": map_id,
                "map_label": MAPS[map_id]["label"],
                "prompt": production_prompt(map_id),
                "master_path": c2pa_summary[map_id]["master"],
                "master_sha256": c2pa_summary[map_id]["sha256"],
                "c2pa_summary": {
                    "softwareAgent": c2pa_summary[map_id]["softwareAgent"],
                    "active_manifest": c2pa_summary[map_id]["active_manifest"],
                    "validation_state": c2pa_summary[map_id]["validation_state"],
                    "claim_signature_validated": c2pa_summary[map_id]["claim_signature_validated"],
                    "data_hash_valid": c2pa_summary[map_id]["data_hash_valid"],
                    "full_report": f"docs/evidence/R72/c2pa/{map_id}-manifest.json",
                },
            }
            for map_id in MAPS
        ],
        "runtime_assets": assets,
        "decoded_rgba_bytes_all_variants": total_decoded,
        "decoded_rgba_mib_all_variants": round(total_decoded / 1024 / 1024, 3),
        "quality_policy": {
            "high": "1024x576 loading + 640x320 banner",
            "med": "768x432 loading + 480x240 banner",
            "low": "512x288 loading + 320x160 banner",
            "invariant": "all tiers are deterministic crops from the same C2PA master; no solid-color substitute",
        },
    }
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (RUNTIME_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (EVIDENCE / "source-manifest.json").write_text(manifest_text, encoding="utf-8")
    (EVIDENCE / "texture-memory.json").write_text(
        json.dumps({
            "formula": "width * height * 4 bytes (decoded RGBA)",
            "desktop_budget_mib": 64,
            "mobile_budget_mib": 32,
            "all_variants_mib": manifest["decoded_rgba_mib_all_variants"],
            "desktop_pass": manifest["decoded_rgba_mib_all_variants"] <= 64,
            "mobile_worst_case_pass": manifest["decoded_rgba_mib_all_variants"] <= 32,
            "assets": assets,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"PASS runtime: {len(assets)} files, {manifest['decoded_rgba_mib_all_variants']:.3f} MiB decoded")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "process", "all"), default="all", nargs="?")
    args = parser.parse_args()
    summary = verify_c2pa()
    if args.command in ("process", "all"):
        process_assets(summary)


if __name__ == "__main__":
    main()
