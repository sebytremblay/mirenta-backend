"""This file contains the prompts for the agent."""

import os
from datetime import datetime

_PROMPTS_DIR = os.path.dirname(__file__)

# Read templates once at module load — no file I/O per request
with open(os.path.join(_PROMPTS_DIR, "system.md"), "r") as _f:
    _SYSTEM_PROMPT_TEMPLATE = _f.read()


def load_system_prompt() -> str:
    """Load the system prompt from the cached template, filling in the current date/time."""
    return _SYSTEM_PROMPT_TEMPLATE.format(current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
