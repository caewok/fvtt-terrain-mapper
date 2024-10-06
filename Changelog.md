## 0.4.7
Allow application of duplicate terrain effects when dragging tokens into regions.
Update libGeometry to v0.3.16.

## 0.4.6
Add Italian localization. Thanks @GregoryWarn!
Avoid using the tile hole cache until the workers finish processing to avoid errors when moving tokens immediately on scene load. May address #53.
Improve performance when measuring the movement penalty in terrains. Closes #58.
Use active effect origin to track which regions add terrains, to improve how terrains are added and removed when duplicate terrains are applied.
Handle region ramps or plateaus that move below the scene elevation (i.e., negative elevation values). Closes #57. As a result, you can now create "holes" in a scene using a plateau set to a value lower than the scene background.
Update libGeometry to v0.3.14 and refactor the cutaway methods.

## 0.4.5
Fix for token undefined error when user drags token. Closes #52.
Update Brazilian Portuguese translation. Thanks @Kharmans!
Update libGeometry to v0.3.13.

## 0.4.4
Add a setting to the region configuration to treat polygons separately when using ramps. With this setting, each non-hole polygon gets its own ramp from low --> high elevation. With this setting disabled, all non-hole polygons are treated as a single ramp.

Correct calculation of ramp when multiple polygons are present. Closes #48.
Fix testing of tile holes, which was causing the measured elevation of the tile to fail.
If Levels module is active, use the `{ teleport: true }` option when changing elevations for stairs and elevators to avoid a Levels error re changing floors.
When taking stairs and elevators on a gridded map, attempt to snap the token to the next grid location (unless the path is blocked).
Provide sensible defaults for ramp settings to avoid errors if undefined.
Update libGeometry to 0.3.11.

## 0.4.3
When adding active effects, toggle on associated statuses manually so they are properly shown as enabled in the token HUD and actor sheet. When removing active effects, toggle associated statuses off manually unless the statuses are also provided by another active effect. Related #45.
Do not strip out AE statuses when adding the terrain icon to the status array. Closes #45.
Add terrain examples for a5e system. Closes #42.
Fix hook for a5e so that when a terrain effect is updated, its name and icon are updated in the terrain list.
Update Brazilian Portuguese translation. Thanks @Kharmans!

## 0.4.2
Add a reset-to-ground option for the stairs and elevator behaviors.
Update Brazilian Portuguese translation. Thanks @Kharmans!

## 0.4.1
Change `setElevation` region behavior to a `stairs` behavior. Add an `elevator` behavior. Present dialog to user for elevator and optional dialog for stairs.
Update Brazilian Portuguese translation and add to the module.json. Thanks @Kharmans! Closes #39.

Fix PF2e error on scene load. Closes #36, #37.
Fix for incorrectly displayed height. Closes #38.
Refactor how plateaus and ramps change tokens, to provide better compatibility with Levels and other modules.
Remove blank stairs type option from the config.
Improve compatibility with Elevation Ruler.
Update libGeometry to v0.3.9.

## 0.4.0
Add a Terrain Mapper tab to the region configuration with options to make a 3d region shape:
1. Plateau: Region treated like a physical plateau with a flat top at a given elevation. Note that the region affected area can continue above the plateau.
2. Ramp/Steps: Like Plateau but the top goes from a low to a high elevation, either continuously or at a given step size.

Modify the SetElevation behavior to act like stairs, moving a token up or up/down.
Automatically adjust token elevations as they move across region plateaus/ramps/steps, accounting for flying or burrowing tokens.

Add config options to overhead tiles to treat them as a "floor" at the set tile elevation. Include options to ignore the transparent rectangular boundary and to treat transparent tiles (alpha <= 0.75 ) to be holes. Add `CONFIG.terrainmapper.holePercentThreshold` to modify how large the hole has to be for a token to "fall through."

Set scene config elevation step to "0.1" so that it accepts decimal values. Closes #33.
Added basic Brazilian Portuguese translation. Thanks @Kharmans!
Modifications to better support move and move penalty calculations in Elevation Ruler when crossing regions or tiles.

## 0.3.3
Add json folder to workflow so default terrains will be present in dnd5e.

## 0.3.2
Address compatibility with Elevation Ruler. Requires Elevation Ruler v0.9.5.

## 0.3.1
Remove the dependency on `socketslib`. Instead use `firstGM` test for setting terrain. Fixes duplicative terrain getting set when users enter region.

## 0.3.0
Uses the Foundry v12 Region system.
Substantial re-write of the module.
Provides two region behaviors: `setTerrain` and `setElevation`. Region behaviors trigger active effects on actors as they pass through regions.
Enhanced region drawing tools provided: fill by grid squares, fill by line-of-sight, and fill enclosed walls. Fill by grid squares and fill enclosed walls both are capable of constructing region shapes with holes.
Some default terrains provided for dnd5e and pf2e.

## 0.2.0
Initial Foundry v12 compatibility.
Additional releases (starting with v0.3.0) will focus on transitioning to using the Region system in v12. Version 0.2 series is completely separate from Regions and is intended as a stop-gap.

## 0.1.5
Fix error when applying terrain effects. (Should now work with dnd5e 3.x updates.)

Add a setting to choose whether to display the terrain icon when applying terrain effects to tokens.

## 0.1.4
Fix error when using Elevated Vision and Elevation Ruler along with Terrain Mapper and the token moves over a terrain.

Update lib geometry to v0.2.18.

## 0.1.3
Bug fixes related to calculating movement penalty; added ability to calculate movement penalty for a given shape.
Fix for tile cache not updating.
Move PixelCache to lib geometry.
Fix for updating settings cache.
Update lib geometry to v0.2.17.

## 0.1.2
Improvements to calculating movement penalty across a path for compatibility with Elevation Ruler:
- Change `Terrain.percentMovementForTokenAlongPath` to return the movement penalty, not the movement percent applied to the token. So if the token is at 50% movement speed for a given terrain, this would return 1.5 for a path completely in the terrain. Necessary so the averaging across different terrains works properly.

- Force a measurement for terrain and elevation at the beginning and end of a path in instances when it would otherwise be omitted. Necessary to capture when t=0 or t=1 rounds to somewhere other than the exact origin point or destination point, respectively.

## 0.1.1
Fix errors related to Set map modifications. Closes issue #21. Thanks @AterIgnis for the code suggestion!
Fix `pixelCache` not initialized error.

## 0.1.0

### New Features
Users can add a terrain to a tile. Optionally set a transparency threshold for the tile, to have transparent pixels be considered to not have the terrain.
Users can add a terrain to a measured template.
Users can set an elevation to the tile or template, which can affect when the terrain is active.

### Bug fixes
Popout the terrain effect configuration when a new terrain is created. See issue #15.
Update terrain color when the configuration setting is updated. Closes issue #10.
Fix hexagon fill. Closes issue #14. Note that the hexagon fills are slightly blocky, reflecting the lower resolution of the terrain fill (for speed).
Refactor settings and patching classes.
Update lib geometry to 0.2.12.

## 0.0.6
Move the terrain import/replace/export buttons to the Terrain List.
Add add/remove terrain buttons to the Terrain List.

## 0.0.5
Add a `Terrain.percentMovementForTokenAlongPath` that can be used by modules like Drag Ruler to estimate token movement across terrains. Fixes to token movement estimation.

## 0.0.4
Fixes for editing terrains in the advanced terrain listing. Closes issue #4.

## 0.0.3
Add checks for when the terrain item is not yet defined. Closes issue #3.
Fix for the terrain item getting initialized too late.
Fix hook that ensure terrain item is invisible.
Add check to determine if terrain data file exists, to avoid 404 error message.

## 0.0.2
Correct import issue where "Settings" filename was incorrectly capitalized. Closes issue #2.

## 0.0.1
Initial release

- Configure terrains.
- Add terrains by layer.
- Automatically add terrain effects on token movement.
- Notify GM and interrupt token movement when encountering terrain.
