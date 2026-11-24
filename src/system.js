"use strict";

(() => {
  const bodies = [
    { id: "solenne", name: "Solenne", kind: "Star", parent: null, radius: 8500, mu: 24e6, color: "#ffd48b" },
    { id: "flint", name: "Flint", kind: "Planet", parent: "solenne", radius: 460, mu: 1700, orbit: 135000, phase: 3.93, soi: 4500, color: "#d8906b" },
    { id: "aster", name: "Aster", kind: "Planet", parent: "solenne", radius: 620, mu: 3600, orbit: 260000, phase: 0.30, soi: 15500, color: "#5ad3d7" },
    { id: "kite", name: "Kite", kind: "Moon", parent: "aster", radius: 145, mu: 47, orbit: 4600, phase: 1.80, soi: 790, color: "#dbc9ae" },
    { id: "fallow", name: "Fallow", kind: "Moon", parent: "aster", radius: 92, mu: 14, orbit: 9000, phase: 4.15, soi: 590, color: "#a9b0cd" },
    { id: "morrow", name: "Morrow", kind: "Planet", parent: "solenne", radius: 800, mu: 5400, orbit: 410000, phase: 1.74, soi: 18000, color: "#de817c" },
    { id: "tern", name: "Tern", kind: "Moon", parent: "morrow", radius: 124, mu: 32, orbit: 6100, phase: 3.70, soi: 650, color: "#b5aa91" },
    { id: "rime", name: "Rime", kind: "Planet", parent: "solenne", radius: 1030, mu: 7600, orbit: 630000, phase: 5.13, soi: 27500, color: "#a5a8fe" },
  ].map((body) => Object.freeze(body));

  const byId = Object.freeze(Object.fromEntries(bodies.map((body) => [body.id, body])));
  const children = Object.freeze(Object.fromEntries(
    bodies.map((body) => [body.id, Object.freeze(bodies.filter(({ parent }) => parent === body.id))]),
  ));
  const TAU = Math.PI * 2;
  const wrap = (angle) => ((angle % TAU) + TAU) % TAU;

  function offset(body, time) {
    if (!body.parent) return { x: 0, y: 0, vx: 0, vy: 0 };
    const angularSpeed = Math.sqrt(byId[body.parent].mu / body.orbit ** 3);
    const angle = body.phase + angularSpeed * time;
    const x = body.orbit * Math.cos(angle);
    const y = body.orbit * Math.sin(angle);
    return { x, y, vx: -y * angularSpeed, vy: x * angularSpeed };
  }

  function bodyState(id, time) {
    const body = byId[id];
    const pos = offset(body, time);
    if (!body.parent) return pos;
    const parent = bodyState(body.parent, time);
    return { x: pos.x + parent.x, y: pos.y + parent.y, vx: pos.vx + parent.vx, vy: pos.vy + parent.vy };
  }

  const api = Object.freeze({ bodies: Object.freeze(bodies), byId, children, bodyState, offset, TAU, wrap });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.FarSystem = api;
})();
