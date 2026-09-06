"""entity-gate: the guarded OpenAI-compatible proxy between Hermes and vLLM."""

from .app import create_app
from .config import GateConfig, load_config

__all__ = ["GateConfig", "create_app", "load_config"]
