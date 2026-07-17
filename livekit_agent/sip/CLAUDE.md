# livekit_agent/sip/

Request bodies for `lk` CLI, not read by the agent at runtime (see `../CLAUDE.md`).

- `inbound-trunk.json` — creates the Twilio-facing SIP trunk. `allowed_addresses` is Twilio's published SIP signaling IP range (do not add arbitrary IPs). `headers_to_attributes` maps Twilio `X-Mirenta-*` SIP headers to the `mirenta.*` participant attributes `../src/call_context.py` reads.
- `dispatch-rule.json` — `trunk_ids` hardcodes the live trunk ID returned when `inbound-trunk.json` was applied (`ST_cyrFgopLCEgt`). If the trunk is ever recreated, update this ID here — it is not resolved dynamically.
