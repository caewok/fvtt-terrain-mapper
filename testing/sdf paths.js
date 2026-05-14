/* Terrain path forcing using SDFs.

From 3d point a --> 3d point b, find a path considering elevated terrain.

1. Walking path.

For each SDF object, first need its 2d intersection points along the path a|b, identified as t values.
This tells us:
1. What SDFs to use in the scene at a given location
2. How far to the edge of the current surface SDF(s).

2. Flying path.
Identify each SDF object hit via straight path. Attempt to fly to top along each
(convex hull). If the hull path hits an object, that object must be floating; go below it.

3. Burrowing path.
Like walking but move through objects using -distance.

*/

AABB2d = CONFIG.GeometryLib.lib.AABB2d
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
Plane = CONFIG.GeometryLib.lib.threeD.Plane

// Create SDF object for each placeable
tileSDFs = canvas.tiles.placeables.map(tile => new TileSDF(tile));
regionSDFs = canvas.regions.placeables.map(region => new RegionSDF(region));
sceneSDFs = [...tileSDFs, ...regionSDFs];

// Identify the first intersection point for each placeable.
// For single shapes, identify the end point.
// For multiple shapes, identify the end points.

/**
 * Round to the nearest decimal.
 * @param {number} n			Number to round
 * @param {number}[decimals=2]		Number of decimals to round to
 * @returns {number}
 */
function roundToDecimal(n, decimals = 2) {
  const c = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * c) / c;
}

/**
 * Identify the t-value on segment A|B closest to C.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment AB
 * @param {Point} b     Point B on segment AB
 * @returns {number}    T-value, where 0 is a and 1 is b. Negative numbers are before a; >1 is after b.
 * @see {@link https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line#Line_defined_by_two_points}
 */
function closestPointToSegmentTSquared(c, a, b) {
  using d = b.subtract(a);
  if ( d.x === 0 && d.y === 0 ) return 0;
  
  using ca = c.subtract(a);
  return ca.dot(d) ** 2 // / d.dot(d);  
}

lizard = canvas.tokens.placeables.find(t => t.name === "Giant Lizard")
ape = canvas.tokens.placeables.find(t => t.name === "Giant Ape")

start = GridCoordinates3d.fromTokenCenter(lizard)
end = GridCoordinates3d.fromTokenCenter(ape)

start.elevation = 20
end.elevation = 20

// Get all sdfs in the scene.
sceneSDFMap = new Map();
sceneSDFTValues = new Map();
maxTIndex = [];



sdfIndex = [];

sdfIndexMap = new Map(); 
sdfPlaceableMap = new Map();

rayOrigin = start.to2d()
rayDirection = end.to2d().subtract(rayOrigin).normalize()
maxT = PIXI.Point.distanceBetween(start, end)
for ( const placeableSDF of sceneSDFs ) {
  const ts = placeableSDF.isSingleShape
    ? SDF.raymarchDual(rayOrigin, rayDirection, placeableSDF.sdf2d())
      : SDF.findAllIntersections(rayOrigin, rayDirection, placeableSDF.sdf2d());
  if ( !ts.length ) continue;
  
  sceneSDFMap.set(placeableSDF, placeableSDF.sdf3d())
  let sdfMaxT = Number.NEGATIVE_INFINITY;
  ts.forEach(t => {
    sdfMaxT = Math.max(sdfMaxT, t);
  
    if ( t > maxT ) return;
    const node = sdfIndexMap.get(roundToDecimal(t)) || new Set();
    node.add(placeableSDF);	
    sdfIndexMap.set(roundToDecimal(t), node);
    
    const arr = sceneSDFTValues.get(placeableSDF) || [];
    arr.push(t ** 2); // Round to nearest pixel?
    sceneSDFTValues.set(placeableSDF, arr);
  });
  sdfIndex.push(...ts);   
  maxTIndex.push({ maxT: sdfMaxT, sdf: placeableSDF });
  
  sdfPlaceableMap.set(placeableSDF.placeable, ts) 
}

sceneSDFTValues.values().forEach(arr => arr.sort((a, b) => b - a)); // reverse sort

maxTIndex.sort((a, b) => b.maxT - a.maxT); // reverse sort
sdfIndex.sort((a, b) => a - b);
Draw.segment({ a: start, b: end })
sdfIndex.forEach(t => Draw.point(rayOrigin.add(rayDirection.multiplyScalar(t))))

// Walk 3d path. 



floorPlane = new Plane()	; // Defaults to scene 0. Set the point if the floor is above 0. (E.g., levels)
floorSDF = p => SDF.sdPlane(p, floorPlane);
sceneSDFMap.set("floor", floorSDF);
sceneSDFTValues.set("floor", [Number.POSITIVE_INFINITY])

[...sceneSDFMap.values()].map(sdf => sdf(start))

// Start with full set and drop as we progress.

sceneSDF = p => SDF.union(...sceneSDFMap.values().map(sdf => sdf(p)))
rayDirection3d = end.subtract(start).normalize()



currPosition = start.clone();
checkpoints = [currPosition.clone()];
currDirection = rayDirection3d.clone()
currT = 0;
onSurface = false;
down = Point3d.tmp.set(0, 0, -1);
surfaceSDFs = new Set();
tmp = Point3d.tmp;
dist2 = Point3d.distanceSquaredBetween(start, end)

[...sceneSDFMap.values()].map(sdf => sdf(currPosition))


while ( closestPointToSegmentTSquared(currPosition, start, end) < dist2 ) {
  
  if ( !surfaceSDFs.size ) {
    // Determine the nearest surface and move that way.
    let minT = Number.POSITIVE_INFINITY;
    for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
      const t = sdfFn(currPosition);
      minT = Math.min(minT, t);
      if ( t.almostEqual(0) ) surfaceSDFs.add(sdf);
      
      // Need to modify direction for the new surface.
      // Requires determining gradient.
      
    }
    
    if ( !surfaceSDFs.size ) {
      // Move straight down.
      currPosition.add(down.multiplyScalar(Math.sqrt(Math.abs(minT)), tmp), currPosition);
    }
    
  } else {
  
		// Move along the surface to either:
		// 1. The next t for this surface.
		// 2. The next intersected object, not counting this surface.
		let minT = Number.POSITIVE_INFINITY;
		let minSDF;
		for ( const [sdf, sdfFn] of sceneSDFMap.entries() ) {
			if ( surfaceSDFs.has(sdf) ) {
				// Next t for this surface.
				const ts = sceneSDFTValues.get(sdf);
				while ( ts.length && ts.at(-1) < currT ) ts.pop();
				if ( ts.length ) {
					if ( ts.at(-1) < minT ) {
						minT = ts.at(-1);
						minSDF = sdf;
					}
				} else {
					sceneSDFTValues.delete(sdf);
					surfaceSDFs.delete(sdf);
				}
			} else {
				// Next intersected object.
				const t = sdfFn(currPosition);
				if ( t < minT ) {
					minT = t;
					minSDF = sdf;
				}
			}
		}
		
		
		// How to adjust direction to follow the surface? How to resolve competing surfaces?
		
		if ( minT.almostEqual(0) ) {
			// We hit something or reached a surface end.
			if ( surfaceSDFs.has(minSDF) ) {
				// If at surface end, move single pixel to pass it.
				surfaceSDFs.delete(minSDF);
				currPosition.add(currDirection, currPosition);
				
			} else {
				// If hit something, need to possibly move vertically or along a ramp. "Surface" can be non-horizontal.
				// Move forward and back 1 pixel to calculate gradient.
				
				
			}
		} else {
			// Move along.
			currPosition.add(currDirection.multiplyScalar(minT, currPosition), currPosition);
		}  
  }
  
  checkpoints.push(currPosition.clone())
  
  // Drop SDFs behind this t.
  while ( maxTIndex.length ) {
    const { maxT, sdf } = maxTIndex.at(-1);
    if ( maxT < currT ) {
      maxTIndex.pop();
      surfaceSDFs.delete(sdf);
      sceneSDFMap.delete(sdf);
      sceneSDFTValues.delete(sdf);
    } else break;
  }
  
}






// Versus using polygon shapes with proper intersections
scenePlaceables = [...canvas.tiles.placeables, ...canvas.regions.placeables];
tOpts = { minT: Number.NEGATIVE_INFINITY, maxT: Number.POSITIVE_INFINITY };
for ( const placeable of scenePlaceables ) {
  const geom = placeable.GeometryLib.geometry;
  const ts = [];
  geom.iterateFaces(face => {
    const t = geom.constructor.rayIntersectionForFace(face, rayOrigin, rayDirection, tOpts);
    if ( t !== null ) ts.push(t);
  });
}



