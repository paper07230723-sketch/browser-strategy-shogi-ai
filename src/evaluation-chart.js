
const SVG_NS = "http://www.w3.org/2000/svg";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 250;

const PLOT = {
  left: 62,
  right: 18,
  top: 20,
  bottom: 38,
};

function createSvgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }

  return node;
}

function formatScore(score) {
  if (!score) return "評価値なし";

  if (score.type === "mate") {
    if (score.value === 0) return "詰み判定";

    return score.value > 0
      ? `先手から${Math.abs(score.value)}手詰み`
      : `後手から${Math.abs(score.value)}手詰み`;
  }

  const value = score.value;
  return `${value > 0 ? "+" : ""}${value}cp`;
}

function createLegendItem(label, className) {
  const item = document.createElement("span");
  item.className = "analysis-chart-legend-item";

  const marker = document.createElement("span");
  marker.className = `analysis-chart-legend-marker ${className}`;
  marker.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  item.append(marker, text);

  return item;
}

function getChartPoint(result, maxAbs, plotHeight, plotTop) {
  const score = result.info?.score;

  if (!score || !Number.isFinite(score.value)) {
    return null;
  }

  let value;

  if (score.type === "cp") {
    value = score.value;
  } else if (score.type === "mate") {
    value = Math.sign(score.value) * maxAbs;
  } else {
    return null;
  }

  const y =
    plotTop +
    ((maxAbs - value) / (maxAbs * 2)) * plotHeight;

  return { x: result.ply, y, score };
}

export function createEvaluationChart({
  results,
  resultsByPly,
  getMoveJudgment,
  onSelectPly,
}) {
  const card = document.createElement("section");
  card.className = "analysis-evaluation-chart";

  const heading = document.createElement("h3");
  heading.className = "analysis-chart-title";
  heading.textContent = "形勢グラフ";

  const legend = document.createElement("div");
  legend.className = "analysis-chart-legend";

  legend.append(
    createLegendItem("疑問手", "is-question"),
    createLegendItem("悪手", "is-blunder"),
    createLegendItem("詰み", "is-mate"),
  );

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: "img",
    "aria-label": "棋譜の各局面における先手視点の評価値の推移",
    class: "analysis-chart-svg",
  });

  const description = createSvgElement("desc");
  description.textContent =
    "縦軸は先手視点の評価値、横軸は手数です。悪手と疑問手は色付きの点で表示します。";
  svg.appendChild(description);

  const plotWidth =
    CHART_WIDTH - PLOT.left - PLOT.right;

  const plotHeight =
    CHART_HEIGHT - PLOT.top - PLOT.bottom;

  const cpValues = results
    .map((result) => result.info?.score)
    .filter((score) =>
      score?.type === "cp" &&
      Number.isFinite(score.value)
    )
    .map((score) => Math.abs(score.value));

  const largestScore = Math.max(0, ...cpValues);

  // 評価値の範囲を500cp単位で調整する。
  const maxAbs = Math.max(
    500,
    Math.ceil((largestScore * 1.1) / 500) * 500
  );

  const maxPly = Math.max(
    1,
    ...results.map((result) => result.ply)
  );

  const xPosition = (ply) =>
    PLOT.left + (ply / maxPly) * plotWidth;

  // 横方向の目盛りと評価値の目盛り
  for (let index = 0; index <= 4; index++) {
    const value = maxAbs - (maxAbs * 2 * index) / 4;
    const y = PLOT.top + (plotHeight * index) / 4;

    const line = createSvgElement("line", {
      x1: PLOT.left,
      y1: y,
      x2: CHART_WIDTH - PLOT.right,
      y2: y,
      class: value === 0
        ? "analysis-chart-zero-line"
        : "analysis-chart-grid-line",
    });

    const label = createSvgElement("text", {
      x: PLOT.left - 9,
      y: y + 4,
      "text-anchor": "end",
      class: "analysis-chart-axis-label",
    });

    label.textContent = String(Math.round(value));

    svg.append(line, label);
  }

  // 横軸
  const xAxis = createSvgElement("line", {
    x1: PLOT.left,
    y1: PLOT.top + plotHeight,
    x2: CHART_WIDTH - PLOT.right,
    y2: PLOT.top + plotHeight,
    class: "analysis-chart-axis",
  });

  svg.appendChild(xAxis);

  const xLabels = [
    { ply: 0, label: "開始" },
    { ply: Math.round(maxPly / 2), label: `${Math.round(maxPly / 2)}手` },
    { ply: maxPly, label: `${maxPly}手` },
  ];

  for (const item of xLabels) {
    const label = createSvgElement("text", {
      x: xPosition(item.ply),
      y: CHART_HEIGHT - 10,
      "text-anchor": "middle",
      class: "analysis-chart-axis-label",
    });

    label.textContent = item.label;
    svg.appendChild(label);
  }

  // 評価値の折れ線。評価値を取得できない局面では線を分割する。
  let currentSegment = [];

  const drawSegment = () => {
    if (currentSegment.length >= 2) {
      const pathData = currentSegment
        .map((point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
        )
        .join(" ");

      svg.appendChild(
        createSvgElement("path", {
          d: pathData,
          class: "analysis-chart-line",
        })
      );
    }

    currentSegment = [];
  };

  const points = [];

  for (const result of results) {
    const point = getChartPoint(
      result,
      maxAbs,
      plotHeight,
      PLOT.top
    );

    if (!point) {
      drawSegment();
      continue;
    }

    point.x = xPosition(result.ply);
    points.push({ result, point });
    currentSegment.push(point);
  }

  drawSegment();

  // 各局面のマーカー
  for (const { result, point } of points) {
    const judgment = getMoveJudgment(
      result,
      resultsByPly
    );

    if (
      judgment !== "悪手" &&
      judgment !== "疑問手" &&
      point.score.type !== "mate"
    ) {
      continue;
    }

    const markerClass =
      judgment === "悪手"
        ? "is-blunder"
        : judgment === "疑問手"
          ? "is-question"
          : point.score.type === "mate"
            ? "is-mate"
            : "is-normal";

    const marker = createSvgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: judgment === "悪手" ? 6 : 4.5,
      class: `analysis-chart-point ${markerClass}`,
      tabindex: 0,
      role: "button",
      "aria-label":
        `${result.ply === 0 ? "開始局面" : `${result.ply}手目`}、` +
        `${formatScore(point.score)}、判定 ${judgment}`,
    });

    const title = createSvgElement("title");
    title.textContent =
      `${result.ply === 0 ? "開始局面" : `${result.ply}手目`}：` +
      `${formatScore(point.score)} ／ ${judgment}`;

    marker.appendChild(title);

    const selectPosition = () => {
      onSelectPly?.(result.ply);
    };

    marker.addEventListener("click", selectPosition);

    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPosition();
      }
    });

    svg.appendChild(marker);
  }

  card.append(heading, legend, svg);

  return card;
}
