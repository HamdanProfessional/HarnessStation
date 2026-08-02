---
title: Images & media
description: Connecting image, speech, video and 3D generation with your own keys — including the free local route.
---

# Images & media

The model can generate images, audio, video and 3D models through whichever
service you connect. As with everything else, the keys are yours and the app
ships none.

## Choosing an engine

**Settings › Media models › Add model**, then pick one:

| Engine | Produces | Cost | Notes |
| --- | --- | --- | --- |
| **OpenAI-compatible image** | Images | Per image | Works with OpenAI and any local server offering the same route |
| **Stable Diffusion webui** | Images | Free | A1111 or Forge running locally |
| **OpenAI-compatible speech** | Audio | Per character | Cloud or local TTS |
| **Replicate** | Image, audio, video, 3D | Per run | Widest model choice by far |

Set a default per kind, so the tools know what to use without being told.

## Generating

Turn on the **Media** tool group, then ask:

```text
Generate a wide banner image of a lighthouse at dusk, muted colours,
no text.
```

The result appears inline and is saved with the chat.

Prompting for images is mostly a property of whichever model you're using, but
two things help everywhere: **say what you don't want** ("no text", "no people"),
and **name the aspect ratio** rather than hoping.

You can also ask the model to write the prompt:

```text
I need a header image for an article about database replication.
Write three different image prompts, then generate the one you
think fits best.
```

That's often better than writing it yourself, because models know the vocabulary
image models respond to.

## Free local images

For images at no cost, run
[AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or Forge
with its API enabled:

```bash
./webui.sh --api          # Linux
webui-user.bat --api      # Windows
```

Then add a **Stable Diffusion webui** model pointing at `http://localhost:7860`.
No key, nothing leaves your machine, no per-image cost.

It needs a reasonable GPU — around 6 GB of VRAM for SDXL at sensible settings.
Below that it still works, but slowly enough to be annoying.

## Speech

Speech generation here is separate from the [voice avatar](../voice/engines),
which has its own engine settings. This is for producing audio as *output* — a
narration, a spoken version of a document.

For talking to the app, use the voice settings instead.

## Video and 3D

Both go through Replicate, and both are considerably slower and more expensive
than images. Seconds of video can cost more than dozens of images, and a single
generation may take minutes.

Worth knowing before leaving an agent generating them unattended.

## Cost

Generation is billed per image, per second of output, or per run depending on the
service, and is substantially dearer than text.

The [spend caps](../reference/settings) in **Settings › Usage** apply here too,
and this is one of the places they matter most — an agent asked to "generate
images for each section" can produce twenty before you look.
→ [Controlling cost](../concepts/cost)

## Where it goes wrong

**Nothing generates.** No default set for that kind, or the Media tool group is
off in this chat.

**Local generation won't connect.** The webui needs `--api`; without it the route
doesn't exist. Check that `http://localhost:7860/docs` responds.

**Images ignore part of the prompt.** A property of the image model rather than
the app. Shorter, more concrete prompts generally do better than long ones.

**The result isn't anywhere useful.** Images are stored with the chat. To put one
on disk, enable the Files tool and ask it to save the file.
