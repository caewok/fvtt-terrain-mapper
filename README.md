[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-terrain-mapper)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-terrain-mapper/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-terrain-mapper)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/terrainmapper&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-terrain-mapper/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

You can use this [Module JSON link](https://github.com/caewok/fvtt-terrain-mapper/releases/latest/download/module.json) to install.

This [Foundry VTT](https://foundryvtt.com) module facilitates the use of regions to define elevated "Terrains" for regions. Terrains define regions that have a physical elevation. They affect elevation of tokens moving through the terrain. For example, a plateau can be defined for a region to represent a raised flat area of the canvas. Tokens walking into the plateau have their elevation raised accordingly. Terrains may also be defined as ramps, steps, or hills. 

Terrain mapper also provides some advanced region drawing tools: fill-by-grid, fill-by-line-of-sight, and fill-by-enclosed-walls. 

This module intends to be system-neutral. I will endeavor to make this module compatible with other systems upon request (and to the extent possible).

# Thanks

Special thanks to:
- [dev7355608](https://github.com/dev7355608) for answering yet more random PIXIjs questions.

## Required modules
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib)

# Recommended modules
- [Wall Height](https://github.com/theripper93/wall-height)

# Known issues
Nothing too serious at the moment. Report [issues](https://github.com/caewok/fvtt-terrain-mapper/issues) here!

# Basic Use

## Terrains

## Region Elevation Characteristics
Terrain Mapper adds an additional tab to the region configuration to allow the GM to define how the region elevation works. These are not behaviors, but instead modify the movement of the token through the region. The Elevation Ruler module can also use these elevation characteristics to estimate token movement cost.

These options are most useful for outdoor scene, where you want to approximate a hill, elevated ledge, or incline such as a slanted roof. The ramp/steps option is also useful for long staircases that stretch out in two dimensions in the overhead view.

By default, multiple polygons in a region are treated as one big elevated terrain. So if you have two adjacent polygons, a ramp might go from 0 --> 10 for the first polygon, and 10 --> 25 for the second, if you defined the lowest elevation as 0 and the highest as 25. If there was a gap between the polygons, the region would end (and the token would return to the scene elevation) and then the token would continue. So 0 --> 10 for the first polygon, then return to 0, then 10 --> 25 for the second polygon. 

A toggle in this tab, the Separate Polygons option, allows you to change this behavior, treating multiple polygons instead as if they were each a separate region. In the example above, the token would go 0 --> 25 for the first polygon, then return to 0, then 0 --> 25 for the second polygon. Use this if you have, for example, several roof portions that you want to define with the same exact slope.

### Plateau / Mesa
The plateau / mesa option allows the GM to define a highest elevation for the region. When a token enters the region, it will be elevated to that highest elevation. When it exits, it will drop back to the bottom. You can approximate this behavior using one-way stairs with reset on exit, but using the plateau is likely preferable. Movement across multiple plateaus can be forecasted and can inform Elevation Ruler. Movement will not stop when elevation changes. When a token is on a plateau, it will be considered "on the ground" for purposes of estimating flying and burrowing. 

Note that the highest elevation need not be set to the top elevation of the region. If you want tokens flying above the "plateau" to be affected by the region, set the region top elevation to something higher (or leave at positive infinity). Generally, the highest elevation of the plateau should be within the height of the region.

### Ramp / Steps
The ramp / steps option operates like a plateau, except that the GM can define a low elevation and a direction, and the token will change elevation from lowest to highest when moving along the direction in the region. The "ramp" moves the token in 1-unit elevation steps. Alternatively, the GM can define the step size for the ramp (how much to increment elevation along each step of the ramp). 

Note that the ramp is *directional*, meaning that if the token moves along the ramp from the side it would be moved to the elevation of the ramp at that point and then not change (unless it changed direction to move up or down).

### Hills
As of v14.0.1, Terrain Mapper provides a hill option. Hills are GM-defined cubic Bézier curves that define the ridgeline of a region. That ridgeline is in turn translated to cover the 2d plane of the region, creating an extremely customizable hill (or hole). 

First, in the region controls, click the "Terrain Mapper Hill" icon (looks like a mountain). This displays two items per region: a green curve and an orange orientation line. 

1. Bézier curve. Use the green curve to create a peak or a valley. Modify the start and end controls (circles) if you want the hill to abruptly drop off at the start or end. Modify the other two control points (squares) to adjust the shape of the curve. Double-click to reset a given control point. Hold shift to move a pair of control points (start/end and control1/control2).

2. Orientation line. Use the orange line to define how the ridge curve moves through the region. The start and end points define where the ridge starts and ends in relation to the region edge.

In the region configuration tab, once you select "Hill" you will see additional options. Highest elevation defines the elevation of the highest (or lowest) peak of the curve. Hill type defines how the curve is translated to the 2d scene. "Linear" means that a token moving parallel to the orientation line will encounter the same elevation—the curve is applied repeatedly in parallel to the orientation line. "Ridge" means that as a token moves perpendicular to the orientation line, the token will drop off proportional to the steepness of the curve at that point. "Symmetrical" means that the curve start will be placed at the center of the orientation line and the curve end will be placed at the circumference of a circle defined by the start and the end of the orientation line rotated around its center. (Flip the orientation start/end to flip the curve start and end points.) 

## Region Behaviors
Terrain Mapper defines two region behaviors that can be added to a region: stairs and elevator. Normally, you would want to use only one of these two. A good approach for gridded scenes is to use the fill-by-grid tool to create a region that spans a single grid space, and use that for the stairs or elevator behavior. Keep in mind that these behaviors are only triggered when a token enters (and optionally exits) a region.

### Stairs
The stairs behavior can set a token to a specific elevation ("one-way") or can alternate between two elevations ("two-way"). Two-way stairs move the token up if it is less than halfway between the low/high elevations, and otherwise moves the token down. If the token changes elevation, its movement is stopped because its perspective (and visible walls, obstacles, and enemies) may have changed.

You can optionally have the behavior present a dialog to the user before the token elevation is changed. You can also limit stairs to operate only if the token is at exactly the low or high elevations, which is helpful if you have defined "floors" at which the token is meant to be moving. Finally, you can have the token return to the background scene elevation when leaving the stairs region (although you may want to use a plateau instead).

### Elevator
The elevator behavior allows the user to select between several different floors. By necessity, an elevator always presents a dialog to the user. Otherwise, options here are comparable to stairs. As with stairs, if the token changes elevation, its movement is stopped. You can limit the elevator to trigger only when the token is at one of the defined elevations.  And you can have the token return to the background scene elevation when leaving the elevator region

# User Interface 

## Fill tools
Terrain Mapper adds some additional fill tools to the Region controls, to facilitate drawing region shapes.

### Fill by grid
<img width="432" alt="Screenshot 2024-06-21 at 9 07 49 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/0c31f7e9-f735-43f9-8e71-0cbc3a1cbae7">

Fills one or more grid squares with the terrain. Hold and drag to fill a bunch of grid squares in a row. This will combine the grid squares into a single shape at the end, potentially with one or more holes.

### Fill by line-of-sight
<img width="432" alt="Screenshot 2024-06-21 at 9 07 43 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/392ac416-244a-434e-a0a4-517c97f1b6bb">

Fills an area representing the line-of-sight from the point selected on the canvas. This is equivalent to the line-of-sight used in token vision.

### Fill space enclosed by walls
<img width="432" alt="Screenshot 2024-06-21 at 9 07 37 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/01c2ca39-b9d1-4dda-b89c-20761050bb3b">

Based on the current wall configuration for the scene, this tool will fill an enclosed space with the selected terrain from the point selected. If there are "islands" within the enclosed space, those islands will not be filled. To assist you, wall outlines will be displayed while this tool is active. 

Unlike the "Create Shape from Controlled Walls" tool provided by Regions, this does not require you to select walls first. But because of this, gaps between walls can cause this tool to "leak" and fill much more area than intended. To undo it, go to the region shapes and delete the last shape in the list.
<img width="1047" alt="Screenshot 2024-06-21 at 9 16 16 PM" src="https://github.com/caewok/fvtt-terrain-mapper/assets/1267134/143d3ebc-787c-4c45-97fa-dc832cbfd78e">

## Region configuration
Within a region, you can set two behaviors: stairs, and elevator.
<img width="482" alt="Screenshot 2024-09-03 at 11 38 56 AM" src="https://github.com/user-attachments/assets/e0cb2d51-50bc-4f64-b049-4650dd61ea49">

### Stairs
<img width="476" alt="Screenshot 2024-09-03 at 11 38 23 AM" src="https://github.com/user-attachments/assets/df5b0f13-6ac7-4a8b-b1aa-8478d305af83">

### Elevator
<img width="476" alt="Screenshot 2024-09-03 at 11 38 06 AM" src="https://github.com/user-attachments/assets/a0daa906-19d3-4044-b852-5f46ae56070f">
