---
title: Images & media
description: Connecting image, speech, video and 3D generation, using your own keys.
---

# Images & media

The model can generate images, audio, video and 3D models — through whichever
service you connect. As with everything else, the keys are yours.

## Setting one up

**Settings › Media models › Add model**, then pick an engine:

| Engine | For | Notes |
| --- | --- | --- |
| **OpenAI-compatible image** | Images | Works with OpenAI, and local servers offering the same route |
| **Stable Diffusion webui** | Images | A1111 or Forge running locally — free, no key |
| **OpenAI-compatible speech** | Audio | Cloud or local TTS |
| **Replicate** | Image, audio, video, 3D | Widest model choice, billed per run |

Set a default per kind, so `generate_image` knows what to use without being told.

## Using it

Turn on the **Media** tool group and ask:

```text
Generate a wide banner image of a lighthouse at dusk, muted colours.
```

The result appears inline in the conversation and is saved with the chat.

## Local image generation

For images at no cost, run [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui)
or Forge with its API enabled:

```bash
./webui.sh --api          # Linux
webui-user.bat --api      # Windows
```

Then add a **Stable Diffusion webui** model pointing at `http://localhost:7860`.
No key, nothing leaves your machine.

## Cost

Cloud generation is billed per image or per second of output, and is
substantially dearer than text. The [spend caps](../reference/settings) in
**Settings › Usage** apply here too — worth setting before letting an agent
generate images unattended.
