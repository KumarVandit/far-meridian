"use strict";

(() => {
  const { bodies, byId, bodyState, TAU } = globalThis.FarSystem;
  const { globalState, heading, orbitOf } = globalThis.FarFlight;
  const grid = "rgba(133, 164, 191, .10)";

  function makeMap(canvas, redraw, selectBody) {
    const ctx = canvas.getContext("2d");
    let focus = "local";
    let zoom = 1;
    let driftX = 0;
    let driftY = 0;
    let press;
    let positions = [];
    let scale = 1;

    function frame(id) {
      focus = id;
      zoom = 1;
      driftX = 0;
      driftY = 0;
    }

    function magnify(factor) {
      zoom = Math.min(320, Math.max(0.002, zoom * factor));
      redraw();
    }

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      magnify(Math.exp(Math.max(-120, Math.min(120, -event.deltaY)) * 0.003));
    }, { passive: false });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      press = { x: event.clientX, y: event.clientY, driftX, driftY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!press) return;
      driftX = press.driftX - (event.clientX - press.x) / scale;
      driftY = press.driftY + (event.clientY - press.y) / scale;
      redraw();
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!press) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) {
        const box = canvas.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        const hit = positions.findLast((point) => Math.hypot(x - point.x, y - point.y) < Math.max(12, point.marker));
        if (hit) selectBody(hit.body.id);
      }
      press = undefined;
    });
    canvas.addEventListener("pointercancel", () => { press = undefined; });

    function render(flight, command, target, plan) {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!w || !h) return;
      const density = Math.min(globalThis.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * density) || canvas.height !== Math.round(h * density)) {
        canvas.width = Math.round(w * density);
        canvas.height = Math.round(h * density);
      }
      ctx.setTransform(density, 0, 0, density, 0, 0);

      const id = focus === "local" ? flight.primary : focus === "system" ? "solenne" : focus;
      const reference = byId[id];
      const origin = bodyState(id, flight.time);
      const viewRadius = id === "solenne" ? 735000
        : Math.max(reference.radius * 2.05, focus === "local" ? Math.min(orbitOf(flight).radius * 1.20, reference.soi * 1.05) : 0);
      scale = Math.min(w, h) / (2 * viewRadius) * zoom;
      const project = (x, y) => [
        w / 2 + (x - origin.x - driftX) * scale,
        h / 2 - (y - origin.y - driftY) * scale,
      ];

      ctx.fillStyle = "#0a1520";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = w % 40 / 2; x < w; x += 40) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = h % 40 / 2; y < h; y += 40) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      positions = bodies.map((body) => {
        const p = bodyState(body.id, flight.time);
        const [x, y] = project(p.x, p.y);
        return { body, x, y, marker: Math.max(body.id === "solenne" ? 6 : 3.4, body.radius * scale) };
      });
      for (const point of positions) {
        const { body } = point;
        const parent = positions.find((candidate) => candidate.body.id === body.parent);
        if (parent) circle(parent.x, parent.y, body.orbit * scale, "#253950");
        if (target === body.id && body.soi) {
          ctx.setLineDash([4, 6]);
          circle(point.x, point.y, body.soi * scale, "#456f78");
          ctx.setLineDash([]);
        }
      }

      const frameOrigin = bodyState(flight.primary, flight.time);
      if (flight.status === "flight") drawOrbit(flight, frameOrigin, project, "#67c9db", [5, 6]);
      if (plan && plan.origin === flight) drawOrbit(plan.departure, frameOrigin, project, "#edbc86", [3, 4]);

      for (const point of positions) {
        const { body, x, y, marker } = point;
        if (x + marker < 0 || y + marker < 0 || x - marker > w || y - marker > h) continue;
        ctx.fillStyle = body.id === "solenne" ? "#b7753c" : "#182b3b";
        if (marker > 7) {
          const fill = ctx.createRadialGradient(x - marker * 0.33, y - marker * 0.32, 0, x, y, marker);
          fill.addColorStop(0, body.color);
          fill.addColorStop(0.75, body.id === "solenne" ? "#c98045" : "#263c54");
          fill.addColorStop(1, body.id === "solenne" ? "#975231" : "#15283c");
          ctx.fillStyle = fill;
        } else {
          ctx.fillStyle = body.color;
        }
        ctx.beginPath();
        ctx.arc(x, y, marker, 0, TAU);
        ctx.fill();
        if (marker > 7) circle(x, y, marker, body.color);
        if (target === body.id) circle(x, y, marker + 5, "#eab991");
        if (marker < 90) {
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillStyle = body.color;
          ctx.fillText(body.name.toUpperCase(), x + marker + 8, y + 3);
        }
      }

      const world = globalState(flight);
      const [sx, sy] = project(world.x, world.y);
      if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) drawShip(sx, sy, flight, command.throttle > 0 ? heading(flight, command) : undefined);

      const distance = 75 / scale;
      const tick = 10 ** Math.floor(Math.log10(distance));
      const length = Math.floor(distance / tick) * tick;
      const bottom = h - 19;
      ctx.strokeStyle = "#8ba2b6";
      ctx.beginPath(); ctx.moveTo(16, bottom - 4); ctx.lineTo(16, bottom);
      ctx.lineTo(16 + length * scale, bottom); ctx.lineTo(16 + length * scale, bottom - 4); ctx.stroke();
      ctx.fillStyle = "#a3b7c8";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`${Intl.NumberFormat("en", { maximumSignificantDigits: 2 }).format(length)} km`, 21 + length * scale, bottom + 3);
      return reference.name;
    }

    function circle(x, y, r, color) {
      if (r < 1) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
    }

    function drawOrbit(flight, origin, project, color, dash) {
      const orbit = orbitOf(flight);
      if (!(orbit.p > 1e-4)) return;
      const range = orbit.ecc < 1 ? Math.PI : Math.acos(-1 / orbit.ecc) - 0.002;
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i <= 240; i += 1) {
        const anomaly = range * (2 * i / 240 - 1);
        const radius = orbit.p / (1 + orbit.ecc * Math.cos(anomaly));
        const angle = orbit.argument + anomaly;
        const [x, y] = project(origin.x + radius * Math.cos(angle), origin.y + radius * Math.sin(angle));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawShip(x, y, flight, burnHeading) {
      const angle = burnHeading ?? Math.atan2(flight.vy, flight.vx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-angle);
      ctx.fillStyle = flight.status === "crashed" ? "#eb877b" : "#9df2db";
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
      if (burnHeading !== undefined && flight.status === "flight") {
        ctx.strokeStyle = "#f5ac64";
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-14, 0); ctx.stroke();
      }
      ctx.restore();
    }

    return { render, frame, magnify };
  }

  globalThis.makeFarMap = makeMap;
})();
