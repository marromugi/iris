#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float noiseHash(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

// A blob of drifting teal, purple and pink that grows out of nothing, wobbles, and shrinks back to nothing, over and
// over. Each time it grows back it takes a new organic shape, chosen while it can't be seen. `energy`, from 0 to 1,
// makes the cycle shorter and the wobble stronger.
[[ stitchable ]] half4 thinkingBlob(float2 position, half4 color, float2 size, float time, float energy) {
    float2 uv = position / size * 2.0 - 1.0;

    float period = 3.6 - 1.2 * energy;
    float cycle = floor(time / period);
    float phase = fract(time / period);
    float scale = smoothstep(0.0, 0.18, phase) * (1.0 - smoothstep(0.82, 1.0, phase));
    if (scale < 0.001) {
        return half4(0.0);
    }

    float radius = length(uv) / scale;
    float angle = atan2(uv.y, uv.x);
    float wobble = 0.0;
    for (int lobes = 2; lobes <= 4; lobes++) {
        float seed = cycle * 7.0 + float(lobes);
        float amount = (0.03 + 0.06 * noiseHash(seed)) * (0.6 + 0.4 * energy);
        float turn = noiseHash(seed + 3.1) * 6.2831;
        float spin = (noiseHash(seed + 5.7) - 0.5) * 2.0 * (0.5 + energy);
        wobble += amount * sin(float(lobes) * angle + turn + time * spin);
    }
    float edge = 0.72 + wobble;
    float alpha = 1.0 - smoothstep(edge - 0.08, edge, radius);

    float drift = time * (0.4 + 1.2 * energy);
    float3 teal = float3(0.36, 0.82, 0.74);
    float3 purple = float3(0.55, 0.36, 0.86);
    float3 pink = float3(0.95, 0.62, 0.78);
    float first = 0.5 + 0.5 * sin(uv.x * 3.0 + drift + sin(uv.y * 2.0 + drift * 1.3));
    float second = 0.5 + 0.5 * sin(uv.y * 4.0 - drift * 1.1 + cos(uv.x * 3.0 - drift));
    float3 colour = mix(mix(teal, purple, first), pink, second * 0.6);
    colour += 0.25 * (1.0 - smoothstep(0.0, 0.7, length(uv - float2(-0.35, -0.35))));

    // Premultiplied: no channel above alpha.
    return half4(half3(saturate(colour)) * alpha, alpha);
}
