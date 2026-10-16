# Mesh room: architecture and implementation contract

## Goal

A Mesh room is one logical multiplayer room spanning several OpenCode++ installations. Every enrolled device is a full peer: four phones, two laptops and a desktop can all contribute work. A coordinator is elected temporarily; it is not a permanent host. When that device disappears, another peer takes over without losing already committed room state.

The operator can issue work from any connected device. The mesh schedules each operation to a suitable peer—for example, a request may be sent to the desktop that has a working provider login, while a code-change task is assigned to the laptop that has the repository checkout.

## Why this must not be implemented as a larger LAN room

The existing LAN room protocol is host-owned: room metadata, its event feed and the hosted session live on that server. Guest tokens grant access to that host. If the host disappears, the current room is unavailable. Reusing those tokens or merely listing several hosts does not provide failover.

Mesh therefore needs a replicated control plane separate from the existing host-owned room. A peer's local OpenCode session, filesystem, shell, provider credentials and installed tools remain local. The mesh replicates the logical room log and task/control state; it does not copy API keys or pretend every machine has the same filesystem.

## Consistency and availability contract

- Use a Raft-style term, vote, replicated log and commit index for room-control writes.
- For a fixed membership of seven voters, a write requires four acknowledgements. Election and log entries require a majority of the voters in the active configuration.
- Count each node once; duplicate acknowledgements or unknown node IDs never count toward quorum.
- Persist a new term/vote before sending a positive vote response. Persist log entries before acknowledging replication. Commit only after the quorum rule is satisfied.
- The coordinator is temporary. A newly elected coordinator recovers the committed log and resumes eligible jobs using stable job IDs and idempotent state transitions.
- If the peer cannot reach a quorum, it may display its last committed snapshot and keep local drafts, but it must not claim a new coordinator or commit shared writes. This avoids split-brain writes.
- This is crash-fault tolerance, not protection against malicious enrolled nodes. Node enrollment and transport authentication still matter.

The current implementation keeps the active voter set fixed. Devices invited after activation join as **learners/workers**: they receive the replicated log, can send shared entries through the coordinator, and may execute local worker requests, but they never vote or increase the quorum. Promoting a learner to a voter or removing an active voter is not implemented; those actions require a committed joint-consensus membership-change protocol. Silently changing the quorum count when devices disappear can create two leaders.

## Provider and task routing

Each node advertises capabilities, not credentials: available provider/model identifiers, whether the provider is currently usable, local cooldown/backoff, execution capacity, and the kinds of work it can accept. A scheduler selects an eligible node and sends a bounded, authenticated inference/task request to that node's OpenCode server. The node uses its own credentials locally and returns the result; API keys, cookies and provider tokens never travel through the mesh protocol.

Tasks need a stable ID, deadline/lease, cancellation state, origin, destination and result reference. Retries must use the same ID so a timeout does not execute a destructive task twice. Queue state and task transitions belong in the replicated log; raw credentials and unnecessary local paths do not.

For repository edits, the control plane should assign a task/worktree to a device and publish a patch or commit result. It must not let multiple peers silently write the same working tree. Existing permission controls remain enforced on the machine that executes a command.

## Connectivity

- On the same LAN, use the existing UDP discovery as a locator only; discovery is not authentication.
- Across networks, allow a manually entered address or a private VPN such as WireGuard/Tailscale. Do not expose a privileged mesh API directly to the public internet without authenticated encrypted transport.
- Do not open a general shell because two devices are paired. Remote model calls and remote command execution are separate capabilities with separate permissions.
- A device leaving the network stops receiving new leases; committed room history remains available on the surviving replicas.

## Rollout

1. **Consensus primitives** — deterministic quorum, vote and commit rules with unit tests. This is the scope of the initial mesh-control-plane change.
2. **Persistent node state and transport** — stable node identity, authenticated enrollment, heartbeat, vote and append RPCs, durable log, replay and crash-recovery tests.
3. **Mesh room API** — create/join/list/leave, replicated room feed, membership change protocol and read-only degraded mode.
4. **Distributed worker broker** — advertise provider capability, dispatch idempotent inference tasks, stream progress/results, cancel and retry.
5. **UI integration** — one Mesh room panel in CLI/TUI and Android, showing all peers, the temporary coordinator, quorum health, available providers and jobs.
6. **Failure tests** — kill the coordinator, drop one replica mid-append, reorder/duplicate RPCs, restart nodes, partition the network, and verify that only a majority can commit.

## Acceptance criteria

For a seven-device room: any single device may go offline without losing committed room state; if the coordinator goes offline, a survivor can be elected by the remaining majority; concurrent partitions cannot both commit; AI work can be executed using a provider already configured on another enrolled device without exporting that provider's credentials; retries do not duplicate a committed job; losing quorum visibly moves the room to read-only mode.

## Current implementation status on `lan-rooms`

Under **Multiplayer**, choose **+ Host** to create either a normal Host room or a Mesh. **+ Connect** automatically scans the LAN for both types; discovered rooms are labelled **Host** or **Mesh**. To join a discovered Mesh, choose **Connect** beside it and paste the invitation token from its creator. The token is intentionally not included in discovery metadata. The Mesh panel supports activation, coordinator/quorum status, and shared messages or task notes.

### Manual smoke test

1. Start OpenCode++ on every device with a reachable LAN/VPN bind address and a fixed port. For example, on Linux/macOS:
   ```sh
   OPENCODE_SERVER_PASSWORD='replace-with-a-long-unique-password' opencode --hostname 0.0.0.0 --port 4096
   ```
   In PowerShell:
   ```powershell
   $env:OPENCODE_SERVER_PASSWORD = "replace-with-a-long-unique-password"
   opencode --hostname 0.0.0.0 --port 4096
   ```
   Allow the selected TCP port through the device firewall only on trusted LAN/VPN networks.
2. On the first device, open **+ Host**, select the **Mesh** tab, enter its reachable address (for example, `http://192.168.1.10:4096`), and choose **Create Mesh**. Share the invitation token only with devices you trust.
3. On every other device, open **+ Connect** and wait for the **Mesh** room to appear in the automatic scan. Choose **Connect** next to it, paste the invitation token, confirm this device's reachable address, and choose **Join Mesh**. The list rescans periodically while the dialog remains open; use **Search again** for an immediate scan.
4. When every intended voting device appears on the creator, choose **Activate Mesh**. All enrolled peers must be reachable for initial activation.
5. Confirm the status says **Quorum healthy**. Send a message and verify that it appears on the other peers. A minority partition should not be treated as writable.
6. To add another device later, keep the existing Mesh active, open the owner's Mesh panel, copy the persistent invitation token shown under **Invite another device**, and use **+ Connect** on the new device. After LAN discovery finds the Mesh, choose **Connect** and paste the token. All currently listed devices must be online so the owner can confirm the roster update. The new device appears as a **Worker** and does not change the voting quorum.

Use only a trusted LAN or private VPN; do not port-forward the server to the public internet. The Mesh RPC endpoint authenticates peer requests with the high-entropy room secret. The regular OpenCode server should still be protected with `OPENCODE_SERVER_PASSWORD`.

### Current limitations

This is a usable Mesh-room MVP, **not yet the complete remote-AI orchestration experience**. The panel shares message/task entries and displays membership/quorum state; it does not yet dispatch a task entry as an AI prompt to a selected remote worker, advertise model/provider capabilities, stream remote execution progress, or manage returned code changes. Owners can re-open the persistent invitation token after activation and add devices as non-voting workers. The active voting configuration stays fixed: promoting a worker to voter and removing voters are not supported yet. **Leave Mesh** clears the local Mesh state only; it does not remove that device from the other peers' current roster, so leaving an active voter still can reduce quorum. Failover and network-partition behavior still need full integration and failure testing before being relied on for important work.
