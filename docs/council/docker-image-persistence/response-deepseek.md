# DeepSeek R1 — Docker Image Persistence

> Date: 2026-04-21
> Model: DeepSeek R1 (`deepseek-ai/deepseek-r1`)
> Prediction: `c1zehd11snrmy0cxp29bmd1n34`
> Predict time: 111.5s
> Wall time: 112.9s
> Created: 2026-04-21T15:04:20.173Z
> Completed: 2026-04-21T15:06:11.712597536Z

---

## Recommended Solution: **Option 4 (Improve NanoClaw's auto-build)**

This is the simplest, most robust solution that meets all your requirements. Here's why:

### Why Option 4 Wins

1. **Reliability**: 9/10
   - Detects missing image at runtime (when it actually matters)
   - Self-healing - no human intervention needed
   - Works even if image gets deleted by any mechanism (not just Coolify)

2. **Complexity**: 2/10 (Very low)
   - Minimal code changes to NanoClaw
   - No new services, cron jobs, or infrastructure
   - Leverages existing build logic

3. **Side Effects**: Minimal
   - Doesn't interfere with Coolify's cleanup
   - Only rebuilds when absolutely necessary
   - Maintains existing Docker workflow

### Implementation Details

Add this check to NanoClaw's container spawning logic:

```python
# Pseudo-code for the key addition
import docker
import subprocess
import time

client = docker.from_env()

def ensure_agent_image_exists():
    """Check if image exists, rebuild if missing."""
    try:
        client.images.get('nanoclaw-agent:latest')
        return True
    except docker.errors.ImageNotFound:
        print("Image missing. Rebuilding...")
        # Rebuild with the same command you use at startup
        result = subprocess.run([
            'docker', 'build', 
            '-t', 'nanoclaw-agent:latest',
            '-f', '/path/to/Dockerfile',
            '--label', 'coolify.managed=true',
            '/path/to/build/context'
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            print("Image rebuilt successfully")
            return True
        else:
            print(f"Build failed: {result.stderr}")
            return False

def spawn_agent_container():
    # Always check before spawning
    if ensure_agent_image_exists():
        # Proceed with container creation
        container = client.containers.run(
            'nanoclaw-agent:latest',
            # ... other parameters
        )
        return container
    else:
        raise Exception("Failed to ensure agent image exists")
```

### Additional Enhancements

1. **Add exponential backoff** for rebuild attempts to prevent hammering the system if builds fail.
2. **Cache the check result** for a few minutes to avoid checking on every single message (if you have high message volume).
3. **Keep the startup check** as a belt-and-suspenders approach.

### Why Other Options Are Inferior

- **Option 1 (Disable cleanup)**: Leads to disk filling up, requires manual maintenance.
- **Option 2 (Cron job)**: Wastes resources, still has a window of vulnerability between deletion and cron run.
- **Option 3 (Local registry)**: Overkill, adds complexity, another service to maintain.
- **Option 5 (Tar backups)**: Hacky, doesn't solve the root problem.

### Bonus: Quick Fix for Current Cleanup Issue

While implementing Option 4, you can also add this to your Dockerfile to prevent the image from becoming "dangling":

```dockerfile
# Add this near the top of your Dockerfile
LABEL coolify.managed=true
LABEL nanoclaw.managed=true  # Additional label for clarity
```

And modify your build command to ensure the image is always properly tagged:

```bash
# Instead of just tagging as :latest, also tag with a unique identifier
docker build -t nanoclaw-agent:latest -t nanoclaw-agent:$(date +%Y%m%d-%H%M%S) .
```

### Expected Outcome

With this solution:
1. The bot will auto-recover within 30 seconds (with cache) if the image disappears
2. No manual intervention required
3. Coolify can continue cleaning up its own artifacts
4. Minimal code changes
5. Works regardless of what causes the image deletion (Coolify or any other process)

This is a classic case of "embrace the problem" - instead of trying to prevent the image deletion (which could happen for many reasons), make your system resilient to it. The 30-second rebuild time is acceptable for a rare event that occurs every 1-2 days.
