"use strict";

(() => {
  const { bodies, byId, children } = globalThis.FarSystem;
  const { createFlight, advance, circularize, orbitOf, separate, shipMass, stageDeltaV } = globalThis.FarFlight;
  const navigation = globalThis.FarNavigation;
  const get = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
  const km = (distance) => `${number.format(distance)} km`;
  const speed = (value) => `${value.toFixed(2)} km/s`;
  const duration = (seconds) => {
    const total = Math.floor(seconds);
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
      .map((part) => String(part).padStart(2, "0")).join(":");
  };

  let flight = createFlight();
  let command = { throttle: 0, attitude: "prograde", angle: 0 };
  let target = "kite";
  let camera = "local";
  let plan;
  let pending;
  let arrival;
  const atlas = new Map();
  const map = globalThis.makeFarMap(get("map"), renderMap, showWorld);

  for (const body of bodies) {
    const button = document.createElement("button");
    const dot = document.createElement("span");
    dot.className = "world-dot";
    dot.style.backgroundColor = body.color;
    dot.setAttribute("aria-hidden", "true");
    button.type = "button";
    button.append(dot, body.name);
    button.title = body.parent ? `${body.kind} orbiting ${byId[body.parent].name}` : body.kind;
    button.addEventListener("click", () => showWorld(body.id));
    get("worlds").append(button);
    atlas.set(body.id, button);
  }

  function showWorld(id) {
    camera = id;
    map.frame(id);
    if (byId[id].parent === flight.primary && !pending && !arrival) {
      target = id;
      get("target").value = id;
      plan = undefined;
    }
    render();
  }

  function homeView(id) {
    camera = id;
    map.frame(id);
    render();
  }

  function chooseDestinations() {
    const possible = children[flight.primary];
    if (!possible.some((body) => body.id === target)) target = possible[0]?.id;
    const options = possible.map((body) => new Option(body.name, body.id));
    get("target").replaceChildren(...(options.length ? options : [new Option("No local destinations", "")]));
    get("target").value = target ?? "";
  }

  function notice(message, problem = false) {
    const output = get("notice");
    output.textContent = message;
    output.dataset.problem = String(problem);
  }

  function renderMap() {
    const view = map.render(flight, command, pending?.target ?? arrival?.target ?? target, plan);
    get("focus-label").textContent = camera === "system" ? "Solenne system view" : `${view} view`;
  }

  function render() {
    const body = byId[flight.primary];
    const orbit = orbitOf(flight);
    const isFlying = flight.status === "flight";
    const stage = flight.stages[flight.stage];
    get("frame").textContent = `${body.name} frame`;
    get("clock").textContent = duration(flight.time);
    get("status-badge").textContent = flight.status === "crashed" ? "Impact"
      : flight.status === "landed" ? "On surface" : orbit.peri > body.radius && orbit.apo !== null ? "In orbit" : "In flight";
    get("altitude").textContent = km(Math.max(0, orbit.radius - body.radius));
    get("speed").textContent = speed(orbit.speed);
    get("peri").textContent = isFlying ? km(orbit.peri - body.radius) : "—";
    get("apo").textContent = isFlying ? (orbit.apo === null ? "Escape" : km(orbit.apo - body.radius)) : "—";
    get("delta-v").textContent = speed(stageDeltaV(flight));
    get("engine-name").textContent = `${stage.name} · ${number.format(flight.fuel[flight.stage])} kg`;
    get("engine-name").title = `Vessel mass ${number.format(shipMass(flight))} kg`;
    get("throttle-output").textContent = `${Math.round(command.throttle * 100)}%`;
    get("throttle").value = String(command.throttle * 100);
    get("throttle").disabled = flight.status === "crashed";
    get("stage").disabled = flight.status === "crashed" || flight.stage + 1 >= flight.stages.length;
    get("capture").disabled = !isFlying;
    get("periapsis").disabled = !isFlying || navigation.radialSpeed(flight) >= -1e-6;
    get("escape").disabled = !isFlying || !body.parent;
    get("land").disabled = !isFlying || !body.parent;
    get("target").disabled = Boolean(pending || arrival) || !target;
    get("clear-route").hidden = !plan && !pending && !arrival;
    for (const [id, button] of atlas) button.setAttribute("aria-pressed", String(camera === id));

    const next = get("next");
    next.disabled = false;
    if (flight.status === "crashed") {
      next.textContent = "Flight ended";
      next.disabled = true;
      get("plan-note").textContent = "Start a new flight in Vehicle assembly.";
    } else if (flight.status === "landed") {
      next.textContent = "Assisted liftoff";
      next.disabled = flight.stage !== 0;
      get("plan-note").textContent = flight.stage === 0 ? `Launch from ${body.name} into parking orbit.`
        : `Landed on ${body.name}. Use the throttle and Radial out to lift off again.`;
    } else if (pending) {
      next.textContent = pending.kind === "escape" ? `Warp to ${byId[pending.target].name} frame` : "Warp to encounter";
      get("plan-note").textContent = `Coasting toward ${byId[pending.target].name}. Time warp advances the flight along its trajectory.`;
    } else if (arrival) {
      next.textContent = arrival.phase === "approach" ? "Warp to periapsis"
        : arrival.phase === "capture" ? "Circularize at periapsis" : `Land on ${body.name}`;
      get("plan-note").textContent = arrival.phase === "approach" ? `Inside ${body.name}’s sphere of influence.`
        : arrival.phase === "capture" ? "At closest approach. Match the local circular orbit."
          : `Captured into ${body.name} orbit. Land or continue flying.`;
    } else if (plan) {
      next.textContent = "Depart on transfer";
      get("plan-note").textContent = `Wait ${duration(plan.wait)} · Burn ${speed(plan.deltaV)} · Coast ${duration(plan.travelTime)} · Pass at ${km(plan.periAltitude)}.`;
    } else {
      next.textContent = "Plot transfer";
      next.disabled = !target;
      get("plan-note").textContent = target ? `Plot an encounter with ${byId[target].name} from this orbit.`
        : "Use Escape burn to reach the parent body’s frame.";
    }
    renderMap();
  }

  function cutThrottle() {
    command = { ...command, throttle: 0 };
  }

  function pause() {
    get("warp").value = "0";
    cutThrottle();
  }

  function setFlight(state) {
    const previous = flight;
    flight = state;
    if (flight.status !== previous.status && flight.status !== "flight") {
      pause();
      plan = pending = arrival = undefined;
      if (flight.status === "crashed") notice(`Impact at ${speed(flight.impactSpeed)}. Start a new flight to try again.`, true);
      else notice(`Touchdown on ${byId[flight.primary].name} at ${Math.round(flight.impactSpeed * 1000)} m/s.`);
    }
    if (flight.primary !== previous.primary) {
      pause();
      if (pending?.kind === "transfer" && pending.target === flight.primary) {
        arrival = { target: flight.primary, phase: "approach" };
      } else {
        arrival = undefined;
      }
      plan = pending = undefined;
      chooseDestinations();
      camera = "local";
      map.frame("local");
      notice(`Entered the ${byId[flight.primary].name} gravity frame.`);
    }
  }

  function clearRoute() {
    plan = pending = arrival = undefined;
  }

  function safely(action) {
    try { action(); }
    catch (error) { notice(error.message, true); }
    render();
  }

  function capture() {
    const next = circularize(flight);
    pause();
    plan = pending = undefined;
    if (arrival) arrival.phase = "captured";
    setFlight(next);
    notice(`Circular orbit around ${byId[flight.primary].name} at ${km(orbitOf(flight).radius - byId[flight.primary].radius)}.`);
  }

  function toPeriapsis() {
    if (!pending && arrival?.phase === "approach") {
      setFlight(navigation.periapsis(flight));
      arrival.phase = "capture";
    } else {
      setFlight(navigation.periapsis(flight));
    }
    pause();
    plan = undefined;
    notice("Reached periapsis. Circularize here to capture.");
  }

  function land() {
    setFlight(navigation.land(flight));
    pause();
  }

  function nextAction() {
    pause();
    if (flight.status === "landed") {
      setFlight(navigation.launch(flight));
      notice(`Booster separated. Circular parking orbit established above ${byId[flight.primary].name}.`);
    } else if (pending) {
      const route = pending;
      const state = advance(flight, Math.max(0, route.deadline - flight.time), undefined, { stopOnFrame: true });
      setFlight(state);
      pending = undefined;
      if (flight.status === "flight" && flight.primary !== route.target) notice("The flight did not reach the planned frame in the expected window.", true);
    } else if (arrival?.phase === "approach") {
      toPeriapsis();
    } else if (arrival?.phase === "capture") {
      capture();
    } else if (arrival?.phase === "captured") {
      land();
    } else if (plan) {
      if (plan.origin !== flight) throw new Error("Flight conditions changed. Plot the transfer again.");
      pending = { kind: "transfer", target: plan.targetId, deadline: plan.departure.time + plan.horizon };
      setFlight(plan.departure);
      plan = undefined;
      notice("Departure burn complete. The vessel is coasting toward the encounter.");
      map.magnify(0.4);
    } else if (target) {
      plan = navigation.transferPlan(flight, target);
      notice(plan.enoughFuel ? `Transfer plotted. Estimated capture burn ${speed(plan.capture)}.`
        : `Flyby plotted. The remaining fuel is insufficient for a ${speed(plan.capture)} capture burn.`);
      map.magnify(0.65);
    }
  }

  get("next").addEventListener("click", () => safely(nextAction));
  get("clear-route").addEventListener("click", () => { clearRoute(); render(); });
  get("capture").addEventListener("click", () => safely(capture));
  get("periapsis").addEventListener("click", () => safely(toPeriapsis));
  get("land").addEventListener("click", () => safely(land));
  get("escape").addEventListener("click", () => safely(() => {
    const route = navigation.parentDeparture(flight);
    pause();
    clearRoute();
    pending = { kind: "escape", target: route.target, deadline: route.departure.time + route.horizon };
    setFlight(route.departure);
    notice(`Escape burn complete. Coast to enter the ${byId[route.target].name} frame.`);
  }));

  get("throttle").addEventListener("input", (event) => {
    command = { ...command, throttle: Number(event.target.value) / 100 };
    if (command.throttle > 0) {
      clearRoute();
      if (Number(get("warp").value) === 0 || Number(get("warp").value) > 10) get("warp").value = "1";
      notice("Manual burn. Cut throttle to coast.");
    }
    render();
  });
  get("cut").addEventListener("click", () => { cutThrottle(); render(); });
  get("stage").addEventListener("click", () => safely(() => {
    cutThrottle();
    setFlight(separate(flight));
    clearRoute();
    notice(`Separated booster. ${flight.stages[flight.stage].name} is active.`);
  }));
  get("attitude").addEventListener("change", (event) => {
    command = { ...command, attitude: event.target.value };
    get("heading-control").hidden = event.target.value !== "manual";
    render();
  });
  get("heading").addEventListener("input", (event) => {
    command = { ...command, angle: Number(event.target.value) || 0 };
    render();
  });
  get("warp").addEventListener("change", () => {
    if (Number(get("warp").value) > 10) cutThrottle();
    if (Number(get("warp").value) > 0) {
      plan = undefined;
      if (arrival?.phase === "capture") arrival.phase = "approach";
    }
    render();
  });
  get("target").addEventListener("change", (event) => {
    target = event.target.value;
    plan = undefined;
    render();
  });
  get("local").addEventListener("click", () => homeView("local"));
  get("system").addEventListener("click", () => homeView("system"));
  get("zoom-in").addEventListener("click", () => map.magnify(1.5));
  get("zoom-out").addEventListener("click", () => map.magnify(1 / 1.5));
  get("hangar").addEventListener("submit", (event) => {
    event.preventDefault();
    safely(() => {
      pause();
      clearRoute();
      flight = createFlight(get("start").value, get("booster").value, get("engine").value);
      target = undefined;
      chooseDestinations();
      homeView("local");
      notice(flight.status === "landed" ? "Vehicle ready on the pad. Select Assisted liftoff or pilot manually."
        : `New mission in ${byId[flight.primary].name} orbit.`);
    });
  });

  let last = 0;
  function draw(now) {
    const warp = Number(get("warp").value);
    if (last && now - last < 30) {
      requestAnimationFrame(draw);
      return;
    }
    const elapsed = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (elapsed > 0 && warp > 0) {
      try {
        setFlight(advance(flight, elapsed * warp, command, { stopOnFrame: true }));
        if (command.throttle > 0 && flight.fuel[flight.stage] === 0) {
          cutThrottle();
          notice("Active stage is out of propellant.");
        }
        render();
      } catch (error) {
        pause();
        notice(error.message, true);
        render();
      }
    }
    requestAnimationFrame(draw);
  }

  chooseDestinations();
  notice("Start with a Kite transfer, or select a different starting point in Vehicle assembly.");
  new ResizeObserver(renderMap).observe(get("map"));
  render();
  requestAnimationFrame(draw);
})();
