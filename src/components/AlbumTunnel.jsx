import React from "react";

export default function AlbumTunnelCSS({
  imageUrl,
  LAYERS = 26,
  ROT_STEP = Math.PI / 200,
  GROWTH = 1.1,
  FRONT_FACTOR = 0.55,
  biasX = 0,
  biasY = 0,
  background = "#000",
  centerFront = true,
  direction = 1
}) {
  const layers = Array.from({ length: LAYERS }, (_, i) => i);

  return (
    <div
      className="tunnel-wrap"
      style={{
        background,
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {/* Back stack */}
      {layers
        .slice(1)
        .reverse()
        .map((i) => {
          const rot = i * ROT_STEP * direction;
          const scale = Math.pow(GROWTH, i);
          const offX = biasX * 0.02;
          const offY = biasY * 0.02;

          // shadow grows with depth
          const shadowY = 20;
          const shadowBlur = 20 + i * 0.6;

          return (
            <div
              key={i}
              className="tunnel-layer"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: "min(100vmin, 140vh)",
                aspectRatio: "1 / 1",
                transform: `
                  translate(calc(-50% + ${offX} * 1px), calc(-50% + ${offY} * 1px))
                  rotate(${rot}rad)
                  scale(${FRONT_FACTOR * scale})
                `,
                transformOrigin: "50% 50%",
                backgroundImage: `url(${imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                willChange: "transform",
                contain: "paint",
                pointerEvents: "none",

                // 👇 drop shadow per layer
                filter: `drop-shadow(${shadowY}px ${shadowY}px ${shadowBlur}px rgba(0,0,0,0.7))`,
              }}
            />
          );
        })}

      {/* Front-most square */}
      <div
        className="tunnel-front"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "min(100vmin, 140vh)",
          aspectRatio: "1 / 1",
          transform: `
            translate(
              calc(-50% + ${(centerFront ? 0 : biasX * 0.02)} * 1px),
              calc(-50% + ${(centerFront ? 0 : biasY * 0.02)} * 1px)
            )
            scale(${FRONT_FACTOR})
          `,
          transformOrigin: "50% 50%",
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          willChange: "transform",
          contain: "paint",
          pointerEvents: "none",

          // 👇 shadow for front image
          filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
        }}
      />
    </div>
  );
}
