import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), board: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/entity-access", () => ({ requireVisibleEntity: mocks.access }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/grants", () => ({ getGrantBoard: mocks.board }));
vi.mock("@/components/grants/GrantForm", () => ({ GrantForm: () => null }));
import GrantsPage from "../page";
beforeEach(() => vi.clearAllMocks());
describe("grants access", () => {
  it("refuses a private entity before reading rounds or a session", async () => {
    mocks.access.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(GrantsPage({ params: Promise.resolve({ slug: "private" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.board).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("passes only the authorized entity and actual viewer to the board query", async () => {
    mocks.access.mockResolvedValue({ entity: { id: "entity/private", paused: true } });
    mocks.session.mockResolvedValue({ user: { id: "steward" } });
    mocks.board.mockResolvedValue({ mayManage: true, rounds: [], eligibleProposals: [] });
    expect(await GrantsPage({ params: Promise.resolve({ slug: "private" }) })).toBeTruthy();
    expect(mocks.board).toHaveBeenCalledWith({}, "entity/private", "steward");
  });
});
