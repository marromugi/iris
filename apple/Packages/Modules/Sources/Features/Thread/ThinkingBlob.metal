#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Two shapes as one, by their distance to the edge: where they come close they pull toward each other and melt
// together, so a droplet leaving or coming back stretches a neck like a liquid.
static float smoothUnion(float a, float b, float melt) {
    float h = max(melt - abs(a - b), 0.0) / melt;
    return min(a, b) - h * h * melt * 0.25;
}

// Products rather than `pow`, which is undefined for a negative base.
static float easeOut(float x) {
    float left = 1.0 - x;
    return 1.0 - left * left * left;
}

static float easeIn(float x) {
    return x * x * x;
}

// Goes a little past 1 before settling, so the drop swells as it takes a droplet back.
static float easeOutBack(float x) {
    const float pull = 1.7;
    float past = x - 1.0;
    return 1.0 + (pull + 1.0) * past * past * past + pull * past * past;
}

// A drop in one colour, the colour of what it is drawn over. Each round it sends four droplets out one by one, a
// quarter turn apart. Each circles the drop like a satellite on a tilted orbit, all the same way, growing as it
// swings near and shrinking as it swings away. It takes them back in the order they left, swells with each one it
// takes, and shrinks to where it started. Its edge is crisp, and a soft shade drifts across it. `energy`, from 0 to
// 1, makes all of it quicker.
[[ stitchable ]] half4 thinkingBlob(float2 position, half4 color, float2 size, float time, float energy) {
    float2 uv = position / size * 2.0 - 1.0;

    const float rest = 0.27;
    const float full = 0.54;
    const float droplet = 0.17;
    const float reach = 0.66;
    // How round the orbit looks (1 is a circle), and how much nearer and farther change a droplet's size.
    const float roundness = 0.9;
    const float depth = 0.4;
    const float melt = 0.16;

    float period = 4.2 - 1.0 * energy;
    float progress = fract(time / period);

    float swallowed = 0.0;
    float droplets = 1e3;
    for (int i = 0; i < 4; i++) {
        float leaves = 0.02 + float(i) * 0.09;
        float returns = 0.48 + float(i) * 0.075;
        float outward = easeOut(saturate((progress - leaves) / 0.16));
        float homeward = easeIn(saturate((progress - returns) / 0.12));
        float away = outward - homeward;
        swallowed += easeOutBack(saturate((homeward - 0.6) / 0.4)) / 4.0;

        // One turn a round, so the orbit is where it started when the next round begins.
        float turn = 2.0 * M_PI_F * (progress - leaves);
        float2 onOrbit = reach * away * float2(cos(turn), roundness * sin(turn));
        // Leaves where it will stay a quarter turn behind the one before, however far that one has turned since.
        float heading = -M_PI_F / 2.0 + float(i) * M_PI_F / 2.0 + 2.0 * M_PI_F * leaves;
        float2 at = float2(
            onOrbit.x * cos(heading) - onOrbit.y * sin(heading), onOrbit.x * sin(heading) + onOrbit.y * cos(heading));
        float nearness = 1.0 + depth * sin(turn) * away;
        droplets = smoothUnion(droplets, length(uv - at) - droplet * nearness, melt);
    }
    float radius = mix(mix(rest, full, swallowed), rest, smoothstep(0.87, 0.99, progress));
    float edge = smoothUnion(length(uv) - radius, droplets, melt);

    // About a point of softening, so the edge stays crisp at any size.
    float soft = 2.0 / max(size.x, 1.0);
    float alpha = 1.0 - smoothstep(-soft * 0.5, soft * 0.5, edge);

    // A shade that drifts across the drop: full ink on one side, lighter on the other.
    float drift = time * (0.3 + 0.6 * energy);
    float2 towards = float2(cos(drift), sin(drift));
    float shade = 0.72 + 0.28 * smoothstep(-0.7, 0.7, dot(uv, towards));

    float ink = alpha * shade * float(color.a);
    return half4(color.rgb / max(color.a, half(0.001)) * half(ink), half(ink));
}
