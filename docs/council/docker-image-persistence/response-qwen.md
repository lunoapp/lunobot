# Qwen3 235B — Docker Image Persistence

> Date: 2026-04-21
> Model: Qwen3 235B (`qwen/qwen3-235b-a22b-instruct-2507`)
> Prediction: `h52qdk91tdrmw0cxp298sc9nwr`
> Predict time: 34.5s
> Wall time: 35.1s
> Created: 2026-04-21T15:04:20.179Z
> Completed: 2026-04-21T15:04:54.719736177Z

---

Great question — you've done excellent root cause analysis. You're dealing with a classic conflict between **automated infrastructure hygiene** (Coolify's cleanup) and **unmanaged-but-critical local assets** (your `nanoclaw-agent` image). Let’s evaluate your options carefully, then pick the **simplest, most robust solution** that fits your constraints as a 2-person startup on a single VPS.

---

### 🔍 Option Evaluation

#### 1. **Disable Coolify Docker Cleanup**
- **Reliability**: ❌ High risk — disables cleanup entirely → eventual disk exhaustion
- **Complexity**: ✅ Trivial (toggle in UI or config)
- **Side effects**: ⚠️ **Very bad** — accumulates dangling images, build cache, stopped containers across all Coolify-managed apps → disk fills up → **all apps die**
- ✅ *Only acceptable if no other apps run on this server — but you said there are others.*

> ❌ **Not viable long-term. Avoid.**

---

#### 2. **Cron job that rebuilds image every 6 hours**
- **Reliability**: ✅ Good — if image is gone, it’ll come back within 6h
- **Complexity**: ✅ Low — one `crontab` line + rebuild script
- **Side effects**: ⚠️ Wastes CPU/disk I/O every 6h even when unnecessary; **still allows downtime** (up to 6h!)
- ⚠️ Also fails during cold starts (e.g. server reboot) unless cron includes startup hook

> 🟡 **Better than nothing**, but not *robust* — allows downtime window and is wasteful.

---

#### 3. **Push to a local registry**
Run a local Docker registry (e.g. `registry:2`) on localhost:5000, push `nanoclaw-agent` there, pull from it.

- **Reliability**: ✅✅ Excellent — images in registry survive `docker image prune -f`, even if local tags disappear
- **Complexity**: ⚠️ Medium — requires:
  - Deploying & securing a registry container
  - Updating NanoClaw to push/pull
  - Possibly handling TLS/auth (can skip with `insecure-registries`)
- **Side effects**: 
  - Adds ~100MB RAM usage (registry)
  - Requires disk space, but no worse than current
  - Doesn't interfere with Coolify

> ✅ Solid technical solution — but overkill for **one image on one server**?

---

#### 4. **Improve NanoClaw’s auto-build: detect missing image at runtime**
Before `docker run`, check if image exists:
```bash
docker inspect nanoclaw-agent:latest >/dev/null 2>&1 || rebuild_image
```

- **Reliability**: ✅✅ Excellent — **zero downtime**; rebuilds just-in-time
- **Complexity**: ✅ Low — just wrap the `docker run` call with a pre-check
- **Side effects**: ⚠️ Short delay (~30s) when image was pruned, but bot still responds
  - No impact on Coolify cleanup
  - No extra services

> ✅✅ **This is the sweet spot: reliable, simple, non-invasive.**

---

#### 5. **Something Else: Save/Load Image as Tarball**
Save image to disk (`docker save > /opt/nanoclaw.tar`) and restore when missing.

- **Reliability**: ✅ Good — survives prunes and reboots
- **Complexity**: ⚠️ Medium — need automation to:
  - Save after build
  - Restore before run
  - Handle concurrency
- **Side effects**: 
  - Uses extra disk (~2GB)
  - Risk of stale backup if not updated
  - Slower restore than rebuild with cache

> 🟡 Better than cron rebuild, but **less elegant than Option 4**

---

### ✅ Recommended Solution: **Option 4 — Runtime Image Check + Rebuild**

> **"Detect and rebuild the image just-in-time when a message arrives and the image is missing."**

This gives you:
- ✅ **Zero downtime** (bot recovers automatically within 30s)
- ✅ **No changes to Coolify** — cleanup keeps working
- ✅ **No extra services or disk bloat**
- ✅ **Minimal maintenance** — one small change to NanoClaw’s runtime logic
- ✅ **Scales to reboots, prunes, manual deletions, etc.**

---

### 🛠 Implementation Plan

#### Step 1: Modify NanoClaw’s Container Spawn Logic

Wherever you currently do:
```bash
docker run nanoclaw-agent:latest ...
```

Replace with a wrapper script or inline check:

```bash
#!/bin/bash

IMAGE_NAME="nanoclaw-agent:latest"

# Check if image exists locally
if ! docker inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Image $IMAGE_NAME not found. Rebuilding..."
    # Pull latest code, then build
    cd /path/to/nanoclaw || exit 1
    docker build -t "$IMAGE_NAME" .
    if [ $? -ne 0 ]; then
        echo "Failed to rebuild $IMAGE_NAME"
        exit 1
    fi
    echo "Successfully rebuilt $IMAGE_NAME"
fi

# Now run the container
docker run --rm "$IMAGE_NAME" "$@"
```

#### Step 2: Integrate into NanoClaw

- If NanoClaw is a Node.js/Python service: call this script via `child_process`/`subprocess`
- If using a `docker-compose.yml`, replace `image:` with a script launcher
- Ensure the user running NanoClaw has Docker permissions (`sudo usermod -aG docker <user>`)

#### Step 3: (Optional) Optimize Rebuild Speed
Ensure Docker layer caching works:
- Use multi-stage builds wisely
- Pin dependencies (e.g. `pip freeze > requirements.txt`)
- Avoid changing early layers frequently

> With good caching, rebuilds take ~30s, not 3 minutes.

#### Step 4: Test the Failure Mode
Manually delete the image and simulate a message:
```bash
docker rmi nanoclaw-agent:latest
# Trigger a message → should auto-rebuild and respond
```

---

### 🔁 Why This Beats the Alternatives

| Factor | Runtime Rebuild (✅) | Cron Rebuild | Local Registry |
|------|----------------------|-------------|----------------|
| Prevents downtime? | ✅ Yes (30s delay) | ❌ Up to 6h | ✅ Yes |
| Extra services? | ❌ No | ❌ No | ✅ Yes (registry) |
| Maintains Coolify hygiene? | ✅ Yes | ✅ Yes | ✅ Yes |
| Simple to debug? | ✅ Yes | ✅ Yes | ⚠️ More moving parts |
| Startup after reboot? | ✅ Works | ✅ Works | ✅ Works |

---

### 🧩 Bonus: Make It Even More Robust

Add a startup health check:
```bash
# On boot or service start, ensure image exists
if ! docker inspect nanoclaw-agent:latest >/dev/null; then
    rebuild_nano_claw_image  # non-blocking or async
fi
```

But **don’t rely on this alone** — runtime check is still essential.

---

### ✅ Final Recommendation

> **Implement Option 4: Runtime image check + rebuild before `docker run`**

It’s:
- **The simplest** change that **fully solves** the problem
- **Non-invasive** to Coolify and other services
- **Self-healing** and **low-maintenance**
- Perfect for a small team on a single VPS

Do it now, test it, and **never worry about the bot going down due to Docker cleanup again.**

Let me know if you want help writing the exact wrapper script for your stack (Node.js, Python, etc.)!
