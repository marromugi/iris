#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float noiseHash(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

// A blob in one colour, the colour of what it is drawn over, that grows out of nothing, wobbles, and shrinks back to
// nothing, over and over. Each time it grows back it takes a new organic shape, chosen while it can't be seen. Its
// edge is crisp, and a soft shade drifts across it. `energy`, from 0 to 1, makes the cycle shorter and the wobble
// stronger.
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
    // About a pixel and a half of softening, so the edge stays crisp at any size.
    float soft = 3.0 / max(size.x, 1.0) / scale;
    float alpha = 1.0 - smoothstep(edge - soft, edge, radius);

    // A shade that drifts across the blob: full ink on one side, lighter on the other.
    float drift = time * (0.3 + 0.8 * energy);
    float2 towards = float2(cos(drift), sin(drift));
    float shade = 0.72 + 0.28 * smoothstep(-0.9, 0.9, dot(uv / max(scale, 0.001), towards));

    float ink = alpha * shade * float(color.a);
    return half4(color.rgb / max(color.a, half(0.001)) * half(ink), half(ink));
}
