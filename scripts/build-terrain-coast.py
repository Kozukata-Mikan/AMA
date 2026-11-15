"""Build the bundled approximate coastline; input: official ne_10m_land.zip (public domain)."""
import sys,zipfile,tempfile,json,pathlib,hashlib,gzip,base64
import shapefile
from shapely.geometry import shape
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
polygons=[]
with tempfile.TemporaryDirectory() as directory:
 with zipfile.ZipFile(source) as archive:archive.extractall(directory)
 reader=shapefile.Reader(str(next(pathlib.Path(directory).glob('*.shp'))))
 for item in reader.shapes():
  geom=shape(item.__geo_interface__).simplify(.002,preserve_topology=True)
  for polygon in (geom.geoms if geom.geom_type=='MultiPolygon' else [geom]):
   rings=[]
   for ring in [polygon.exterior,*polygon.interiors]:
    points=[[round(x*10000),round(y*10000)] for x,y in ring.coords]
    points=[p for i,p in enumerate(points) if i==0 or p!=points[i-1]]
    if len(points)>=4:rings.append(points[0]+[v for a,b in zip(points,points[1:]) for v in [b[0]-a[0],b[1]-a[1]]])
   if rings:polygons.append({'b':[round(v*10000) for v in polygon.bounds],'r':rings})
data={'version':1,'scale':10000,'encoding':'delta','source':'Natural Earth 1:10m land v5.1.1; simplified 0.002 degrees','sourceUrl':'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/','license':'Public domain','archiveSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'polygons':polygons}
target.write_text(base64.b64encode(gzip.compress(json.dumps(data,separators=(',',':')).encode(),mtime=0)).decode())
print(json.dumps({'polygons':len(polygons),'bytes':target.stat().st_size,'points':sum(len(r)//2 for p in polygons for r in p['r'])}))
