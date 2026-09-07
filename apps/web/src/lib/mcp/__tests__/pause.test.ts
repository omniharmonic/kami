import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { NOW, seedBoulderCreek } from "@/lib/jobs/__tests__/helpers";
import { postUpdate, draftBounty, getEntityConfig, type ToolContext } from "../tools";
import { handleMcpRequest } from "../server";
import { mintEntityToken } from "../tokens";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const dbs:TestDb[]=[];
afterAll(async()=>{await Promise.all(dbs.map(closeTestDb));});

describe("MCP pause boundary",()=>{
 it("rechecks persisted pause for every write, even when the request context was active",async()=>{
  const {db,entity}=await seedBoulderCreek({slug:"pause-race"});dbs.push(db);
  const ctx:ToolContext={db,entity,binding:null,now:NOW};
  expect(entity.pausedAt).toBeNull();
  await db.update(schema.entities).set({pausedAt:NOW}).where(eq(schema.entities.id,entity.id));
  const before=await db.select().from(schema.entityEvents);
  for(const kind of ["pulse","reflection","note","strategy","donor_report"]){
   await expect(postUpdate(ctx,{kind,text:"A draft that must never persist."})).rejects.toMatchObject({code:"paused"});
  }
  await expect(draftBounty(ctx,{})).rejects.toMatchObject({code:"paused"});
  for(const table of [schema.pulses,schema.strategies,schema.donorReports,schema.bounties]){
   expect(await db.select().from(table)).toHaveLength(0);
  }
  expect(await db.select().from(schema.entityEvents)).toEqual(before);
  // Diagnostics remain readable while agent output is disabled.
  const fresh={...ctx,entity:{...entity,pausedAt:NOW}};
  expect((await getEntityConfig(fresh)).config).toMatchObject({paused:true,agent_writes_allowed:false,agent_write_block_reason:"paused"});
 });
 it("retirement invalidates a previously loaded active write context",async()=>{
  const {db,entity}=await seedBoulderCreek({slug:"retirement-race"});dbs.push(db);
  const ctx:ToolContext={db,entity,binding:null,now:NOW};
  await db.update(schema.entities).set({retiredAt:NOW}).where(eq(schema.entities.id,entity.id));
  await expect(postUpdate(ctx,{kind:"note",text:"Do not store"})).rejects.toMatchObject({code:"retired"});
  await expect(draftBounty(ctx,{})).rejects.toMatchObject({code:"retired"});
  expect((await getEntityConfig({...ctx,entity:{...entity,retiredAt:NOW}})).config).toMatchObject({agent_writes_allowed:false,agent_write_block_reason:"retired"});
 });
 it("authenticates first and returns a paused tool error to authenticated agents",async()=>{
  const {db}=await seedBoulderCreek({slug:"paused-http",paused:true});dbs.push(db);
  const {token}=await mintEntityToken(db,"paused-http",NOW);
  const call=(bearer?:string)=>handleMcpRequest(new Request("https://kami.test/api/mcp",{
   method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",...(bearer?{authorization:`Bearer ${bearer}`}:{})},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"post_update",arguments:{kind:"note",text:"No write"}}})
  }),{db,now:NOW});
  expect((await call()).status).toBe(401);
  const response=await call(token);expect(response.status).toBe(200);
  const result=await response.json();
  expect(result.result.isError).toBe(true);
  expect(result.result.structuredContent.error).toBe("paused");
  expect(await db.select().from(schema.pulses)).toHaveLength(0);
 });
 it("holds every agent write for a pending binding while preserving read access",async()=>{
  const {db,entity}=await seedBoulderCreek({slug:"pending-write",review:"pending_review"});dbs.push(db);
  const ctx:ToolContext={db,entity,binding:null,now:NOW};
  expect((await getEntityConfig(ctx)).config).toMatchObject({agent_writes_allowed:false,agent_write_block_reason:"binding_pending_review"});
  for(const kind of ["pulse","reflection","note","strategy","donor_report"]){
   await expect(postUpdate(ctx,{kind,text:"Not reviewed yet"})).rejects.toMatchObject({code:"binding_unavailable"});
  }
  await expect(draftBounty(ctx,{})).rejects.toMatchObject({code:"binding_unavailable"});
  expect(await db.select().from(schema.pulses)).toHaveLength(0);
  expect(await db.select().from(schema.strategies)).toHaveLength(0);
  expect(await db.select().from(schema.entityEvents)).toHaveLength(0);
 });

});
