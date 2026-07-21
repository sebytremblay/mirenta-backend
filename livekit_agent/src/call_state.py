"""Per-call mutable state (LiveKit ``userdata``) + deterministic email collapse.

Pure module — no LiveKit imports — so the collapse logic stays unit-testable the
same way ``call_context.py`` is. The ``CallData`` instance is passed to
``AgentSession(userdata=...)`` and reached from every tool via
``RunContext.userdata``: it is the single source of truth for values the agent
must say and act on identically.

Why this exists: reading an email back to the caller and passing an email to
``schedule_meeting`` were two independent LLM generations, so the agent would
confirm one address and book another (e.g. read "sebybas" then send
"sebbybasa"). Collapsing phonetic spelling to a string here, in Python, means
the address the caller confirms is the exact address the tool sends — the model
never hand-writes the string.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# NATO phonetic alphabet → letter. Includes the common "juliett" spelling and a
# few homophones the STT tends to emit for spoken code words.
_NATO_TO_LETTER: dict[str, str] = {
    "alpha": "a", "alfa": "a",
    "bravo": "b",
    "charlie": "c",
    "delta": "d",
    "echo": "e",
    "foxtrot": "f", "fox": "f",
    "golf": "g",
    "hotel": "h",
    "india": "i",
    "juliet": "j", "juliett": "j",
    "kilo": "k",
    "lima": "l",
    "mike": "m",
    "november": "n",
    "oscar": "o",
    "papa": "p",
    "quebec": "q",
    "romeo": "r",
    "sierra": "s",
    "tango": "t",
    "uniform": "u",
    "victor": "v",
    "whiskey": "w", "whisky": "w",
    "x-ray": "x", "xray": "x", "x ray": "x",
    "yankee": "y",
    "zulu": "z",
}

# Spoken digits → character, for local parts that include numbers.
_WORD_TO_DIGIT: dict[str, str] = {
    "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
}

# Tokens that are punctuation/separators, ignored inside a local part.
_IGNORED_TOKENS: frozenset[str] = frozenset({"at", "dot", "period", "point", "space", ""})


def _token_to_char(token: str) -> str:
    """Collapse one spoken token to a single character (best-effort, deterministic).

    A NATO code word or spoken digit maps to its letter/digit; a token that is
    already a single character passes through; anything else falls back to its
    first character. The fallback is safe because the caller hears the collapsed
    address read back before it is used, and — crucially — the read-back and the
    booked address come from this same string, so they can never diverge.
    """
    cleaned = token.strip().lower().strip(".")
    if cleaned in _NATO_TO_LETTER:
        return _NATO_TO_LETTER[cleaned]
    if cleaned in _WORD_TO_DIGIT:
        return _WORD_TO_DIGIT[cleaned]
    if len(cleaned) == 1:
        return cleaned
    return cleaned[:1]


def collapse_email(local_part: list[str], domain: str) -> str:
    """Build an email address from phonetic tokens plus a spoken domain.

    ``local_part`` is the part before the ``@``, spelled one token per character
    (NATO code words, bare letters, or spoken digits); separator words like "at"
    and "dot" are ignored there. ``domain`` is the part after the ``@`` as a
    normal word ("gmail.com" or "gmail dot com") — domains are dictionary words,
    not arbitrary spelling, so they carry far less transcription risk than the
    local part and do not need phonetic capture.

    Returns:
        str: The lowercased ``local@domain`` address.

    Raises:
        ValueError: When the collapsed local part or domain is empty.
    """
    local = "".join(_token_to_char(t) for t in local_part if t.strip().lower() not in _IGNORED_TOKENS)

    normalized_domain = domain.strip().lower()
    for word, char in ((" dot ", "."), (" dot", "."), ("dot ", "."), (" at ", "@")):
        normalized_domain = normalized_domain.replace(word, char)
    normalized_domain = normalized_domain.replace(" ", "").strip(".")

    if not local or not normalized_domain:
        raise ValueError("empty_email_component")
    return f"{local}@{normalized_domain}"


@dataclass
class CallData:
    """Mutable per-call state threaded through tools as ``RunContext.userdata``.

    Single source of truth for values the agent must both speak and act on:
    ``email`` is set by ``capture_email`` and read by ``schedule_meeting``, so a
    confirmed address is the one that gets booked. ``booked_event_id`` records a
    successful booking so a follow-up correction can resend rather than rebook.
    """

    email: str | None = None
    booked_event_id: str | None = None
    guardrail_flags: list[str] = field(default_factory=list)
