/** Visual terrain only. Never import this geographic asset into an agent tool. */
export type TerrainGrid = {size:number; heights:number[]; bounds:[number,number,number,number]};
export function validTerrain(value:unknown): value is TerrainGrid {
 if (!value || typeof value !== 'object') return false;
 const grid=value as TerrainGrid;
 return Number.isInteger(grid.size) && grid.size>1 && grid.size<512 && Array.isArray(grid.heights) && grid.heights.length===grid.size**2 && grid.heights.every(Number.isFinite) && Array.isArray(grid.bounds) && grid.bounds.length===4 && grid.bounds.every(Number.isFinite);
}
export function terrainHeight(grid:TerrainGrid,x:number,z:number):number {
 const u=Math.max(0,Math.min(grid.size-1,(x/150+.5)*(grid.size-1)));
 const v=Math.max(0,Math.min(grid.size-1,(z/162+.5)*(grid.size-1)));
 const a=Math.floor(u),b=Math.floor(v),c=Math.min(grid.size-1,a+1),d=Math.min(grid.size-1,b+1);
 const at=(i:number,j:number)=>grid.heights[j*grid.size+i]!;
 const elevation=(at(a,b)*(1-u+a)+at(c,b)*(u-a))*(1-v+b)+(at(a,d)*(1-u+a)+at(c,d)*(u-a))*(v-b);
 // 150 scene units cover ~72 km east-west; 2.5× vertical exaggeration.
 return Math.max(.1,(elevation-1450)/480*2.5);
}
