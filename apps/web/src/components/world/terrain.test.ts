import {describe,it,expect} from 'vitest';
import {terrainHeight,validTerrain} from './terrain';
describe('visual DEM',()=>{
 it('rejects missing or corrupt height samples instead of fabricating terrain',()=>{
  expect(validTerrain({size:2,heights:[1,2,3],bounds:[0,0,1,1]})).toBe(false);
  expect(validTerrain({size:2,heights:[1,2,3,NaN],bounds:[0,0,1,1]})).toBe(false);
 });
 it('preserves west/east and north/south samples with documented relief scaling',()=>{
  const grid={size:2,heights:[1450,1930,2410,2890],bounds:[0,0,1,1] as [number,number,number,number]};
  expect(validTerrain(grid)).toBe(true);
  expect(terrainHeight(grid,75,-81)).toBe(2.5);
  expect(terrainHeight(grid,-75,81)).toBe(5);
  expect(terrainHeight(grid,0,0)).toBe(3.75);
 });
});
