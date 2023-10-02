/* globals

*/
"use strict";

// GLSL functions

export let GLSLFunctions = {};
export let GLSLStructs = {};

/**
 * Utility to wrap a function definition in #ifndef.
 * @param {string} method
 * @returns {string}
 */
export const defineFunction = (method, lookup = method) =>
`#ifndef TM_${method.toUpperCase()}
#define TM_${method.toUpperCase()} true
${GLSLFunctions[lookup]}
#endif
`;

/**
 * Utility to wrap a strut definition in #ifndef.
 * @param {string} struct
 * @returns {string}
 */
export const defineStruct = struct =>
`#ifndef TM_${struct.toUpperCase()}
#define TM_${struct.toUpperCase()} true
${GLSLStructs[struct]}
#endif`;


// NOTE: Utility
GLSLFunctions.between =
// See https://stackoverflow.com/questions/52958171/glsl-optimization-check-if-variable-is-within-range
// step is (float, float) or (float, vec) or (vec, vec)
`
/**
 * Is x in the range of [a, b]?
 * @returns {0|1}
 */
float between(in float a, in float b, in float x) { return step(a, x) * step(x, b); }
vec2 between(in float a, in float b, in vec2 x) { return step(a, x) * step(x, vec2(b)); }
vec3 between(in float a, in float b, in vec3 x) { return step(a, x) * step(x, vec3(b)); }
`;

GLSLFunctions.linearConversion =
`
/**
 * Linear conversion from one range to another.
 */
float linearConversion(in float x, in float oldMin, in float oldMax, in float newMin, in float newMax) {
  return (((x - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}`;

// Name of a built-in function cannot be redeclared as function, so call it cross2d
GLSLFunctions.cross2d =
`
/**
 * Cross x and y parameters in a vec2.
 * @param {vec2} a  First vector
 * @param {vec2} b  Second vector
 * @returns {float} The cross product
 */
float cross2d(in vec2 a, in vec2 b) { return (a.x * b.y) - (a.y * b.x); }
`;

// Comparable to Ray.fromAngle
GLSLFunctions.fromAngle =
`
/**
 * @param {vec2} origin     Starting point
 * @param {float} radians   Angle to move from the starting point
 * @param {float} distance  Distance to travel from the starting point
 * @returns {vec2}  Coordinates of a point that lies distance away from origin along angle.
 */
vec2 fromAngle(in vec2 origin, in float radians, in float distance) {
  float dx = cos(radians);
  float dy = sin(radians);
  return origin + (vec2(dx, dy) * distance);
}`;

GLSLFunctions.toRadians =
`
/**
 * Convert degrees to radians.
 * @param {float} angle
 * @returns {float} radians
 */
float toRadians(in float angle) {
  // PI_1_180 = PI / 180
  #ifndef PI_1_180
  #define PI_1_180 0.017453292519943295
  #endif
  return mod(angle, 360.0) * PI_1_180;
}`;

GLSLFunctions.toDegrees =
`
/**
 * Convert radians to degrees.
 * @param {float} radians
 * @returns {float} degrees
 */
float toDegrees(in float radians) {
  // PI_1_180_INV = 180 / PI
  #ifndef PI_1_180_INV
  #define PI_1_180_INV 57.29577951308232
  #endif
  return radians * PI_1_180_INV;
}`;

GLSLFunctions.angleBetween =
`
/**
 * Get the angle between three 2d points, A --> B --> C.
 * Assumes A|B and B|C have lengths > 0.
 * @param {vec2} a   First point
 * @param {vec2} b   Second point
 * @param {vec2} c   Third point
 * @returns {float}  CW angle, in radians. CW from C to A. 0º to 360º, in radians
 */
float angleBetween(in vec2 a, in vec2 b, in vec2 c) {
  #ifndef PI_2
  #define PI_2 6.283185307179586
  #endif

  vec2 ba = a - b;
  vec2 bc = c - b;
  float denom = distance(a, b) * distance(b, c);
  if ( denom == 0.0 ) return 0.0;

  float dot = dot(ba, bc);
  float angle = acos(dot / denom);
  if ( orient(a, b, c) > 0.0 ) angle -= PI_2; // Ensure the CW angle from C to A is returned.
  return angle;
}`;

GLSLFunctions.wallKeyCoordinates =
`
/**
 * Invert a wall key to get the coordinates.
 * Key = (MAX_TEXTURE_SIZE * x) + y, where x and y are integers.
 * @param {float} key
 * @returns {vec2} coordinates
 */
vec2 wallKeyCoordinates(in float key) {
  #ifndef EV_MAX_TEXTURE_SIZE
  #define EV_MAX_TEXTURE_SIZE 65536.0
  #endif
  #ifndef EV_MAX_TEXTURE_SIZE_INV
  #define EV_MAX_TEXTURE_SIZE_INV 1.0 / EV_MAX_TEXTURE_SIZE
  #endif

  float x = floor(key * EV_MAX_TEXTURE_SIZE_INV);
  float y = key - (EV_MAX_TEXTURE_SIZE * x);
  return vec2(x, y);
}`;

// NOTE: Matrix
GLSLFunctions.MatrixTranslation =
`
// Translate a given x/y amount.
// [1, 0, x]
// [0, 1, y]
// [0, 0, 1]
mat3 MatrixTranslation(in float x, in float y) {
  mat3 tMat = mat3(1.0);
  tMat[2] = vec3(x, y, 1.0);
  return tMat;
}`;

GLSLFunctions.MatrixScale =
`
// Scale using x/y value.
// [x, 0, 0]
// [0, y, 0]
// [0, 0, 1]
mat3 MatrixScale(in float x, in float y) {
  mat3 scaleMat = mat3(1.0);
  scaleMat[0][0] = x;
  scaleMat[1][1] = y;
  return scaleMat;
}`;

// Must have same return type for all declarations of a named function with same params, so separate 2d/3d
GLSLFunctions.Matrix2dRotationZ =
`
// Rotation around the z-axis.
// [c, -s, 0],
// [s, c, 0],
// [0, 0, 1]
mat3 Matrix2dRotationZ(in float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat3 rotMat = mat3(1.0);
  rotMat[0][0] = c;
  rotMat[1][1] = c;
  rotMat[1][0] = -s;
  rotMat[0][1] = s;
  return rotMat;
}`;

GLSLFunctions.Matrix3dRotationZ =
`
// Rotation around the z-axis.
// [c, -s, 0, 0],
// [s, c, 0, 0],
// [0, 0, 1, 0],
// [0, 0, 0, 1]
mat4 Matrix3dRotationZ(in float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat4 rotMat = mat4(1.0);
  rotMat[0][0] = c;
  rotMat[1][1] = c;
  rotMat[1][0] = -s;
  rotMat[0][1] = s;
  return rotMat;
}`;

GLSLFunctions.multiplyMatrixPoint =
`
vec2 multiplyMatrixPoint(mat3 m, vec2 pt) {
  vec3 res = m * vec3(pt, 1.0);
  return vec2(res.xy / res.z);
}

vec3 multiplyMatrixPoint(mat4 m, vec3 pt) {
  vec4 res = m * vec4(pt, 1.0);
  return vec3(res.xyz / res.w);
}`;

GLSLFunctions.toLocalRectangle =
`
mat3 toLocalRectangle(in vec2[4] rect) {
  // TL is 0, 0.
  // T --> B : y: 0 --> 1
  // L --> R : x: 0 --> 1
  vec2 bl = rect[0];
  vec2 br = rect[1];
  vec2 tr = rect[2];
  vec2 tl = rect[3];

  vec2 delta = tr - tl;
  float angle = atan(delta.y, delta.x);

  mat3 mTranslate = MatrixTranslation(-tl.x, -tl.y);
  mat3 mRotate = MatrixRotationZ(-angle);

  mat3 mShift = mRotate * mTranslate;
  vec2 trShifted = multiplyMatrixPoint(mShift, tr);
  vec2 blShifted = multiplyMatrixPoint(mShift, bl);

  mat3 mScale = MatrixScale(1.0 / trShifted.x, 1.0 / blShifted.y);
  return mScale * mShift;
}
`;

// NOTE: Random
// Pass a value and get a random normalized value between 0 and 1.
// https://github.com/patriciogonzalezvivo/lygia/blob/main/generative/random.glsl
GLSLFunctions.random =
`
#define RANDOM_SCALE vec4(443.897, 441.423, .0973, .1099)

float random(in float x) {
  x = fract(x * RANDOM_SCALE.x);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

vec2 random2(vec3 p3) {
  p3 = fract(p3 * RANDOM_SCALE.xyz);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec2 random2(vec2 p) { return random2(p.xyx); }
`;

// NOTE: Terrains
GLSLFunctions.decodeTerrainChannels =
`
/**
 * Return the terrain value for a given color representation at a given layer.
 * @param {vec4} pixel    Color representation of terrain value on canvas
 * @returns {float} The terrain value, between 0 and 31.
 */
uint decodeTerrainChannels(in vec4 color, in int layer) {
  color *= 255.0;
  uvec4 channels = uvec4(color);

  uint terrain;
  switch ( layer ) {
    // Red
    case 0:
      terrain = (channels.r & 15u);
      break;
    case 1:
      terrain = (channels.r >> 4u);
      break;

    // Green
    case 2:
      terrain = (channels.g & 15u);
      break;
    case 3:
      terrain = (channels.g >> 4u);
      break;

    // Blue
    case 4:
      terrain = (channels.b & 15u);
      break;
    case 5:
      terrain = (channels.b >> 4u);
      break;
  }

  return terrain;
}`;


// NOTE: Canvas elevation
GLSLFunctions.decodeElevationChannels =
`
/**
 * Return the normalized elevation value for a given color representation.
 * @param {vec4} pixel    Color representation of elevation value on canvas
 * @returns {float} The normalized elevation value, between 0 and 65,536.
 */
float decodeElevationChannels(in vec4 color) {
  color *= 255.0;
  return (color.g * 256.0) + color.r;
}`;

GLSLFunctions.scaleNormalizedElevation =
`
/**
 * Return the scaled elevation value for a given normalized value.
 * @param {float} value         The normalized elevation between 0 and 65,536
 * @param {float} elevationMin  Minimum elevation for the scene
 * @param {float} elevationStep Elevation step size for the scene
 * @returns {float} Scaled elevation value based on scene settings, in grid units
 */
float scaleNormalizedElevation(in float value, in float elevationMin, in float elevationStep) {
  return elevationMin + (round(value * elevationStep * 10.0) * 0.1);
}`;

GLSLFunctions.gridUnitsToPixels =
`
/**
 * Convert grid to pixel units.
 * @param {float} value     Number, in grid units
 * @param {float} gridDist  Pixel distance
 * @returns {float} The equivalent number in pixel units based on grid distance
 */
float gridUnitsToPixels(in float value, in float gridDist) {
  return value * gridDist;
}`;

GLSLFunctions.texelToElevationPixelUnits =
`
${defineFunction("decodeElevationChannels")}
${defineFunction("scaleNormalizedElevation")}
${defineFunction("gridUnitsToPixels")}

/**
 * Convert a color pixel pulled from elevation terrain texture to a scaled elevation value, in pixel units.
 * @param {vec4} evTexel          Texel pulled from elevation terrain texture
 * @param {vec4} elevationRes     Elevation resolution: min/step/max/pixel distance
 * @returns {float} Elevation value in pixel units.
 */
float texelToElevationPixelUnits(in vec4 evTexel, in vec4 elevationRes) {
  float e = decodeElevationChannels(evTexel);
  e = scaleNormalizedElevation(e, elevationRes.r, elevationRes.g);
  return gridUnitsToPixels(e, elevationRes.a);
}`;

GLSLFunctions.terrainElevation =
`
${defineFunction("texelToElevationPixelUnits")}

/**
 * Get the terrain elevation at this fragment.
 * vTerrainTexCoord must be scaled to the scene dimensions.
 * @param {sampler2D} terrainTex  The terrain elevation texture
 * @param {vec2} texCoord         The texture coordinate
 * @param {vec4} elevationRes     Elevation resolution: min/step/max/pixel distance
 * @returns {float}
 */
float terrainElevation(in sampler2D terrainTex, in vec2 texCoord, in vec4 elevationRes) {
  // If outside scene bounds, elevation is set to the minimum elevation.
  if ( !all(lessThan(texCoord, vec2(1.0)))
    || !all(greaterThan(texCoord, vec2(0.0))) ) return elevationRes.x;

  // Inside scene bounds. Pull elevation from the texture.
  vec4 evTexel = texture(terrainTex, texCoord);
  return texelToElevationPixelUnits(evTexel, elevationRes);
}`;

// NOTE: Orientation
// Orientation just like foundry.utils.orient2dFast
GLSLFunctions.orient =
`
float orient(in vec2 a, in vec2 b, in vec2 c) {
  return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
}
`;

GLSLFunctions.pointBetweenRays =
`
${defineFunction("orient")}

/**
 * Test whether a 2d location lies between two boundary rays.
 * @param {vec2} pt     Point to test
 * @param {vec2} v      Vertex point
 * @param {vec2} ccw    Counter-clockwise point
 * @param {vec2} cw     Clockwise point
 * @param {float} angle Angle being tested, in degrees
 * @returns {bool}
 */
bool pointBetweenRays(in vec2 pt, in vec2 v, in vec2 ccw, in vec2 cw, in float angle) {
  if ( angle > 180.0 ) {
    bool outside = orient(v, cw, pt) <= 0.0 && orient(v, ccw, pt) >= 0.0;
    return !outside;
  }
  return orient(v, ccw, pt) <= 0.0 && orient(v, cw, pt) >= 0.0;
}`;

// NOTE: Barycentric
// Calculate barycentric position within a given triangle
// For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
// See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
GLSLFunctions.barycentric =
`
// 3d barycentric
vec3 barycentric(in vec3 p, in vec3 a, in vec3 b, in vec3 c) {
  vec3 v0 = b - a; // Fixed for given triangle
  vec3 v1 = c - a; // Fixed for given triangle
  vec3 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}

// 2D barycentric
vec3 barycentric(in vec2 p, in vec2 a, in vec2 b, in vec2 c) {
  vec2 v0 = b - a;
  vec2 v1 = c - a;
  vec2 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}
`;

// https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
GLSLFunctions.barycentricPointInsideTriangle =
`
/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
bool barycentricPointInsideTriangle(in vec3 bary) {
  return bary.y >= 0.0 && bary.z >= 0.0 && (bary.y + bary.z) <= 1.0;
}`;

// NOTE: Ray struct
GLSLStructs.Ray =
`
/**
 * Ray defined by a point and a direction from that point.
 */
struct Ray {
  vec3 origin;
  vec3 direction;
};`;

GLSLStructs.Ray2d =
`
/**
 * Ray defined by a point and a direction from that point.
 */
struct Ray2d {
  vec2 origin;
  vec2 direction;
};`;

GLSLFunctions.rayFromPoints =
`
${defineStruct("Ray")}
${defineStruct("Ray2d")}

/**
 * Construct a ray from two points: origin and towards point.
 */
Ray rayFromPoints(in vec3 origin, in vec3 towardsPoint) {
  return Ray(origin, towardsPoint - origin);
}

Ray2d rayFromPoints(in vec2 origin, in vec2 towardsPoint) {
  return Ray2d(origin, towardsPoint - origin);
}`;


GLSLFunctions.normalizeRay =
`
${defineStruct("Ray")}
${defineStruct("Ray2d")}

/**
 * Normalize the ray direction.
 */
Ray normalizeRay(in Ray r) {
  return Ray(r.origin, normalize(r.direction));
}

Ray2d normalizeRay(in Ray2d r) {
  return Ray2d(r.origin, normalize(r.direction));
}`;

GLSLFunctions.projectRay =
`
${defineStruct("Ray")}
${defineStruct("Ray2d")}

/**
 * Project the ray a given distance multiplier of the ray length.
 * If ray is normalized, this will project the ray the given distance.
 */
vec2 projectRay(in Ray2d r, in float distanceMultiplier) {
  return r.origin + (r.direction * distanceMultiplier);
}

vec3 projectRay(in Ray r, in float distanceMultiplier) {
  return r.origin + (r.direction * distanceMultiplier);
}`;


// NOTE: Geometry lines

GLSLFunctions.distanceSquared =
`
float distanceSquared(in vec2 a, in vec2 b) {
  vec2 diff = b - a;
  return dot(diff, diff);
}

float distanceSquared(in vec3 a, in vec3 b) {
  vec3 diff = b - a;
  return dot(diff, diff);
}
`;

// Identify closest point on a 2d line to another point, just like foundry.utils.closestPointToSegment.
// Note: will fail if passed a 0-length ab segment.
GLSLFunctions.closest2dPointToLine =
`
vec2 closest2dPointToLine(in vec2 c, in vec2 a, in vec2 dir, out float u) {
  float denom = dot(dir, dir);
  if ( denom == 0.0 ) return a;

  vec2 deltaCA = c - a;
  u = dot(deltaCA, dir) / denom;
  return a + (u * dir);
}
`;

GLSLFunctions.closest2dPointToSegment =
`
${defineFunction("closest2dPointToLine")}

vec2 closest2dPointToSegment(in vec2 c, in vec2 a, in vec2 b) {
  float u;
  vec2 out = closest2dPointToLine(c, a, b - a, u);

  if ( u < 0.0 ) return a;
  if ( u > 1.0 ) return b;
  return out;
}`;

GLSLFunctions.lineLineIntersection =
`
${defineFunction("rayFromPoints")}
${defineFunction("cross2d")}

bool lineLineIntersection(in Ray2d a, in Ray2d b, out float t) {
  float denom = (b.direction.y * a.direction.x) - (b.direction.x * a.direction.y);

  // If lines are parallel, no intersection.
  if ( abs(denom) < 0.0001 ) return false;

  vec2 diff = a.origin - b.origin;
  t = cross2d(b.direction, diff) / denom;
  return true;
}

bool lineLineIntersection(in Ray2d a, in Ray2d b, out vec2 ix) {
  float t = 0.0;
  bool ixFound = lineLineIntersection(a, b, t);
  ix = a.origin + (a.direction * t);
  return ixFound;
}

bool lineLineIntersection(vec2 a, vec2 b, vec2 c, vec2 d, out vec2 ix) {
  Ray2d rayA = rayFromPoints(a, b);
  Ray2d rayB = rayFromPoints(c, d);
  return lineLineIntersection(rayA, rayB, ix);
}`;

// NOTE: Plane struct
GLSLStructs.Plane =
`
/**
 * Plane defined by a point on the plane and its normal.
 * This is the same, structurally, as a Ray, but included here for clarity.
 * Normal must be normalized.
 */
struct Plane  {
  vec3 point;
  vec3 normal;
};`;

// NOTE: Quad struct
GLSLStructs.Quad =
`
/**
 * Quad is defined by 4 corner points.
 /*
 * 0--b--3
 * |\
 * a c
 * |  \
 * 1    2
 */
struct Quad {
  vec3 v0;
  vec3 v1;
  vec3 v2;
  vec3 v3;
};`;

GLSLFunctions.quadFromPlane =
`
${defineStruct("Plane")}
${defineStruct("Quad")}

/**
 * Convert a Quad to a Plane by calculating the normal for the surface.
 */
Plane planeFromQuad(in Quad quad) {
  vec3 planePoint = v0;
  vec3 diff01 = v1 - v0;
  vec3 diff02 = v2 - v0;
  vec3 planeNormal = cross(diff01, diff02);
  return Plane(planePoint, normalize(planeNormal));
}`;

// NOTE: Plane/Quad intersections
GLSLFunctions.intersectRayPlane =
`
${defineStruct("Ray")}
${defineStruct("Plane")}

bool intersectRayPlane(in Ray r, in Plane P, out vec3 ix) {
  float denom = dot(P.normal, r.direction);

  // Check if line is parallel to the plane; no intersection
  if (abs(denom) < 0.0001) return false;

  float t = dot(P.normal, P.point - r.origin) / denom;
  ix = r.origin + r.direction * t;
  return true;
}`;

GLSLFunctions.intersectRayQuad =
`
${defineFunction("intersectRayPlane")}
${defineFunction("quadFromPlane")}

/**
 * Intersect a ray with a quad, storing the intersection in the ix out variable if found.
 * @param {Ray}   r      Ray to test. Must have normalized r.direction.
 * @param {Quad}  quad   Quad to test.
 * @param {vec3}  ix     Point variable in which to store the intersection if found.
 * @returns {bool} True if an intersection was found
 */
bool intersectRayQuad(in Ray r, in Quad quad, out vec3 ix) {
  Plane P = planeFromQuad()
  if ( !intersectRayPlane(r, P, ix) ) return false;

  // Check if the intersection point is within the bounds of the quad.
  vec3 quadMin = min(quad.v0, min(quad.v1, min(quad.v2, quad.v3)));
  vec3 quadMax = max(quad.v0, max(quad.v1, max(quad.v2, quad.v3)));
  return all(greaterThan(ix, quadMin)) && all(lessThan(ix, quadMax));
}`;

GLSLFunctions.quadIntersectBary =
`
${defineStruct("Ray")}
${defineStruct("Quad")}
${defineFunction("cross2d")}

/**
 * Quad intersect
 * https://www.shadertoy.com/view/XtlBDs
 * @param {vec3} ro   Ray origin
 * @param {vec3} rd   Ray direction (Need not be normalized)
 * @param {vec3} v0   Corner #0
 * @param {vec3} v1   Corner #1
 * @param {vec3} v2   Corner #2
 * @param {vec3} v3   Corner #3
 * 0--b--3
 * |\
 * a c
 * |  \
 * 1    2
 * @returns {vec3} Returns barycentric coords or vec3(-1.0) if no intersection.
 */
const int lut[4] = int[](1, 2, 0, 1);

bool baryIntersectRayQuad(in Ray r, in Quad quad, out vec3 ix) {
  // TODO: Use existing functions to intersect the plane.
  // Let's make v0 the origin.
  vec3 a = quad.v1 - quad.v0;
  vec3 b = quad.v3 - quad.v0;
  vec3 c = quad.v2 - quad.v0;
  vec3 p = r.origin - quad.v0;

  // Intersect plane.
  vec3 nor = cross(a, b);
  float t = -dot(p, nor) / dot(r.direction, nor);
  if ( t < 0.0 ) return false; // Parallel to plane

  // Intersection point.
  vec3 pos = p + (t * r.direction);

  // See here: https://www.shadertoy.com/view/lsBSDm.

  // Select projection plane.
  vec3 mor = abs(nor);
  int id = (mor.x > mor.y && mor.x > mor.z ) ? 0 : (mor.y > mor.z) ? 1 : 2;
  int idu = lut[id];
  int idv = lut[id + 1];

  // Project to 2D
  vec2 kp = vec2(pos[idu], pos[idv]);
  vec2 ka = vec2(a[idu], a[idv]);
  vec2 kb = vec2(b[idu], b[idv]);
  vec2 kc = vec2(c[idu], c[idv]);

  // Find barycentric coords of the quad.
  vec2 kg = kc - kb - ka;
  float k0 = cross2d(kp, kb);
  float k2 = cross2d(kc - kb, ka);  // Alt: float k2 = cross2d(kg, ka);
  float k1 = cross2d(kp, kg) - nor[id]; // Alt: float k1 = cross2d(kb, ka) + cross2d(kp, kg);

  float u;
  float v;
  if ( abs(k2) < 0.00001 ) { // TODO: use EPSILON?
    // Edges are parallel; this is a linear equation.
    v = -k0 / k1;
    u = cross2d(kp, ka) / k1;
  } else {
    // Otherwise, it's a quadratic.
    float w = (k1 * k1) - (4.0 * k0 * k2);
    if ( w < 0.0 ) return false;
    w = sqrt(w);
    float ik2 = 1.0 / (2.0 * k2);
    v = (-k1 - w) * ik2;
    if ( v < 0.0 || v > 1.0 ) v = (-k1 + w) * ik2;
    u = (kp.x - (ka.x * v)) / (kb.x + (kg.x * v));
  }

  ix = vec3(t, u, v);
  // if ( u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0 ) return vec3(-1.0);
  return true;
}
`;

// NOTE: Colors
GLSLFunctions.hsb2rgb =
`
/**
 * Convert a Hue-Saturation-Brightness color to RGB - useful to convert polar coordinates to RGB
 * See BaseShaderMixin.HSB2RGB
 * @type {string}
 */
vec3 hsb2rgb(in vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0 );
  rgb = rgb*rgb*(3.0-2.0*rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}`;

GLSLFunctions.rgb2hsv =
`
/**
 * From https://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
 * @param {vec3} c    RGB color representation (0–1)
 * @returns {vec3} HSV color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 rgb2hsv(in vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}`;

GLSLFunctions.hsv2rgb =
`
/**
 * From https://www.shadertoy.com/view/XljGzV.
 * @param {vec3} c    HSV color representation (0–1)
 * @returns {vec3} RGB color representation (0–1)
 */
// All components are in the range [0…1], including hue.
vec3 hsv2rgb(in vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}`;

// NOTE: Debugging
// For debugging.
GLSLFunctions.stepColor =
`
// 0: Black
// Red is near 0; blue is near 1.
// 0.5: purple
vec3 stepColor(in float ratio) {
  if ( ratio < 0.2 ) return vec3(smoothstep(0.0, 0.2, ratio), 0.0, 0.0);
  if ( ratio < 0.4 ) return vec3(smoothstep(0.2, 0.4, ratio), smoothstep(0.2, 0.4, ratio), 0.0);
  if ( ratio == 0.5 ) return vec3(0.5, 0.0, 0.5);
  if ( ratio < 0.6 ) return vec3(0.0, smoothstep(0.4, 0.6, ratio), 0.0);
  if ( ratio < 0.8 ) return vec3(0.0, smoothstep(0.6, 0.8, ratio), smoothstep(0.6, 0.8, ratio));
  return vec3(0.0, 0.0, smoothstep(0.8, 1.0, ratio));
}`;

// NOTE: Shadows
GLSLFunctions.elevateShadowRatios =
`
/**
 * Shift the front or back border of the shadow, specified as a ratio between 0 and 1.
 * Shadow moves forward---towards the light---as terrain elevation rises.
 * Thus higher fragment elevation means less shadow.
 * @param {float} ratio       Ratio indicating where the shadow border lies between 0 and 1.
 * @param {float} wallHeight  Height of the wall, relative to the canvas elevation.
 * @param {float} wallRatio   Where the wall is relative to the light, where
 *                              0 means at the shadow end;
 *                              1 means at the light.
 * @param {float} elevChange  Percentage elevation change compared to the canvas
 * @returns {float} Modified ratio.
 */
float elevateShadowRatio(in float ratio, in float wallHeight, in float wallRatio, in float elevChange) {
  if ( wallHeight == 0.0 ) return ratio;
  float ratioDist = wallRatio - ratio; // Distance between the wall and the canvas intersect as a ratio.
  float heightFraction = elevChange / wallHeight;
  return ratio + (heightFraction * ratioDist);
}

/**
 * Same as the float version except that the ratios represent close/middle/far shadow borders.
 */
vec3 elevateShadowRatios(in vec3 ratios, in float wallHeight, in float wallRatio, in float elevChange) {
  if ( wallHeight == 0.0 ) return ratios;
  vec3 ratiosDist = wallRatio - ratios; // Distance between the wall and the canvas intersect as a ratio.
  float heightFraction = elevChange / wallHeight;
  return ratios + (heightFraction * ratiosDist);
}`;
