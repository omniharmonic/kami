"""The live smoke report must distinguish stream errors from completed turns."""
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[1]/"scripts/runtime_smoke.py"
spec = importlib.util.spec_from_file_location("runtime_smoke", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_source_footer_is_not_model_text():
    text = 'data: {"choices":[{"delta":{"content":"A measured reading."}}]}\n\nevent: toolcalls\ndata: {"sources":["usgs"],"calls":[]}\n\ndata: [DONE]\n\n'
    reply, footer, error = module.parse_sse(text)
    assert reply == "A measured reading."
    assert footer["sources"] == ["usgs"]
    assert error is False


def test_runtime_failure_is_not_scored_as_success():
    _, footer, error = module.parse_sse('data: {"error":{"type":"runtime_error"}}\n\n')
    assert footer is None
    assert error is True
