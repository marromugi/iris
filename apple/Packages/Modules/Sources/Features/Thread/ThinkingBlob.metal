#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float noiseHash(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

// The shape a cycle aims for: how far each of 2, 3 and 4 lobes bulges, where it points, and how fast it turns.
static float lobeAmount(float cycle, int lobes) {
    return 0.035 + 0.075 * noiseHash(cycle * 7.0 + float(lobes));
}

static float lobeTurn(float cycle, int lobes) {
    return noiseHash(cycle * 7.0 + float(lobes) + 3.1) * 6.2831;
}

// A blob in one colour, the colour of what it is drawn over, that never stops changing shape: it flows from one
// organic shape into the next, turns, and breathes a little. Its edge is crisp, and a soft shade drifts across it.
// `energy`, from 0 to 1, makes all of it quicker.
[[ stitchable ]] half4 thinkingBlob(float2 position, half4 color, float2 size, float time, float energy) {
    float2 uv = position / size * 2.0 - 1.0;

    float pace = 0.6 + 1.2 * energy;
    float period = 2.6 - 1.2 * energy;
    float cycle = floor(time / period);
    float blend = smoothstep(0.0, 1.0, fract(time / period));
    float breathe = 1.0 - 0.07 * (0.5 + 0.5 * sin(time * 2.4 * pace));

    float radius = length(uv) / breathe;
    float angle = atan2(uv.y, uv.x) + time * 0.5 * pace;
    float wobble = 0.0;
    for (int lobes = 2; lobes <= 4; lobes++) {
        float amount = mix(lobeAmount(cycle, lobes), lobeAmount(cycle + 1.0, lobes), blend);
        float turn = mix(lobeTurn(cycle, lobes), lobeTurn(cycle + 1.0, lobes), blend);
        wobble += amount * sin(float(lobes) * angle + turn + time * pace * (0.7 + 0.2 * float(lobes)));
    }
    float edge = 0.66 + wobble;
    // About a point and a half of softening, so the edge stays crisp at any size.
    float soft = 3.0 / max(size.x, 1.0) / breathe;
    float alpha = 1.0 - smoothstep(edge - soft, edge, radius);

    // A shade that drifts across the blob: full ink on one side, lighter on the other.
    float drift = time * 0.5 * pace;
    float2 towards = float2(cos(drift), sin(drift));
    float shade = 0.72 + 0.28 * smoothstep(-0.7, 0.7, dot(uv, towards));

    float ink = alpha * shade * float(color.a);
    return half4(color.rgb / max(color.a, half(0.001)) * half(ink), half(ink));
}
