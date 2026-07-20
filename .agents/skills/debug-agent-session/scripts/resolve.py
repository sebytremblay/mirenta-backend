#!/usr/bin/env python3
"""Resolve a loose user report to one Mirenta agent session and its cross-system trace.

Takes any handle a user might give — phone, name, email, Twilio Call SID, or a
contact_id — finds the matching `contacts` row, then prints the recent
`signals`, `interactions`, and `tasks` for that contact plus the exact
Temporal / LiveKit / Langfuse / Render commands to pull each system's trace.

Reads the direct Postgres connection from `mirenta-backend/.env`
(`SUPABASE_DB_HOST/PORT/NAME/USER/PASSWORD`). Prints IDs and non-secret URLs
only — never credentials.

Run from `mirenta-backend/`:

    uv run python .agents/skills/debug-agent-session/scripts/resolve.py --phone "+14155550123"
    uv run python .agents/skills/debug-agent-session/scripts/resolve.py --name "Jane Doe"
    uv run python .agents/skills/debug-agent-session/scripts/resolve.py --call-sid CAxxxx
    uv run python .agents/skills/debug-agent-session/scripts/resolve.py --contact-id <uuid> --langfuse-url
    uv run python .agents/skills/debug-agent-session/scripts/resolve.py --phone "+1415..." --around 2026-07-19T14:00 --window-min 90
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[4]
ENV_PATH = REPO_ROOT / ".env"


def load_db_dsn() -> tuple[str, dict[str, str]]:
    """Build a Postgres DSN from the backend .env; also return the raw env map."""
    if not ENV_PATH.exists():
        sys.exit(f"error: {ENV_PATH} not found — run this from mirenta-backend/ with a configured .env")
    env = {k: v for k, v in dotenv_values(ENV_PATH).items() if v is not None}
    missing = [k for k in ("SUPABASE_DB_HOST", "SUPABASE_DB_NAME", "SUPABASE_DB_USER", "SUPABASE_DB_PASSWORD") if not env.get(k)]
    if missing:
        sys.exit(f"error: missing {', '.join(missing)} in {ENV_PATH}")
    dsn = (
        f"host={env['SUPABASE_DB_HOST']} port={env.get('SUPABASE_DB_PORT', '5432')} "
        f"dbname={env['SUPABASE_DB_NAME']} user={env['SUPABASE_DB_USER']} "
        f"password={env['SUPABASE_DB_PASSWORD']} sslmode=require"
    )
    return dsn, env


def _fmt(rows: list[dict[str, Any]]) -> str:
    """Pretty JSON for a row list, with datetimes stringified."""
    return json.dumps(rows, indent=2, default=str)


def find_contacts(cur: psycopg.Cursor, args: argparse.Namespace) -> list[dict[str, Any]]:
    """Resolve candidate contacts from whatever handle was supplied."""
    if args.contact_id:
        cur.execute("select * from contacts where id = %s", (args.contact_id,))
        return cur.fetchall()
    if args.call_sid:
        # Call SID lands in signals.dedup_key (inbound_call) and interactions.provider_ref.
        cur.execute(
            """
            select c.* from contacts c
            where c.id in (
                select contact_id from signals where dedup_key = %(sid)s
                union
                select contact_id from interactions where provider_ref = %(sid)s
            )
            """,
            {"sid": args.call_sid},
        )
        return cur.fetchall()
    if args.phone:
        # exact E.164 first, then suffix match for partials the user typed loosely
        digits = "".join(ch for ch in args.phone if ch.isdigit())
        cur.execute(
            "select * from contacts where phone = %(p)s or phone like %(suffix)s order by created_at desc limit 25",
            {"p": args.phone, "suffix": f"%{digits[-10:]}" if len(digits) >= 7 else args.phone},
        )
        return cur.fetchall()
    if args.email:
        cur.execute("select * from contacts where email = %s order by created_at desc limit 25", (args.email,))
        return cur.fetchall()
    if args.name:
        cur.execute(
            """
            select * from contacts
            where (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ilike %(q)s
               or first_name ilike %(q)s or last_name ilike %(q)s
            order by created_at desc limit 25
            """,
            {"q": f"%{args.name}%"},
        )
        return cur.fetchall()
    sys.exit("error: supply one of --phone / --name / --email / --call-sid / --contact-id")


def time_clause(args: argparse.Namespace, column: str) -> tuple[str, dict[str, Any]]:
    """Optional time-window filter around --around, else empty."""
    if not args.around:
        return "", {}
    try:
        center = datetime.fromisoformat(args.around)
    except ValueError:
        sys.exit(f"error: --around must be ISO 8601 (e.g. 2026-07-19T14:00), got {args.around!r}")
    half = timedelta(minutes=args.window_min)
    return (f" and {column} between %(t_lo)s and %(t_hi)s", {"t_lo": center - half, "t_hi": center + half})


def main() -> None:
    """Parse the handle, resolve the contact, and print its cross-system trace."""
    parser = argparse.ArgumentParser(description="Resolve a Mirenta agent session and its cross-system trace.")
    g = parser.add_argument_group("handle (supply one)")
    g.add_argument("--phone", help="E.164 or partial phone number")
    g.add_argument("--name", help="contact name (partial, case-insensitive)")
    g.add_argument("--email", help="contact email")
    g.add_argument("--call-sid", help="Twilio Call SID (CA...)")
    g.add_argument("--contact-id", help="contact UUID (skips lookup)")
    parser.add_argument("--around", help="ISO timestamp to center a time window on, e.g. 2026-07-19T14:00")
    parser.add_argument("--window-min", type=int, default=60, help="half-window in minutes for --around (default 60)")
    parser.add_argument("--limit", type=int, default=15, help="rows per table (default 15)")
    parser.add_argument("--langfuse-url", action="store_true", help="print the Langfuse session URL and exit")
    args = parser.parse_args()

    dsn, env = load_db_dsn()
    with psycopg.connect(dsn, row_factory=dict_row) as conn, conn.cursor() as cur:
        contacts = find_contacts(cur, args)

        if not contacts:
            print("No matching contact found. Widen the handle (try a partial phone or name), or the")
            print("signal may have arrived before a contact was resolved — check signals directly by dedup_key.")
            return
        if len(contacts) > 1:
            print(f"{len(contacts)} contacts matched — pick one and re-run with --contact-id <id>:\n")
            for c in contacts:
                name = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() or "(no name)"
                print(f"  {c['id']}  org={c['org_id']}  {name:<24}  phone={c.get('phone')}  email={c.get('email')}")
            return

        c = contacts[0]
        contact_id, org_id = str(c["id"]), str(c["org_id"])
        name = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() or "(no name)"
        session_id = f"sms:{org_id}:{contact_id}"

        if args.langfuse_url:
            base = env.get("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").rstrip("/")
            print("Langfuse SMS session (voice turns are in LiveKit logs, not Langfuse):")
            print(f"  session_id: {session_id}")
            print(f"  filter traces on metadata.contact_id = {contact_id}")
            print(f"  {base}/sessions   # search this session_id; project picker uses the keys in .env")
            return

        print("=" * 88)
        print(f"CONTACT  {contact_id}")
        print(f"  name={name}  org={org_id}  phone={c.get('phone')}  email={c.get('email')}")
        print("=" * 88)

        sig_where, sig_params = time_clause(args, "received_at")
        cur.execute(
            f"""select id, type, channel, source, status, dedup_key, received_at, delivered_at, processed_at, error
                from signals where contact_id = %(cid)s{sig_where}
                order by received_at desc limit %(lim)s""",
            {"cid": contact_id, "lim": args.limit, **sig_params},
        )
        signals = cur.fetchall()

        int_where, int_params = time_clause(args, "started_at")
        cur.execute(
            f"""select id, task_id, channel, direction, agent_graph, outcome, summary, provider_ref,
                       guardrail_flags, input_tokens, output_tokens, started_at, ended_at, transcript
                from interactions where contact_id = %(cid)s{int_where}
                order by started_at desc limit %(lim)s""",
            {"cid": contact_id, "lim": args.limit, **int_params},
        )
        interactions = cur.fetchall()

        cur.execute(
            """select id, type, status, scheduled_for, attempts, max_attempts, temporal_workflow_id,
                      temporal_run_id, error, started_at, completed_at, payload
               from tasks where contact_id = %(cid)s order by scheduled_for desc limit %(lim)s""",
            {"cid": contact_id, "lim": args.limit},
        )
        tasks = cur.fetchall()

        print(f"\n--- SIGNALS ({len(signals)}) ---  status: ignored=blocked(DNC/consent), delivered=handed to Temporal, processed=decision consumed")
        print(_fmt(signals))
        print(f"\n--- INTERACTIONS ({len(interactions)}) ---  transcript + outcome + guardrail_flags per turn")
        print(_fmt(interactions))
        print(f"\n--- TASKS ({len(tasks)}) ---  scheduled/running/completed/failed; temporal_workflow_id = task-exec:<id>")
        print(_fmt(tasks))

        call_sids = [s["dedup_key"] for s in signals if s.get("type") == "inbound_call" and s.get("dedup_key")]
        call_sids += [i["provider_ref"] for i in interactions if i.get("channel") == "voice" and i.get("provider_ref")]
        call_sid_hint = call_sids[0] if call_sids else "<call_sid>"
        task_id_hint = str(tasks[0]["id"]) if tasks else "<task_id>"

        print("\n" + "=" * 88)
        print("NEXT COMMANDS  (IDs filled in — run from mirenta-backend/)")
        print("=" * 88)
        print(
            f"""
# Temporal — the contact's durable event loop and any scheduled task
set -a; source .env; set +a
TFLAGS="--address $TEMPORAL_ADDRESS --namespace $TEMPORAL_NAMESPACE --api-key $TEMPORAL_KEY --tls"
temporal workflow show     $TFLAGS --workflow-id "contact-loop:{contact_id}"
temporal workflow describe $TFLAGS --workflow-id "contact-loop:{contact_id}"
temporal workflow show     $TFLAGS --workflow-id "task-exec:{task_id_hint}"

# Langfuse — what the SMS LLM saw/said (voice LLM turns are in LiveKit logs)
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --contact-id {contact_id} --langfuse-url
#   session_id: {session_id}   (filter traces on metadata.contact_id = {contact_id})

# LiveKit — voice pipeline (agent "mirenta-voice", rooms "call-*", ephemeral)
lk agent logs
lk agent status
#   correlate this call by SID in backend logs below: {call_sid_hint}

# Render — production logs (web = webhooks/voice bridge, worker = decision engine/tasks)
render logs -o json --confirm --resources srv-d997pobtqb8s73a8cv6g --text "{contact_id}" --limit 200
render logs -o json --confirm --resources srv-d9eovgmrnols73elqmig --text "{contact_id}" --limit 200
render logs -o json --confirm --resources srv-d997pobtqb8s73a8cv6g --text "{call_sid_hint}" --limit 200

# Local dev logs (if reproducing locally)
rg '"{contact_id}"' logs/*.jsonl
"""
        )


if __name__ == "__main__":
    main()
