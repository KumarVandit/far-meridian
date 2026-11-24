"use strict";

const { createFlight, advance, circularize, stageDeltaV } = require("../src/flight.js");
const { transferPlan, parentDeparture, periapsis, launch, land } = require("../src/navigation.js");
const { byId } = require("../src/system.js");

const coastToFrame = (plan) => advance(plan.departure, plan.horizon, undefined, { stopOnFrame: true });
const log = (label, flight) => {
  console.log(`${label} · ${byId[flight.primary].name} · T+${(flight.time / 3600).toFixed(2)} h · ${stageDeltaV(flight).toFixed(2)} km/s remaining`);
};

let flight = launch(createFlight("surface", "pillar", "nomad"));
log("Launch and staging", flight);
flight = circularize(coastToFrame(parentDeparture(flight)));
log("Stellar orbit", flight);
for (const destination of ["morrow", "tern"]) {
  const encounter = coastToFrame(transferPlan(flight, destination));
  flight = circularize(periapsis(encounter));
  log("Orbit capture", flight);
}
flight = land(flight);
log(`Touchdown at ${(flight.impactSpeed * 1000).toFixed(1)} m/s`, flight);
