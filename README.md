# Far Meridian

An original offline spaceflight sandbox. Assemble a two-stage vessel, fly it manually or use a flight assist, and navigate a moving system of eight fictional bodies. The same vessel can launch from Aster, cross interplanetary space, capture at Morrow, and land on its moon Tern.

## Fly offline

Open [index.html](index.html) in a browser. No server, network, package install, or assets are required.

The first mission starts in Aster parking orbit. With **Kite** selected, follow the main button in **Navigation** to plot the transfer, execute the departure burn, warp to the encounter, approach periapsis, circularize, and land. The clock, fuel and gravity frame change as the flight progresses. Select **System** for the full chart, choose a body under **Worlds** to focus the camera, and drag or zoom the canvas to explore.

To start from the surface, choose **Aster launch pad** in **Vehicle assembly** and select **Assisted liftoff**, or fly using attitude, throttle, and stage separation. For a longer mission, choose **Pillar** and **Nomad**, launch, use **Escape burn**, warp into Solenne's frame, and circularize. Plot a transfer to **Morrow**. After capture, clear the route and plot **Tern**. The built-in terminal example runs this whole flight.

## Verify the simulation

Node.js 20 or newer runs the same simulation core as the browser.

```sh
node --test
node examples/mission.js
```

The tests cover long-duration circular orbits, frame transforms, propellant use, staging, failures, moon landings, and transfers to all four planets. The mission example logs the time, gravity frame, and remaining delta-v through a continuous flight.

## Simulation model

- **System.** Positions and velocities follow a hierarchy of circular, coplanar orbits. Distances are in kilometers, time in seconds, and vessel masses in kilograms. World parameters are chosen for a compact fictional system.
- **Flight.** The vessel uses adaptive substeps and velocity Verlet gravity inside its current sphere of influence. At a frame change the model preserves the vessel's position and velocity in the star frame. Throttle burns propellant according to thrust and specific impulse. A surface impact is classified by contact speed.
- **Navigation.** The transfer planner starts from a Hohmann-style trajectory, searches departure phases, and simulates each encounter to check the actual gravity frame and periapsis. Assists use ideal impulses and charge the active stage according to the rocket equation. Manual control uses finite thrust.
- **Chart.** The dashed projection is the vessel's instantaneous two-body orbit around its active primary. It can change when you fire the engine or cross a gravity boundary.

This starter is planar and airless. Vehicle assembly combines a choice of booster and transfer stage. The simulation follows one player vessel at a time. [Hohmann transfers](https://orbital-mechanics.space/orbital-maneuvers/hohmann-transfer/) · [Spheres of influence](https://orbital-mechanics.space/interplanetary-maneuvers/sphere-of-influence/)

## Build from here

The browser and tests share three modules for [body ephemerides](src/system.js), [vessel dynamics](src/flight.js), and [mission planning](src/navigation.js). Extend those before adding presentation-specific flight logic.

1. Add editable maneuver nodes and predict encounters across multiple gravity frames on the map.
2. Replace stage presets with a part graph for tanks, engines, decouplers, payloads, and docking ports.
3. Add rotating terrain, atmosphere, drag, heating, and landing legs.
4. Add 3D trajectories, plane changes, rendezvous, persistent fleets, and save files.
