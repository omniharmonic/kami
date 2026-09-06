# facts-1.0

The fact-sheet schema shared by the twin MCP (emitter), the twin's briefing generator (emitter, upstream), and `factguard` (matcher). One schema, two emitters, one matcher (architecture §15 #5). Copies must be byte-identical: `packages/twin-mcp/schemas/facts-1.0.json` and `packages/factguard/src/factguard/schemas/facts-1.0.json` are checked against this file by a test in each package.
