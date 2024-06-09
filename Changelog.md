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
