---
name: generate-image
description: >
  Generate marketing images for luno via Replicate API (FLUX Schnell + Real-ESRGAN upscale).
  Use when creating social media assets, blog images, or marketing visuals.
  Usage: "/generate-image [prompt or description]"
---

# Generate Image — luno Marketing Assets

Generate images for luno marketing content via Replicate API.

**Input:** $ARGUMENTS

## Image Formats

| Platform        | Format       | Resolution  |
| --------------- | ------------ | ----------- |
| Instagram Feed  | 4:5 Portrait | 1080x1350px |
| Instagram Story | 9:16         | 1080x1920px |
| LinkedIn Feed   | ~1.91:1      | 1200x627px  |
| Carousels       | 4:5 Portrait | 1080x1350px |

**NEVER use square (1:1) for Instagram** — default is 4:5 Portrait.

## File Naming & Storage

Finals: `L-{NNN}-{slug}.png` — NNN = post number from Teable content log

Sources (raw files, iterations): `L-{NNN}-{slug}-{variant}.png`

Store all images in the group folder under `generated/`.

## API Authentication

Token is available as environment variable:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions" \
  -d '...'
```

## Models

| Model        | Purpose                              | Replicate ID                     |
| ------------ | ------------------------------------ | -------------------------------- |
| FLUX Schnell | Image generation (fast, good)        | `black-forest-labs/flux-schnell` |
| FLUX Dev     | Image generation (slower, higher quality) | `black-forest-labs/flux-dev` |
| Real-ESRGAN  | Upscaling (2x or 4x)                | `nightmareai/real-esrgan`        |

## Workflow

### 1. Generate image

```bash
curl -s -X POST \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions" \
  -d '{
    "input": {
      "prompt": "...",
      "aspect_ratio": "1:1",
      "num_outputs": 2,
      "output_format": "png"
    }
  }'
```

Always `num_outputs: 2` for variants. Always generate `1:1` (square), crop to target format later.

### 2. Poll for result

```bash
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  "https://api.replicate.com/v1/predictions/PREDICTION_ID"
```

Wait 8-12 seconds for FLUX Schnell, 30-60 seconds for FLUX Dev.

### 3. Download

```bash
mkdir -p generated
curl -s -o generated/image-v1.png "OUTPUT_URL"
```

### 4. Show to user

Use the `send_image` MCP tool to send images to the chat:

```
send_image(image="generated/image-v1.png", caption="Variante 1")
send_image(image="generated/image-v2.png", caption="Variante 2")
```

ALWAYS show to the user and wait for feedback before proceeding.

### 5. Hi-res upscale

FLUX Schnell generates max 1024x1024. Upscale with Real-ESRGAN to 2x (2048x2048):

```bash
curl -s -X POST \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions" \
  -d '{"input": {"image": "REPLICATE_OUTPUT_URL", "scale": 2}}'
```

### 6. Crop to target format

```bash
# Instagram (1080x1350, 4:5 Portrait)
magick hires.png -resize 1350x1350^ -gravity center -extent 1080x1350 output-instagram.png

# LinkedIn (1200x627, ~1.91:1 Landscape)
magick hires.png -resize 1200x1200^ -gravity center -extent 1200x627 output-linkedin.png
```

### 7. Logo overlay (optional)

If logo files are available in the group folder or via mount:

```bash
# Instagram
magick output-instagram.png \
  \( wordmark-white.png -resize 160x \) \
  -gravity south -geometry +0+80 -composite \
  final-instagram.png

# LinkedIn
magick output-linkedin.png \
  \( wordmark-white.png -resize 140x \) \
  -gravity south -geometry +0+65 -composite \
  final-linkedin.png
```

If no logo files available: deliver image without overlay and inform the user.

## luno Brand Guidelines for Images

- **Direction:** Leipzig Loft — concrete, light, one plant
- **Colors:** studio (#3C4F4A) as wall color/accent, brass (#B4856C) as metal/fixtures
- **Floor:** Concrete (light, polished) — NOT wood
- **Plants:** One large tropical plant (Monstera, banana plant) — not many small ones
- **Mood:** Empty but inviting, morning light, warm
- **Avoid:** Wooden floors, too many plants, boho/retreat aesthetic, text in image (added as overlay)
- **Prompt tip:** Always add "no people, no text, no watermark, no logos" at the end
