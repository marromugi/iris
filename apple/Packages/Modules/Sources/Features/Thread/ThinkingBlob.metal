#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Two shapes as one, by their distance to the edge: where they come close they pull toward each other and melt
// together, so a droplet coming in stretches a neck like a liquid.
static float smoothUnion(float a, float b, float melt) {
    float h = max(melt - abs(a - b), 0.0) / melt;
    return min(a, b) - h * h * melt * 0.25;
}

// Goes a little past 1 before settling, so the sun overshoots as it swells and as it snaps back. Products rather than
// `pow`, which is undefined for a negative base.
static float easeOutBack(float x) {
    const float pull = 1.7;
    float past = x - 1.0;
    return 1.0 + (pull + 1.0) * past * past * past + pull * past * past;
}

// How much of a point is inside an edge, softened over `soft`.
static float inside(float edge, float soft) {
    return 1.0 - smoothstep(-soft * 0.5, soft * 0.5, edge);
}

// How far droplet `i` is through its trip this round, from 0 (not left) to 1 (taken in).
static float tripOf(int i, float progress) {
    return saturate((progress - 0.02 - float(i) * 0.12) / 0.4);
}

// A sun with four droplets for planets, in one colour, the colour of what it is drawn over. Each round the droplets
// set off one by one, each on its own orbit, tipped toward the viewer and turned a quarter turn from the last. A
// droplet comes out from behind the sun small and faint, swings round one side, and comes to the front large and
// full, where it melts into the sun. The sun swells with each one it takes in, holds, then snaps back to where it
// started. Its edge is crisp, and a soft shade drifts across it. `energy`, from 0 to 1, makes all of it quicker.
[[ stitchable ]] half4 thinkingBlob(float2 position, half4 color, float2 size, float time, float energy) {
    float2 uv = position / size * 2.0 - 1.0;

    const float rest = 0.22;
    const float full = 0.42;
    const float droplet = 0.11;
    const float reach = 0.6;
    // How far an orbit is tipped toward the viewer (0 edge on, 1 face on), and how much bigger a droplet is in front
    // of the sun than beside it, and smaller behind.
    const float tip = 0.38;
    const float perspective = 0.35;
    const float melt = 0.11;
    // About a point of softening, so the edge stays crisp at any size.
    float soft = 2.0 / max(size.x, 1.0);

    float period = 4.6 - 1.0 * energy;
    float progress = fract(time / period);

    float swallowed = 0.0;
    for (int i = 0; i < 4; i++) {
        swallowed += easeOutBack(saturate((tripOf(i, progress) - 0.85) / 0.15)) / 4.0;
    }
    float snapBack = easeOutBack(saturate((progress - 0.88) / 0.07));
    float radius = mix(mix(rest, full, swallowed), rest, snapBack);

    // The sun with the droplets in front of it melted in, and how dark that is where each droplet is.
    float front = length(uv) - radius;
    float frontInk = 1.0;
    // The droplets behind the sun, which it hides.
    float behindInk = 0.0;
    for (int i = 0; i < 4; i++) {
        float trip = tripOf(i, progress);
        // Straight behind the sun at the start, round one side, straight in front at the end.
        float turn = M_PI_F * (trip - 0.5);
        float nearness = sin(turn);
        float scale = 1.0 + perspective * nearness;
        // Out of the sun's middle while hidden behind it, and back into it from the front.
        float out = smoothstep(0.0, 0.12, trip) * (1.0 - smoothstep(0.8, 1.0, trip));
        float2 onOrbit = reach * out * scale * float2(cos(turn), tip * nearness);
        float heading = float(i) * M_PI_F / 2.0;
        float2 at = float2(
            onOrbit.x * cos(heading) - onOrbit.y * sin(heading), onOrbit.x * sin(heading) + onOrbit.y * cos(heading));
        float edge = length(uv - at) - droplet * scale * (1.0 - smoothstep(0.9, 1.0, trip));
        // Fainter the farther it is.
        float ink = 0.7 + 0.3 * nearness;
        if (nearness < 0.0) {
            behindInk = max(behindInk, inside(edge, soft) * ink);
        } else {
            frontInk = mix(frontInk, ink, smoothstep(-melt * 0.5, melt * 0.5, front - edge));
            front = smoothUnion(front, edge, melt);
        }
    }
    float shown = inside(front, soft);

    // A shade that drifts across everything: full ink on one side, lighter on the other.
    float drift = time * (0.3 + 0.6 * energy);
    float2 towards = float2(cos(drift), sin(drift));
    float shade = 0.72 + 0.28 * smoothstep(-0.7, 0.7, dot(uv, towards));

    float ink = (shown * frontInk + (1.0 - shown) * behindInk) * shade * float(color.a);
    return half4(color.rgb / max(color.a, half(0.001)) * half(ink), half(ink));
}
