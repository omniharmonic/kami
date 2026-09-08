import {describe,expect,it} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {createTestDb,closeTestDb,migrationsFolder,seedEntity} from "../test-utils";

describe("independent entity publication migration",()=>{
 it("preserves historical visibility and does not couple future consultation to publication",async()=>{
  const pg=new PGlite();
  try{
   for(const name of ["0000_init.sql","0001_evaluator_independence.sql","0002_entity_events_append_only.sql","0003_grant_rounds.sql"]){
    await pg.exec(await readFile(path.join(migrationsFolder,name),"utf8"));
   }
   await pg.exec(`INSERT INTO entities(id,slug,name,archetype,consultation_done_at)
    VALUES('entity/public-creek','public-creek','Public Creek','creek','2026-08-01T00:00:00Z'),
    ('entity/boulder-creek','boulder-creek','Boulder Creek','creek',NULL);`);
   await pg.exec(await readFile(path.join(migrationsFolder,"0004_entity_publication.sql"),"utf8"));
   const result=await pg.query<{slug:string;published_at:Date|null;consultation_done_at:Date|null}>("select slug,published_at,consultation_done_at from entities order by slug");
   expect(result.rows[0]?.slug).toBe("boulder-creek");expect(result.rows[0]?.published_at).toBeNull();
   expect(result.rows[1]?.published_at?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
   expect(result.rows[1]?.published_at).toEqual(result.rows[1]?.consultation_done_at);
   await pg.exec("UPDATE entities SET consultation_done_at=now() WHERE slug='boulder-creek'");
   expect((await pg.query<{published_at:Date|null}>("select published_at from entities where slug='boulder-creek'")).rows[0]?.published_at).toBeNull();
   await pg.exec("UPDATE entities SET consultation_done_at=NULL,published_at='2026-09-07T12:00:00Z' WHERE slug='boulder-creek'");
   const independent=await pg.query<{published_at:Date|null;consultation_done_at:Date|null}>("select published_at,consultation_done_at from entities where slug='boulder-creek'");
   expect(independent.rows[0]?.published_at?.toISOString()).toBe("2026-09-07T12:00:00.000Z");expect(independent.rows[0]?.consultation_done_at).toBeNull();
  }finally{await pg.close();}
 });
 it("seeds legacy fixture visibility but permits independent publication",async()=>{
  const db=await createTestDb();
  try{
   const legacy=await seedEntity(db,{slug:"legacy-public"});expect(legacy.publishedAt).not.toBeNull();
   const privateEntity=await seedEntity(db,{slug:"legacy-private",consultationDone:false});expect(privateEntity.publishedAt).toBeNull();
   const published=await seedEntity(db,{slug:"independent-public",consultationDone:false,published:true});expect(published.publishedAt).not.toBeNull();expect(published.consultationDoneAt).toBeNull();
   const privateConsulted=await seedEntity(db,{slug:"independent-private",consultationDone:true,published:false});expect(privateConsulted.publishedAt).toBeNull();expect(privateConsulted.consultationDoneAt).not.toBeNull();
  }finally{await closeTestDb(db);}
 });
});
