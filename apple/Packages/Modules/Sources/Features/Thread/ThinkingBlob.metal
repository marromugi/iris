#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// A round blob of drifting teal, purple and pink whose edge wobbles. `energy`, from 0 to 1, sets how fast the colours
// drift and how much the edge wobbles.
[[ stitchable ]] half4 thinkingBlob(float2 position, half4 color, float2 size, float time, float energy) {
    float2 uv = position / size * 2.0 - 1.0;
    float radius = length(uv);
    float angle = atan2(uv.y, uv.x);
    float wobble = (0.02 + 0.06 * energy) * sin(angle * 3.0 + time * 2.0)
        + (0.01 + 0.03 * energy) * sin(angle * 5.0 - time * 3.0);
    float edge = 0.86 + wobble;
    float alpha = smoothstep(edge, edge - 0.08, radius);

    float drift = time * (0.4 + 1.2 * energy);
    float3 teal = float3(0.36, 0.82, 0.74);
    float3 purple = float3(0.55, 0.36, 0.86);
    float3 pink = float3(0.95, 0.62, 0.78);
    float first = 0.5 + 0.5 * sin(uv.x * 3.0 + drift + sin(uv.y * 2.0 + drift * 1.3));
    float second = 0.5 + 0.5 * sin(uv.y * 4.0 - drift * 1.1 + cos(uv.x * 3.0 - drift));
    float3 colour = mix(mix(teal, purple, first), pink, second * 0.6);
    colour += 0.25 * smoothstep(0.7, 0.0, length(uv - float2(-0.35, -0.35)));

    return half4(half3(colour) * alpha, alpha);
}
