"use strict";

(() => {
  const system = typeof module === "object" && module.exports ? require("./system.js") : globalThis.FarSystem;
  const flightApi = typeof module === "object" && module.exports ? require("./flight.js") : globalThis.FarFlight;
  const { byId, offset, wrap } = system;
  const { advance, circularize, escapeBurn, impulse, orbitOf, separate, stageDeltaV, tangent, G0 } = flightApi;

  function transferPlan(flight, targetId) {
    const target = byId[targetId];
    if (flight.status !== "flight" || !target || target.parent !== flight.primary) {
      throw new Error("Start in orbit around the body that your destination orbits.");
    }

    const primary = byId[flight.primary];
    const orbit = orbitOf(flight);
    if (orbit.ecc > 0.045) throw new Error("Circularize before plotting an assisted transfer.");
    if (orbit.h <= 0) throw new Error("Assisted transfers need a counterclockwise orbit. Manual flight is available in either direction.");
    const startingRadius = (orbit.peri + orbit.apo) / 2;
    if (Math.abs(startingRadius - target.orbit) < target.soi) {
      throw new Error("The vessel and destination already share nearly the same orbital radius.");
    }

    const semiMajor = (startingRadius + target.orbit) / 2;
    const coastTime = Math.PI * Math.sqrt(semiMajor ** 3 / primary.mu);
    const targetRate = Math.sqrt(primary.mu / target.orbit ** 3);
    const shipRate = Math.sqrt(primary.mu / startingRadius ** 3);
    const drift = targetRate - shipRate;
    const targetPosition = offset(target, flight.time);
    const phase = Math.atan2(targetPosition.y, targetPosition.x) - Math.atan2(flight.y, flight.x);
    const desired = Math.PI - targetRate * coastTime;
    const horizon = coastTime * 1.32 + 90;
    let best;

    // Try passes on both sides of the target. An exact geometric intercept can hit the surface.
    const offsets = [0, 0.24, 0.42, 0.60, 0.80, 1, 1.25, 1.6, 1.9, 2.1, 2.4, 2.8];
    for (const spread of offsets.flatMap((distance) => distance ? [-distance, distance] : [0])) {
      const phaseOffset = spread * target.soi / target.orbit;
      const wait = wrap((desired + phaseOffset - phase) * Math.sign(drift)) / Math.abs(drift);
      const atBurn = advance(flight, wait, undefined, { stopOnFrame: true });
      if (atBurn.primary !== flight.primary || atBurn.status !== "flight") continue;
      const r = Math.hypot(atBurn.x, atBurn.y);
      const speed = Math.sqrt(primary.mu * (2 / r - 2 / (r + target.orbit)));
      const direction = tangent(atBurn);
      const dx = direction.x * speed - atBurn.vx;
      const dy = direction.y * speed - atBurn.vy;
      const deltaV = Math.hypot(dx, dy);
      if (deltaV > stageDeltaV(atBurn)) continue;
      const departure = impulse(atBurn, dx, dy);
      const encounter = advance(departure, horizon, undefined, { stopOnFrame: true });
      if (encounter.primary !== targetId) continue;
      const entryOrbit = orbitOf(encounter);
      const periAltitude = entryOrbit.peri - target.radius;
      if (periAltitude < target.radius * 0.10 || entryOrbit.peri > target.soi * 0.83) continue;
      const slope = (encounter.x * encounter.vx + encounter.y * encounter.vy);
      if (slope >= 0) continue;
      let pass;
      try {
        pass = periapsis(encounter);
      } catch {
        continue;
      }
      const passRadius = Math.hypot(pass.x, pass.y);
      const circularSpeed = Math.sqrt(target.mu / passRadius);
      const directionAtPass = tangent(pass);
      const capture = Math.hypot(circularSpeed * directionAtPass.x - pass.vx, circularSpeed * directionAtPass.y - pass.vy);
      const enoughFuel = deltaV + capture <= stageDeltaV(atBurn);
      const preferredAltitude = Math.min(0.8 * target.radius, 0.3 * (target.soi - target.radius));
      const score = Math.abs(periAltitude - preferredAltitude) / target.soi +
        wait * shipRate * 0.001 + (enoughFuel ? 0 : 2);
      if (!best || score < best.score) {
        best = { score, targetId, wait, deltaV, capture, enoughFuel, departure, horizon, periAltitude,
          travelTime: encounter.time - departure.time, origin: flight };
      }
    }

    if (!best) throw new Error("No safe transfer found from this orbit with the current fuel. Try another altitude, stage, or launch window.");
    return best;
  }

  function radialSpeed(flight) {
    return (flight.x * flight.vx + flight.y * flight.vy) / Math.hypot(flight.x, flight.y);
  }

  function parentDeparture(flight) {
    const body = byId[flight.primary];
    if (!body.parent || flight.status !== "flight") throw new Error("No parent-body departure is available.");
    const orbit = orbitOf(flight);
    const windows = orbit.period && orbit.peri > body.radius ? 16 : 1;
    const horizon = body.soi / 0.3 * 2;
    let burnError;
    for (let index = 0; index < windows; index += 1) {
      const wait = index * (orbit.period ?? 0) / windows;
      const atBurn = advance(flight, wait, undefined, { stopOnFrame: true });
      if (atBurn.primary !== body.id || atBurn.status !== "flight") break;
      let departure;
      try {
        departure = escapeBurn(atBurn);
      } catch (error) {
        burnError = error;
        continue;
      }
      const encounter = advance(departure, horizon, undefined, { stopOnFrame: true });
      if (encounter.primary === body.parent) return { departure, target: body.parent, horizon, wait };
    }
    throw burnError ?? new Error("No clear escape window found. Change the orbit or use a manual burn.");
  }

  function coastUntil(flight, duration, predicate, message) {
    const end = flight.time + duration;
    let state = flight;
    while (state.time < end) {
      const dt = Math.min(30, end - state.time);
      const next = advance(state, dt, undefined, { stopOnFrame: true });
      if (next.primary !== flight.primary) break;
      if (predicate(next)) {
        let low = 0;
        let high = dt;
        for (let i = 0; i < 24; i += 1) {
          const mid = (low + high) / 2;
          if (predicate(advance(state, mid, undefined, { stopOnFrame: true }))) high = mid;
          else low = mid;
        }
        return advance(state, high, undefined, { stopOnFrame: true });
      }
      if (next.status !== "flight" || next.time === state.time) break;
      state = next;
    }
    throw new Error(message);
  }

  function periapsis(flight) {
    const orbit = orbitOf(flight);
    const body = byId[flight.primary];
    if (flight.status !== "flight" || radialSpeed(flight) >= -1e-6) {
      throw new Error("This works while approaching periapsis.");
    }
    if (orbit.peri <= body.radius) throw new Error("The predicted path hits the surface. Raise periapsis first.");
    const horizon = orbit.period ?? 3 * orbit.radius / Math.max(orbit.speed, 0.01);
    return coastUntil(flight, horizon, (state) => radialSpeed(state) >= 0,
      "Periapsis could not be reached in the current gravity frame.");
  }

  function launch(flight) {
    if (flight.status !== "landed" || flight.stage !== 0 || flight.fuel[0] <= 0) {
      throw new Error("Assisted launch needs an attached, fueled booster on the surface.");
    }
    const booster = flight.stages[0];
    const burnTime = flight.fuel[0] / (booster.thrust / (booster.isp * G0));
    const climb = advance(flight, burnTime, { throttle: 1, attitude: "out" });
    if (climb.status !== "flight" || climb.primary !== flight.primary) {
      throw new Error("The booster could not establish an ascent from this surface.");
    }
    const coast = separate(climb);
    const peak = coastUntil(coast, 12000, (state) => radialSpeed(state) <= 0,
      "This vehicle has no apogee in the local gravity frame.");
    return circularize(peak);
  }

  function land(flight) {
    const body = byId[flight.primary];
    const r = Math.hypot(flight.x, flight.y);
    if (flight.status !== "flight" || !body.parent || r <= body.radius + 0.12) {
      throw new Error("Set up an orbit above a planet or moon before starting a descent.");
    }
    const targetRadius = body.radius * 0.93;
    const speed = Math.sqrt(body.mu * (2 / r - 2 / (r + targetRadius)));
    const direction = tangent(flight);
    const descent = impulse(flight, direction.x * speed - flight.vx, direction.y * speed - flight.vy);
    const horizon = 0.6 * orbitOf(descent).period;
    const approach = coastUntil(descent, horizon, (state) => Math.hypot(state.x, state.y) <= body.radius + 0.12,
      "The descent leaves the local gravity frame before reaching the landing site.");
    const length = Math.hypot(approach.x, approach.y);
    const approachSpeed = -0.01;
    const braking = impulse(approach, approachSpeed * approach.x / length - approach.vx,
      approachSpeed * approach.y / length - approach.vy);
    const surface = advance(braking, 90);
    if (surface.status !== "landed") throw new Error("Touchdown speed exceeded the landing limit.");
    return surface;
  }

  const api = Object.freeze({ transferPlan, parentDeparture, periapsis, launch, land, radialSpeed });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.FarNavigation = api;
})();
