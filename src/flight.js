"use strict";

(() => {
  const system = typeof module === "object" && module.exports ? require("./system.js") : globalThis.FarSystem;
  const { byId, children, offset, bodyState, TAU } = system;
  const G0 = 0.00980665; // km/s²
  const PAYLOAD = 750; // kg
  const pi = Math.PI;
  const coast = Object.freeze({ throttle: 0 });
  const shuttle = Object.freeze({
    boosters: Object.freeze({
      dart: Object.freeze({ name: "Dart", dry: 2700, fuel: 8600, thrust: 435, isp: 315 }),
      pillar: Object.freeze({ name: "Pillar", dry: 4200, fuel: 15100, thrust: 665, isp: 325 }),
      atlas: Object.freeze({ name: "Atlas", dry: 6200, fuel: 22800, thrust: 1050, isp: 345 }),
    }),
    engines: Object.freeze({
      skiff: Object.freeze({ name: "Skiff", dry: 1200, fuel: 2500, thrust: 84, isp: 345 }),
      wayfarer: Object.freeze({ name: "Wayfarer", dry: 1900, fuel: 5600, thrust: 140, isp: 390 }),
      nomad: Object.freeze({ name: "Nomad", dry: 2350, fuel: 12500, thrust: 170, isp: 455 }),
    }),
  });

  function createFlight(start = "orbit", booster = "pillar", engine = "wayfarer") {
    if (!Object.hasOwn(shuttle.boosters, booster) || !Object.hasOwn(shuttle.engines, engine)) {
      throw new Error("Choose a valid booster and transfer stage.");
    }
    const stages = [shuttle.boosters[booster], shuttle.engines[engine]];
    const flight = { time: 0, primary: "aster", x: 790, y: 0, vx: 0, vy: Math.sqrt(byId.aster.mu / 790),
      status: "flight", stages, fuel: stages.map((stage) => stage.fuel), stage: 1 };

    if (start === "surface") return { ...flight, x: byId.aster.radius, vy: 0, status: "landed", stage: 0 };
    if (start === "solar") return { ...flight, primary: "solenne", x: 225000, vy: Math.sqrt(byId.solenne.mu / 225000) };
    if (start === "kite") return { ...flight, primary: "kite", x: 230, vy: Math.sqrt(byId.kite.mu / 230) };
    if (start !== "orbit") throw new Error("Choose a valid departure point.");
    return flight;
  }

  function globalState(flight) {
    const b = bodyState(flight.primary, flight.time);
    return { x: b.x + flight.x, y: b.y + flight.y, vx: b.vx + flight.vx, vy: b.vy + flight.vy };
  }

  function shipMass(flight) {
    return flight.stages.slice(flight.stage).reduce(
      (mass, stage, index) => mass + stage.dry + flight.fuel[flight.stage + index], PAYLOAD,
    );
  }

  function stageDeltaV(flight) {
    return flight.stages[flight.stage].isp * G0 * Math.log(
      shipMass(flight) / (shipMass(flight) - flight.fuel[flight.stage]),
    );
  }

  function separate(flight) {
    if (flight.status === "crashed" || flight.stage + 1 >= flight.stages.length) {
      throw new Error("No stage is available to separate.");
    }
    return { ...flight, stage: flight.stage + 1 };
  }

  function orbitOf(flight) {
    const { x, y, vx, vy } = flight;
    const mu = byId[flight.primary].mu;
    const radius = Math.hypot(x, y);
    const speed = Math.hypot(vx, vy);
    const h = x * vy - y * vx;
    const energy = speed ** 2 / 2 - mu / radius;
    const ex = vy * h / mu - x / radius;
    const ey = -vx * h / mu - y / radius;
    const ecc = Math.hypot(ex, ey);
    const p = h * h / mu;
    const semiMajor = energy < 0 ? -mu / (2 * energy) : null;
    return {
      radius, speed, h, energy, ecc, p,
      argument: Math.atan2(ey, ex),
      peri: p / (1 + ecc),
      apo: semiMajor && 2 * semiMajor - p / (1 + ecc),
      period: semiMajor && TAU * Math.sqrt(semiMajor ** 3 / mu),
    };
  }

  function heading(flight, command) {
    const radial = Math.atan2(flight.y, flight.x);
    const prograde = Math.hypot(flight.vx, flight.vy) > 1e-6 ? Math.atan2(flight.vy, flight.vx) : radial + pi / 2;
    switch (command.attitude) {
      case "prograde": return prograde;
      case "retrograde": return prograde + pi;
      case "out": return radial;
      case "in": return radial + pi;
      default: return (command.angle ?? 0) * pi / 180;
    }
  }

  function acceleration(mu, x, y) {
    const scale = -mu / Math.hypot(x, y) ** 3;
    return [scale * x, scale * y];
  }

  function switchFrame(flight, id) {
    const world = globalState(flight);
    const center = bodyState(id, flight.time);
    return { ...flight, primary: id,
      x: world.x - center.x, y: world.y - center.y, vx: world.vx - center.vx, vy: world.vy - center.vy };
  }

  function nextFrame(flight, body) {
    for (const child of children[body.id]) {
      const point = offset(child, flight.time);
      if (Math.hypot(flight.x - point.x, flight.y - point.y) <= child.soi * 0.998) {
        return switchFrame(flight, child.id);
      }
    }
    if (body.parent && Math.hypot(flight.x, flight.y) >= body.soi * 1.002) {
      return switchFrame(flight, body.parent);
    }
    return flight;
  }

  function step(flight, dt, command) {
    const body = byId[flight.primary];
    const engine = flight.stages[flight.stage];
    const requested = Math.min(1, Math.max(0, command.throttle ?? 0));
    const rate = engine.thrust / (engine.isp * G0);
    const consumed = Math.min(flight.fuel[flight.stage], dt * rate * requested);
    let ax = 0;
    let ay = 0;
    let fuel = flight.fuel;
    if (consumed > 0) {
      fuel = flight.fuel.slice();
      fuel[flight.stage] -= consumed;
      const impulse = G0 * engine.isp * Math.log1p(consumed / (shipMass(flight) - consumed));
      const angle = heading(flight, command);
      ax = impulse * Math.cos(angle) / dt;
      ay = impulse * Math.sin(angle) / dt;
    }
    const [gx, gy] = acceleration(body.mu, flight.x, flight.y);
    if (flight.status === "landed") {
      if ((ax + gx) * flight.x + (ay + gy) * flight.y <= 0) {
        return { ...flight, fuel, time: flight.time + dt };
      }
    }

    const x = flight.x + dt * (flight.vx + dt * (gx + ax) / 2);
    const y = flight.y + dt * (flight.vy + dt * (gy + ay) / 2);
    const [gx2, gy2] = acceleration(body.mu, x, y);
    const time = flight.time + dt;
    const vx = flight.vx + dt * ((gx + gx2) / 2 + ax);
    const vy = flight.vy + dt * ((gy + gy2) / 2 + ay);
    const radius = Math.hypot(x, y);
    if (radius <= body.radius && flight.status !== "landed") {
      const speed = Math.hypot(vx, vy);
      return { ...flight, time, fuel, x: body.radius * x / radius, y: body.radius * y / radius,
        vx: 0, vy: 0, status: speed <= 0.095 ? "landed" : "crashed", impactSpeed: speed };
    }
    return nextFrame({ ...flight, time, fuel, x, y, vx, vy, status: "flight" }, body);
  }

  function advance(flight, seconds, command = coast, { stopOnFrame = false } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Flight time must be finite and nonnegative.");
    if (flight.status === "crashed") return flight;
    const deadline = flight.time + seconds;
    let state = flight;
    let steps = 0;
    while (state.time < deadline) {
      const body = byId[state.primary];
      const radius = Math.hypot(state.x, state.y);
      const speed = Math.hypot(state.vx, state.vy);
      const dynamicStep = Math.sqrt(radius ** 3 / body.mu) * 0.015;
      const bodyCap = body.parent ? 20 : 90;
      const speedCap = radius / Math.max(speed, 0.1) * 0.04;
      const cap = command.throttle > 0 ? 0.5 : Math.min(bodyCap, dynamicStep, speedCap);
      const dt = Math.min(cap, deadline - state.time);
      if (state.time + dt === state.time) break;
      const prior = state;
      state = step(state, dt, command);
      steps += 1;
      if (state.status === "crashed" || (prior.status === "flight" && state.status === "landed")) break;
      if (stopOnFrame && prior.primary !== state.primary) break;
      if (steps >= 25_000) throw new Error("Time advance too large. Use a shorter interval.");
    }
    return state;
  }

  function impulse(flight, dvx, dvy) {
    if (flight.status !== "flight") throw new Error("This maneuver needs a vessel in flight.");
    const dv = Math.hypot(dvx, dvy);
    if (!Number.isFinite(dv)) throw new Error("Invalid maneuver.");
    const stage = flight.stages[flight.stage];
    const consumed = -shipMass(flight) * Math.expm1(-dv / (stage.isp * G0));
    if (flight.fuel[flight.stage] + 1e-8 < consumed) {
      throw new Error(`Need ${dv.toFixed(2)} km/s of Δv. The active stage has ${stageDeltaV(flight).toFixed(2)} km/s.`);
    }
    const fuel = flight.fuel.slice();
    fuel[flight.stage] = Math.max(0, fuel[flight.stage] - consumed);
    return { ...flight, vx: flight.vx + dvx, vy: flight.vy + dvy, fuel };
  }

  function tangent(flight) {
    const r = Math.hypot(flight.x, flight.y);
    const sign = flight.x * flight.vy - flight.y * flight.vx < 0 ? -1 : 1;
    return { x: -sign * flight.y / r, y: sign * flight.x / r };
  }

  function circularize(flight) {
    const r = Math.hypot(flight.x, flight.y);
    const speed = Math.sqrt(byId[flight.primary].mu / r);
    const direction = tangent(flight);
    return impulse(flight, speed * direction.x - flight.vx, speed * direction.y - flight.vy);
  }

  function escapeBurn(flight) {
    if (!byId[flight.primary].parent) throw new Error("Already flying in the star frame.");
    const r = Math.hypot(flight.x, flight.y);
    const speed = Math.sqrt(2 * byId[flight.primary].mu / r + 0.30 ** 2);
    const direction = tangent(flight);
    return impulse(flight, speed * direction.x - flight.vx, speed * direction.y - flight.vy);
  }

  const api = Object.freeze({
    createFlight, globalState, shipMass, stageDeltaV, separate, orbitOf, heading, advance, impulse,
    tangent, circularize, escapeBurn, shuttle, G0,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.FarFlight = api;
})();
