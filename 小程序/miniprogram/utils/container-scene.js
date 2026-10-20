function colorFor(value) {
  let hash = 0;
  for (const character of String(value || "SKU")) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 330}, 58%, 51%)`;
}

function sceneLegend(items, limit) {
  return (items || []).slice(0, limit || 8).map((item) => ({
    sku: item.sku,
    name: item.productName,
    cartons: item.cartonCount,
    color: colorFor(item.sku),
  }));
}

function corners(box) {
  const x0 = Number(box.x || 0); const y0 = Number(box.y || 0); const z0 = Number(box.z || 0);
  const x1 = x0 + Number(box.lengthCm || 0); const y1 = y0 + Number(box.widthCm || 0); const z1 = z0 + Number(box.heightCm || 0);
  return [
    { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 },
    { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 },
  ];
}

function drawContainerScene(options) {
  const canvas = options.canvas;
  const size = options.size;
  const scene = options.scene;
  if (!canvas || !size || !scene) return;
  const { width, height, dpr } = size;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071d2d";
  ctx.fillRect(0, 0, width, height);
  const container = scene.container || {};
  const length = Number(container.lengthCm || 1); const breadth = Number(container.widthCm || 1); const tall = Number(container.heightCm || 1);
  const mode = options.mode || "iso";
  const rotation = options.rotation || { yaw: -0.62, pitch: 0.42 };
  const rawProject = (point) => {
    const x = point.x - length / 2; const y = point.y - breadth / 2; const z = point.z - tall / 2;
    if (mode === "top") return { x, y, depth: z };
    if (mode === "side") return { x, y: -z, depth: y };
    const cos = Math.cos(rotation.yaw); const sin = Math.sin(rotation.yaw);
    const horizontal = x * cos - y * sin;
    const depth = x * sin + y * cos;
    const pitchCos = Math.cos(rotation.pitch); const pitchSin = Math.sin(rotation.pitch);
    return { x: horizontal, y: -z * pitchCos + depth * pitchSin, depth: depth * pitchCos + z * pitchSin };
  };
  const containerBox = { x: 0, y: 0, z: 0, lengthCm: length, widthCm: breadth, heightCm: tall };
  const boundary = corners(containerBox).map(rawProject);
  const minX = Math.min(...boundary.map((point) => point.x)); const maxX = Math.max(...boundary.map((point) => point.x));
  const minY = Math.min(...boundary.map((point) => point.y)); const maxY = Math.max(...boundary.map((point) => point.y));
  const scale = Math.min((width - 34) / Math.max(maxX - minX, 1), (height - 34) / Math.max(maxY - minY, 1));
  const project = (point) => { const value = rawProject(point); return { x: (value.x - (minX + maxX) / 2) * scale + width / 2, y: (value.y - (minY + maxY) / 2) * scale + height / 2, depth: value.depth }; };
  const boxes = (scene.placements || []).slice(0, options.maxBoxes || 600).map((box) => {
    const points = corners(box).map(project);
    return { box, points, depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length };
  }).sort((left, right) => left.depth - right.depth);
  const faces = mode === "top" ? [[4, 5, 6, 7]] : mode === "side" ? [[0, 1, 5, 4]] : [[4, 5, 6, 7], [1, 2, 6, 5], [2, 3, 7, 6]];
  const faceAlpha = [0.94, 0.72, 0.56];
  for (const entry of boxes) {
    faces.forEach((indices, index) => {
      ctx.beginPath();
      indices.forEach((pointIndex, offset) => offset ? ctx.lineTo(entry.points[pointIndex].x, entry.points[pointIndex].y) : ctx.moveTo(entry.points[pointIndex].x, entry.points[pointIndex].y));
      ctx.closePath();
      ctx.globalAlpha = faceAlpha[index] || 0.7;
      ctx.fillStyle = colorFor(entry.box.sku);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#d9fffa";
      ctx.lineWidth = 0.45;
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#79ddca";
  ctx.lineWidth = 1.2;
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const frame = corners(containerBox).map(project);
  for (const [start, end] of edges) { ctx.beginPath(); ctx.moveTo(frame[start].x, frame[start].y); ctx.lineTo(frame[end].x, frame[end].y); ctx.stroke(); }
  if (!boxes.length) {
    ctx.fillStyle = "#9fc2c3"; ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.fillText("当前测算没有可视化箱体", width / 2, height / 2);
  }
}

module.exports = { colorFor, drawContainerScene, sceneLegend };
