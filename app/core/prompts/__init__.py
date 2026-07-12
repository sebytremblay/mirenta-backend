"""Channel prompt templates rendered with Jinja2."""

from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

_PROMPTS_DIR = Path(__file__).resolve().parent

_env = Environment(
    loader=FileSystemLoader(_PROMPTS_DIR),
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
)

_SMS_PROMPT = _env.get_template("sms.md")
_VOICE_PROMPT = _env.get_template("voice.md")
_VOICE_GREETING = _env.get_template("voice_greeting.md")


def load_sms_prompt() -> str:
    """Load the SMS system prompt, filling in the current date/time."""
    return _SMS_PROMPT.render(
        current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    ).strip()


def load_system_prompt() -> str:
    """Backward-compatible alias for load_sms_prompt()."""
    return load_sms_prompt()


def load_voice_prompt(*, persona: str, knowledge: str = "") -> str:
    """Load LiveKit voice system instructions, optionally including knowledge."""
    return _VOICE_PROMPT.render(persona=persona, knowledge=knowledge).strip()


def load_voice_greeting(*, company_name: str) -> str:
    """Load the spoken opening greeting for a voice session."""
    return _VOICE_GREETING.render(company_name=company_name).strip()
