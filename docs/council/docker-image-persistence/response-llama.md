# Llama 4 Maverick — Docker Image Persistence

> Date: 2026-04-21
> Model: Llama 4 Maverick (`meta/llama-4-maverick-instruct`)
> Prediction: `x31kw791tnrmr0cxp29bffgp70`
> Predict time: 23.1s
> Wall time: 24.2s
> Created: 2026-04-21T15:04:20.181Z
> Completed: 2026-04-21T15:04:43.356747676Z

---

To address the issue of the `nanoclaw-agent:latest` image disappearing and causing the bot to stop responding, let's evaluate the provided options and assess their reliability, complexity, and potential side effects.

### Evaluation of Options

1. **Disable Coolify Docker Cleanup for this server**:
   - **Reliability**: High. The image won't be deleted by Coolify's cleanup job.
   - **Complexity**: Low. Can be done through Coolify settings.
   - **Side effects**: Docker cruft will accumulate on the server, potentially leading to disk space issues over time.

2. **Cron job that rebuilds the image periodically**:
   - **Reliability**: High. The image will be rebuilt regularly, ensuring it's available.
   - **Complexity**: Low to Medium. Requires setting up a cron job and ensuring it has the necessary permissions.
   - **Side effects**: None significant. Rebuilding the image periodically doesn't interfere with Coolify's operations.

3. **Push to a local registry**:
   - **Reliability**: High. The image will be stored in a registry and won't be affected by `docker image prune`.
   - **Complexity**: Medium. Requires setting up a local Docker registry and modifying NanoClaw's build and run processes.
   - **Side effects**: Adds a new service (the registry) to maintain, though it's relatively simple.

4. **Improve NanoClaw's auto-build**:
   - **Reliability**: High. The image will be rebuilt on demand when it's missing.
   - **Complexity**: Medium. Requires modifying NanoClaw's code to detect the missing image and rebuild it before use.
   - **Side effects**: Potential delay when a message comes in and the image needs to be rebuilt. Could lead to a slower response time for the first message after the image is deleted.

5. **Something else entirely**:
   - **Save/load image as tar**: Could be used to periodically save the image to a tar file and load it back if it's missing. This method is more of a backup/restore approach.
     - **Reliability**: High, if done correctly.
     - **Complexity**: Medium. Requires scripting to save and load the image.
     - **Side effects**: Similar to rebuilding, there's a potential delay when loading the image.
   - **Use Docker Compose with Coolify**: This might not directly address the issue unless it changes how Coolify manages the image.
     - **Reliability**: Uncertain without more details on how it interacts with Coolify's cleanup.
     - **Complexity**: Medium to High, depending on the changes required.

### Recommendation

Given the constraints and requirements, the **best approach** is to **Improve NanoClaw's auto-build mechanism** to detect and rebuild the missing image at runtime. This approach directly addresses the problem by ensuring that the image is available when needed.

**Implementation Details**:
- Modify NanoClaw's code to check if the `nanoclaw-agent:latest` image exists before attempting to spawn a container from it.
- If the image is missing, trigger a `docker build` command to rebuild the image.
- After rebuilding, proceed to spawn the container as usual.
- Consider adding a lock or a flag to prevent multiple rebuilds if several messages arrive simultaneously while the image is being rebuilt.

This solution is relatively straightforward, doesn't require significant changes to the existing infrastructure (like setting up a new registry), and directly addresses the issue at hand. It also doesn't interfere with Coolify's operations or cleanup processes.

While a cron job to periodically rebuild the image is also a viable and simpler solution, improving NanoClaw's auto-build mechanism is more proactive and directly tied to the bot's operational needs, potentially reducing unnecessary rebuilds if the image isn't deleted frequently.
