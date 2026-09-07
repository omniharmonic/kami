"""Offline onboarding contract tests: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from checks import agent
from context import Ctx, Secrets
from main import parse_args, selected
from net import Resp
from report import Report, render_json, render_text

TOKEN = "doctor-private-canary-token"
ENTITY = "entity/boulder-creek"
CONFIG = {"entity_id": ENTITY, "config": {"entity": {"id": ENTITY, "slug": "boulder-creek"},
    "binding_version": 2, "binding_review": "approved", "binding_active": True,
    "members": 12, "paused": True, "anchor": "place/orodell"}}
NEEDS = {"entity_id": ENTITY, "snapshot_id": 1,
         "snapshot": {"entity_id": ENTITY, "stale_driving": True, "mood": "asleep"}}


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ctx = Ctx("boulder-creek", Path(self.temp.name), {"PLATFORM_URL": "https://beings.test",
            "PLATFORM_MCP_TOKEN": TOKEN, "KAMI_ENTITY_SLUG": "boulder-creek"}, Secrets())
        self.config, self.needs = copy.deepcopy(CONFIG), copy.deepcopy(NEEDS)
        self.requests = []
        self.failure = None
        self.sse = False

    def request(self, url, **kwargs):
        self.requests.append((url, kwargs))
        body = kwargs["body"]
        self.assertFalse(kwargs["follow_redirects"])
        if url.startswith("https://mcp."):
            self.assertNotIn("Authorization", kwargs["headers"])
        if self.failure:
            failed = self.failure(body)
            if failed is not None:
                return failed
        if body["method"] == "notifications/initialized":
            self.assertNotIn("id", body)
            self.assertEqual(kwargs["headers"]["Mcp-Session-Id"], "session-private")
            return Resp(status=202)
        if body["method"] == "initialize":
            result = {"protocolVersion": "2025-03-26", "capabilities": {}}
        else:
            self.assertEqual(kwargs["headers"]["MCP-Protocol-Version"], "2025-03-26")
            name = body["params"]["name"]
            values = {"get_entity_config": self.config, "get_needs_snapshot": self.needs,
                "list_datasets": {"datasets": [{"id": "conditions"}]},
                "get_place": {"id": "place/orodell", "readings": [{"stale": False}],
                              "coordinates": [123, 456], "private": TOKEN}}
            result = {"structuredContent": values[name]}
        payload = {"jsonrpc": "2.0", "id": body["id"], "result": result}
        encoded = json.dumps(payload).encode()
        if self.sse:
            encoded = b": keepalive\n\nevent: message\ndata: " + encoded + b"\n\n"
        return Resp(status=200, body=encoded, headers={"mcp-session-id": "session-private"})

    def run_check(self):
        with patch.object(agent, "request", self.request):
            return agent.run(self.ctx, {})

    def test_paused_approved_stale_is_working_read_path(self):
        result = self.run_check()
        statuses = {s.id: s.status for s in result.steps}
        self.assertNotIn("fail", statuses.values())
        self.assertEqual(statuses["agent.connection"], "pass")
        self.assertEqual(statuses["agent.freshness"], "warn")
        self.assertEqual(statuses["agent.pause"], "pass")
        self.assertEqual(statuses["agent.public_runtime"], "skipped")
        self.assertEqual([k["body"]["params"]["name"] for _, k in self.requests if k["body"]["method"] == "tools/call"],
                         ["get_entity_config", "get_needs_snapshot", "list_datasets", "get_place"])

    def test_pending_members_are_not_absent(self):
        self.config["config"].update(binding_review="pending_review", binding_active=False)
        self.needs.update(snapshot=None, snapshot_id=None)
        result = self.run_check()
        self.assertNotIn("fail", [s.status for s in result.steps])
        self.assertIn("12 proposed/configured", next(s.detail for s in result.steps if s.id == "agent.binding"))
        self.assertIn("agent.anchor", [s.id for s in result.steps])

    def test_wrong_entity_stops_before_needs_and_twin(self):
        self.config["entity_id"] = "entity/something-else"
        result = self.run_check()
        self.assertEqual(result.status, "fail")
        self.assertEqual(len(self.requests), 3)

    def test_auth_failure_is_specific_and_body_not_printed(self):
        self.failure = lambda body: Resp(status=401, body=TOKEN.encode())
        result = self.run_check()
        self.assertIn("authentication/authorization", result.steps[-1].detail)
        self.assertNotIn(TOKEN, str(result.as_dict()))

    def test_missing_and_error_mcp_results_fail(self):
        for payload in ({}, {"error": {"message": TOKEN}}, {"result": {"isError": True}}, {"result": {"content": []}}):
            with self.subTest(payload=payload):
                self.failure = lambda body, p=payload: (Resp(status=200, body=json.dumps(
                    {"jsonrpc": "2.0", "id": body.get("id"), **p}).encode())
                    if body["method"] == "tools/call" else None)
                self.assertEqual(self.run_check().status, "fail")

    def test_malformed_needs_is_not_missing_snapshot(self):
        self.needs = {"entity_id": ENTITY}
        self.assertEqual(self.run_check().status, "fail")

    def test_sse_session_and_protocol(self):
        self.sse = True
        self.assertNotEqual(self.run_check().status, "fail")

    def test_no_raw_data_or_secret_in_renderers(self):
        result = self.run_check()
        rep = Report(slug="boulder-creek", started_at="test", checks=[result])
        rep.notes.append(TOKEN)  # renderer redaction remains effective beyond this check
        for output in (render_json(rep, self.ctx.secrets.redact), render_text(rep, self.ctx.secrets.redact)):
            self.assertNotIn(TOKEN, output)
            self.assertNotIn("coordinates", output)
            self.assertNotIn("session-private", output)

    def test_profile_only_inspected_when_explicit(self):
        with patch.object(agent, "load_yaml", side_effect=AssertionError("must not read default profile")):
            self.run_check()
        self.ctx.env.update(KAMI_HERMES_PROFILE="beings-earth", HERMES_HOME=self.temp.name)
        profile = Path(self.temp.name) / "profiles/beings-earth"
        profile.mkdir(parents=True)
        (profile / "binding.json").write_text('{"binding_version":1}')
        result = self.run_check()
        self.assertEqual(next(s.status for s in result.steps if s.id == "agent.profile"), "warn")

    def test_rejects_insecure_platform_before_auth(self):
        self.ctx.env["PLATFORM_URL"] = "http://remote.example"
        self.assertEqual(self.run_check().status, "fail")
        self.assertEqual(self.requests, [])

    def test_missing_token_skips_without_network(self):
        self.ctx.env.pop("PLATFORM_MCP_TOKEN")
        self.assertEqual(self.run_check().status, "skipped")
        self.assertEqual(self.requests, [])

    def test_wrong_snapshot_identity_fails(self):
        self.needs["snapshot"]["entity_id"] = "entity/another-creek"
        self.assertEqual(self.run_check().status, "fail")

    def test_connection_failure_does_not_echo_exception(self):
        self.failure = lambda body: Resp(error="connection refused " + TOKEN)
        result = self.run_check()
        self.assertIn("connectivity failure", result.steps[-1].detail)
        self.assertNotIn(TOKEN, str(result.as_dict()))

    def test_redirect_is_not_followed_by_net(self):
        import urllib.error
        import net
        class Opener:
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 302, "redirect", {}, None)
        def build(handler):
            self.assertIsNone(handler.redirect_request(None, None, 302, "redirect", {}, "https://other.test"))
            return Opener()
        with patch("urllib.request.build_opener", build), patch("urllib.request.urlopen", side_effect=AssertionError("must not follow")):
            response = net.request("https://beings.test/api/mcp", follow_redirects=False,
                                   headers={"Authorization": "Bearer " + TOKEN})
        self.assertEqual(response.status, 302)

    def test_agent_selection_is_isolated(self):
        self.assertEqual(selected(parse_args(["--only", "agent"])), (["agent"], []))


if __name__ == "__main__":
    unittest.main()
