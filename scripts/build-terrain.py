"""Bake public Mapzen DEM into a compact, reproducible Front Range elevation grid.
Run with Python + Pillow. Geographic data stays in renderer assets, never MCP.
Source/licensing: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
"""
import io,json,math,pathlib,urllib.request
from PIL import Image
west,south,east,north=-105.8,39.65,-104.95,40.35
zoom=9; size=193; tiles={}
def pixel(lon,lat):
 return ((lon+180)/360*2**zoom*256,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**zoom*256)
def elevation(lon,lat):
 x,y=pixel(lon,lat); tx,ty=int(x)//256,int(y)//256
 if (tx,ty) not in tiles:
  url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png'
  tiles[tx,ty]=Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB')
 r,g,b=tiles[tx,ty].getpixel((int(x)%256,int(y)%256))
 return round(r*256+g+b/256-32768)
heights=[elevation(west+(east-west)*x/(size-1),north-(north-south)*y/(size-1)) for y in range(size) for x in range(size)]
out={'source':'Mapzen Terrain Tiles / AWS Open Data','attribution':'United States 3DEP and global GMTED2010/SRTM terrain data courtesy of the U.S. Geological Survey.','license':'US public-domain elevation; see source attribution for dataset conditions.','source_url':'https://registry.opendata.aws/terrain-tiles/','attribution_url':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md','bounds':[west,south,east,north],'size':size,'unit':'m','sampling':'nearest DEM pixel; zoom 9; 193 by 193 grid','heights':heights}
path=pathlib.Path(__file__).resolve().parents[1]/'apps/web/public/world/front-range-dem.json'
path.write_text(json.dumps(out,separators=(',',':'))+'\n')
print(f'Wrote {path.name}: {len(heights)} elevations, {min(heights)}–{max(heights)} m, {len(tiles)} source tiles')
