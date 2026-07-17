# R72 內建 imagegen prompts

執行介面：Codex 內建 imagegen（每張圖一次呼叫）
模型契約：`gpt-image-2`；master 必須保留 C2PA。
參考圖角色：Image 1 `assets/cover.png` 是世界觀／照明參考，禁止複製標題、人物與塔；Image 2 `docs/evidence/R65_polish/map-before-after.png` 是 runtime 色票／路徑材質參考，禁止複製 contact-sheet 文字與版面。

## 共通模板

```text
Use case: stylized-concept
Asset type: landscape map-selection banner and loading-screen background for the existing Endless Tower Defense map <MAP_ID>
Input images: Image 1 is the authoritative dark eastern-fantasy sanctum lighting and material reference only; do not copy its title, characters, goddess, towers, or composition. Image 2 is the authoritative R65 runtime palette and path-material reference only; do not copy labels or contact-sheet layout.
Primary request: create one environmental portrait of the existing map <MAP_NAME>; this is UI art only and must never imply a new map, stage, reward, unlock, tower, or gameplay mechanic
Scene/backdrop: <MAP_SCENE>
Subject: one continuous, unmistakable route band crossing from the left edge to the right edge; terrain identity remains visible around it
Style/medium: dark eastern-fantasy pixel-painted game environment; crisp material clusters; restrained high-frequency detail; consistent with the supplied references
Composition/framing: 3:2 landscape master; all route turns and the primary terrain landmark stay inside the central 80% width and central 46% height so deterministic 2:1 and 16:9 center crops remain safe; no important subject at the outer 10%; readable at 320x160
Lighting/mood: controlled sanctum lighting, strong path-versus-terrain luminance separation, quiet edges, no central bloom over the route
Color palette: <MAP_PALETTE> plus relic brass accents, deep near-black shadows, parchment highlights
Materials/textures: tactile stone, earth, grass, ash, or lava appropriate to the existing map; route surface must have a different value and texture scale from adjacent buildable terrain
Constraints: no text, letters, numbers, UI, badges, logos, watermarks, characters, enemies, heroes, goddess, towers, weapons, locks, stars, level markers, treasure, reward icons, or new structures; do not hide, break, blur, or overpaint the continuous route; no photorealism; no generic mobile-game splash layout
Avoid: illegible path, excessive micro-detail in the central route band, bright bloom on the route, title treatment, map expansion, extra destinations
```

## 三圖變數

- `plains / 翠綠平原`：`ancient emerald grassland with sparse worn stones and low ruined boundary markers; a warm compacted-earth route makes the existing standard winding identity clear`；palette `#102419 #2E7D4F #6C8C4A #7B5732 #D8A34A`。
- `canyon / 迂迴峽谷`：`deep ochre canyon terraces and weathered sandstone shelves; a pale carved-stone route makes the long precise switchback identity clear`；palette `#1D1511 #6A3827 #A65A32 #D0A060 #E7C98A`。
- `lava / 熔岩峽道`：`obsidian ravine with restrained lava seams confined to outer terrain; a cool ash-stone route makes the winding safe corridor identity clear`；palette `#160E12 #3B2024 #7A2925 #C6422C #E0B27A`。

## 後製契約

master 不修改。runtime 僅允許：讀取 master → 固定中心裁切到 2:1／16:9 → Lanczos 重採樣到計畫尺寸 → WebP lossless／固定參數輸出 → sha256。不得 inpaint、合成新物件、重繪、生成式放大或風格轉換。
