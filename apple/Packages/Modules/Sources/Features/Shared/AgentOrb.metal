#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float grainHash(float2 point, float seed) {
    float3 p = fract(float3(point.xyx) * 0.1031 + seed * 0.0007);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

// An agent's orb: a flat disc whose colour runs from `center` through `middle` to `rim`, quicker towards the edge,
// with a fine grain over it that `seed` lays out. The edge is softened by about a point and a half.
[[ stitchable ]] half4 agentOrb(
    float2 position, half4 color, float2 size, float seed, half4 center, half4 middle, half4 rim
) {
    float radius = min(size.x, size.y) * 0.5;
    float distance = length(position - size * 0.5) / radius;
    float edge = clamp((1.0 - distance) * radius / 1.5, 0.0, 1.0);
    if (edge <= 0.0) {
        return half4(0.0);
    }
    float along = pow(min(distance, 1.0), 2.2);
    half3 shade = along < 0.6
        ? mix(center.rgb, middle.rgb, half(along / 0.6))
        : mix(middle.rgb, rim.rgb, half((along - 0.6) / 0.4));
    half grain = half((grainHash(floor(position * 2.0), seed) - 0.5) * 0.18);
    shade = clamp(shade + half3(grain, grain * 0.95h, grain * 0.9h), 0.0h, 1.0h);
    return half4(shade * half(edge), half(edge));
}
