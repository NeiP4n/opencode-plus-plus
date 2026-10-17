---
description: Refresh OpenCode Zen access after a rate limit using Cloudflare WARP
---

Carry out the recovery now; do not respond with instructions only.

1. Detect the OS and check whether `warp-cli` exists. Run `warp-cli status` and `warp-cli registration show` before changing anything. If the CLI is missing, stop and report that Cloudflare WARP CLI is not installed. Do not install software automatically.
2. If WARP is managed by an organization/Zero Trust, do not delete its registration; only disconnect and reconnect it, then verify the status.
3. For a personal WARP registration, refresh the registration using the installed CLI's supported commands:
   - disconnect WARP;
   - delete the old registration with `warp-cli registration delete` (request normal privilege approval if required; never use `sudo -n` to silently fail);
   - create a new registration with `warp-cli registration new`;
   - reconnect with `warp-cli connect`;
   - verify with `warp-cli status`.
4. On Linux, if the service is unhealthy, check for `warp-svc` and restart it with the normal approved service command before retrying. Do not run `rm -rf`, clear WARP data directories, or change unrelated network settings.
5. If any step fails, stop and report the exact failed command and error. Do not keep retrying registration deletion. Finish with one short result: success/failure and the final WARP status.

This command refreshes the local WARP registration/connection. It cannot guarantee that a provider-side rate limit has expired.
