"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { byId, bodyState, offset } = require("../src/system.js");
const {
  createFlight, advance, globalState, orbitOf, impulse, stageDeltaV, shipMass, separate, circularize, G0,
} = require("../src/flight.js");
const { transferPlan, parentDeparture, periapsis, launch, land, radialSpeed } = require("../src/navigation.js");

const relativeError = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected);
const coastToFrame = (plan) => advance(plan.departure, plan.horizon, undefined, { stopOnFrame: true });

function captureAt(flight, destination) {
  const plan = transferPlan(flight, destination);
  assert.ok(plan.enoughFuel);
  const encounter = coastToFrame(plan);
  assert.equal(encounter.primary, destination);
  assert.ok(radialSpeed(encounter) < 0);
  const closest = periapsis(encounter);
  assert.ok(Math.abs(radialSpeed(closest)) < 1e-5);
  assert.ok(orbitOf(closest).radius > byId[destination].radius);
  const captured = circularize(closest);
  assert.ok(orbitOf(captured).ecc < 1e-10);
  assert.ok(stageDeltaV(captured) < stageDeltaV(flight));
  return captured;
}

test("coasting in parking orbit conserves energy and angular momentum for 20 revolutions", () => {
  const flight = createFlight();
  const initial = orbitOf(flight);
  const final = advance(flight, initial.period * 20);
  const orbit = orbitOf(final);
  assert.equal(final.primary, flight.primary);
  assert.ok(relativeError(orbit.energy, initial.energy) < 1e-8);
  assert.ok(relativeError(orbit.h, initial.h) < 1e-9);
  assert.ok(orbit.ecc < 1e-4);
});

test("nested world position and velocity compose with the local vessel frame", () => {
  const flight = { ...createFlight("kite"), time: 2200 };
  const world = globalState(flight);
  const parent = bodyState("aster", flight.time);
  const moon = offset(byId.kite, flight.time);
  for (const property of ["x", "y", "vx", "vy"]) {
    assert.ok(Math.abs(world[property] - parent[property] - moon[property] - flight[property]) < 1e-9);
  }
});

test("powered ascent consumes propellant and staging drops the booster mass", () => {
  const pad = createFlight("surface");
  const burn = advance(pad, 10, { throttle: 1, attitude: "out" });
  assert.equal(burn.status, "flight");
  assert.ok(burn.x > pad.x);
  assert.ok(burn.fuel[0] < pad.fuel[0]);
  assert.equal(burn.fuel[1], pad.fuel[1]);
  const upper = separate(burn);
  assert.equal(upper.stage, 1);
  assert.equal(upper.vx, burn.vx);
  assert.ok(Math.abs(shipMass(burn) - shipMass(upper) - burn.fuel[0] - burn.stages[0].dry) < 1e-8);
});

test("an ideal burn pays the rocket equation and fails cleanly when fuel is short", () => {
  const flight = createFlight();
  const burned = impulse(flight, 0, 0.6);
  const deltaV = G0 * flight.stages[flight.stage].isp * Math.log(shipMass(flight) / shipMass(burned));
  assert.ok(Math.abs(deltaV - 0.6) < 1e-10);
  assert.ok(Math.abs(burned.vy - flight.vy - 0.6) < 1e-12);
  assert.throws(() => impulse(flight, 0, 50), /active stage has/);
  assert.equal(flight.fuel[1], flight.stages[1].fuel);
});

test("parking orbit to Kite is a continuous, fueled route with a soft touchdown", () => {
  const flight = createFlight();
  const captured = captureAt(flight, "kite");
  const surface = land(captured);
  assert.equal(surface.primary, "kite");
  assert.equal(surface.status, "landed");
  assert.ok(surface.impactSpeed < 0.04);
  assert.ok(Math.abs(Math.hypot(surface.x, surface.y) - byId.kite.radius) < 1e-8);
});

test("a launch from Aster can reach Tern via the star and Morrow without resetting the vessel", () => {
  const pad = createFlight("surface", "pillar", "nomad");
  const parkingOrbit = launch(pad);
  assert.equal(parkingOrbit.stage, 1);
  const escape = parentDeparture(parkingOrbit);
  const heliocentric = coastToFrame(escape);
  assert.equal(heliocentric.primary, "solenne");
  const morrow = captureAt(circularize(heliocentric), "morrow");
  const tern = captureAt(morrow, "tern");
  const surface = land(tern);
  assert.equal(surface.primary, "tern");
  assert.equal(surface.status, "landed");
  assert.ok(surface.time > morrow.time);
  assert.ok(surface.fuel[1] > 0);
});

test("the other worlds also have working transfer windows", () => {
  for (const destination of ["flint", "aster", "morrow", "rime"]) {
    captureAt(createFlight("solar", "pillar", "nomad"), destination);
  }
  captureAt(createFlight(), "fallow");
});

test("a failed descent cannot alter the initial flight or continue beyond impact", () => {
  const flight = { ...createFlight("kite"), vx: -1, vy: 0 };
  const crashed = advance(flight, 3600);
  assert.equal(crashed.status, "crashed");
  assert.ok(crashed.time < 3600);
  assert.strictEqual(advance(crashed, 100), crashed);
  assert.equal(flight.status, "flight");
  assert.throws(() => transferPlan(createFlight(), "morrow"), /destination orbits/);
});
